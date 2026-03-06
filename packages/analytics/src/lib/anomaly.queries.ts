import { ClickHouseClient } from '@clickhouse/client';
import { getClickHouseClient } from './clickhouse.client.js';
import {
  ANOMALY_Z_SCORE_WARNING,
  ANOMALY_Z_SCORE_CRITICAL,
  ANOMALY_BASELINE_DAYS,
} from '@adtech/shared-types';
import type { AnomalyDetectionResult } from '@adtech/shared-types';

export class AnomalyQueries {
  private readonly client: ClickHouseClient;

  constructor(client?: ClickHouseClient) {
    this.client = client || getClickHouseClient();
  }

  // Detekcia anomálií pomocou Z-skóre pre všetky kampane účtu
  async detectAccountAnomalies(accountId: number): Promise<AnomalyDetectionResult[]> {
    const metrics = ['spend', 'roas', 'cpa', 'ctr'];
    const anomalies: AnomalyDetectionResult[] = [];

    for (const metric of metrics) {
      const metricAnomalies = await this.detectMetricAnomalies(accountId, metric);
      anomalies.push(...metricAnomalies);
    }

    return anomalies;
  }

  async detectMetricAnomalies(
    accountId: number,
    metric: string,
  ): Promise<AnomalyDetectionResult[]> {
    const metricExpr = this.getMetricExpression(metric);

    const result = await this.client.query({
      query: `
        WITH daily_metrics AS (
          SELECT
            campaign_id,
            date,
            ${metricExpr} AS metric_value
          FROM analytics.raw_ad_insights FINAL
          WHERE
            account_id = {accountId:UInt64}
            AND date >= today() - {baselineDays:UInt32}
          GROUP BY campaign_id, date
        ),
        with_stats AS (
          SELECT
            campaign_id,
            date,
            metric_value,
            avg(metric_value) OVER (
              PARTITION BY campaign_id
              ORDER BY date
              ROWS BETWEEN {baselineDays:UInt32} PRECEDING AND 1 PRECEDING
            ) AS baseline_mean,
            stddevPop(metric_value) OVER (
              PARTITION BY campaign_id
              ORDER BY date
              ROWS BETWEEN {baselineDays:UInt32} PRECEDING AND 1 PRECEDING
            ) AS baseline_std
          FROM daily_metrics
        )
        SELECT
          campaign_id,
          date,
          metric_value AS current_value,
          baseline_mean,
          baseline_std,
          if(
            baseline_std > 0,
            (metric_value - baseline_mean) / baseline_std,
            0
          ) AS z_score
        FROM with_stats
        WHERE
          date = today() - 1
          AND baseline_std > 0
          AND abs(if(baseline_std > 0, (metric_value - baseline_mean) / baseline_std, 0)) >= {warnThreshold:Float64}
        ORDER BY abs(z_score) DESC
      `,
      query_params: {
        accountId,
        baselineDays: ANOMALY_BASELINE_DAYS,
        warnThreshold: ANOMALY_Z_SCORE_WARNING,
      },
      format: 'JSONEachRow',
    });

    const rows = await result.json<{
      campaign_id: string;
      date: string;
      current_value: number;
      baseline_mean: number;
      baseline_std: number;
      z_score: number;
    }>();

    return rows.map((row) => ({
      campaignId: row.campaign_id,
      metric,
      currentValue: row.current_value,
      baselineMean: row.baseline_mean,
      baselineStdDev: row.baseline_std,
      zScore: row.z_score,
      severity:
        Math.abs(row.z_score) >= ANOMALY_Z_SCORE_CRITICAL
          ? 'critical'
          : 'warning',
      detectedAt: new Date(),
    }));
  }

  // IQR metóda — odolná voči outlierom (napr. Black Friday)
  async detectIQRAnomalies(
    accountId: number,
    campaignId: number,
    metric: string,
  ) {
    const metricExpr = this.getMetricExpression(metric);

    const result = await this.client.query({
      query: `
        WITH daily_values AS (
          SELECT
            date,
            ${metricExpr} AS metric_value
          FROM analytics.raw_ad_insights FINAL
          WHERE
            account_id = {accountId:UInt64}
            AND campaign_id = {campaignId:UInt64}
            AND date BETWEEN today() - 30 AND today() - 1
          GROUP BY date
          ORDER BY date
        ),
        quantiles AS (
          SELECT
            quantile(0.25)(metric_value) AS q1,
            quantile(0.75)(metric_value) AS q3
          FROM daily_values
        )
        SELECT
          d.date,
          d.metric_value,
          q.q1,
          q.q3,
          q.q3 - q.q1 AS iqr,
          q.q1 - 1.5 * (q.q3 - q.q1) AS lower_fence,
          q.q3 + 1.5 * (q.q3 - q.q1) AS upper_fence,
          d.metric_value < q.q1 - 1.5 * (q.q3 - q.q1)
            OR d.metric_value > q.q3 + 1.5 * (q.q3 - q.q1) AS is_outlier
        FROM daily_values d
        CROSS JOIN quantiles q
        WHERE d.date = today() - 1
      `,
      query_params: { accountId, campaignId },
      format: 'JSONEachRow',
    });

    return result.json();
  }

  // Uloženie detekovaných anomálií do logu
  async logAnomalies(anomalies: AnomalyDetectionResult[]): Promise<void> {
    if (anomalies.length === 0) return;

    await this.client.insert({
      table: 'analytics.anomaly_log',
      values: anomalies.map((a) => ({
        detected_at: a.detectedAt.toISOString().replace('T', ' ').split('.')[0],
        account_id: 0,
        campaign_id: parseInt(a.campaignId, 10) || 0,
        metric: a.metric,
        current_value: a.currentValue,
        baseline_mean: a.baselineMean,
        baseline_std: a.baselineStdDev,
        z_score: a.zScore,
        severity: a.severity,
      })),
      format: 'JSONEachRow',
    });
  }

  private getMetricExpression(metric: string): string {
    const expressions: Record<string, string> = {
      spend: 'sum(spend)',
      impressions: 'sum(impressions)',
      clicks: 'sum(clicks)',
      conversions: 'sum(conversions)',
      revenue: 'sum(revenue)',
      roas: 'if(sum(spend) > 0, sum(revenue) / sum(spend), 0)',
      cpa: 'if(sum(conversions) > 0, sum(spend) / sum(conversions), 0)',
      ctr: 'if(sum(impressions) > 0, sum(clicks) / sum(impressions) * 100, 0)',
      cpc: 'if(sum(clicks) > 0, sum(spend) / sum(clicks), 0)',
    };

    if (!expressions[metric]) {
      throw new Error(`Unknown metric: ${metric}`);
    }

    return expressions[metric];
  }
}
