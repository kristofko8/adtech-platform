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

  // ── Hlavná detekcia anomálií (Z-skóre) ───────────────────────────────────

  /**
   * Detekuje anomálie pre všetky kampane účtu.
   * Používa predagregovanú tabuľku `campaign_metric_daily` namiesto
   * real-time WINDOW funkcií nad `raw_ad_insights` — ~10x rýchlejšie
   * pri miliónoch záznamov.
   */
  async detectAccountAnomalies(
    accountId: number,
    options: { seasonal?: boolean } = {},
  ): Promise<AnomalyDetectionResult[]> {
    const metrics = ['spend', 'roas', 'cpa', 'ctr'];
    const results: AnomalyDetectionResult[] = [];

    for (const metric of metrics) {
      const anomalies = options.seasonal
        ? await this.detectWithSeasonality(accountId, metric)
        : await this.detectMetricAnomalies(accountId, metric);

      results.push(...anomalies);
    }

    return results;
  }

  /**
   * Rýchla Z-skóre detekcia z predagregovanej tabuľky `campaign_metric_daily`.
   *
   * Nahradilo pôvodný prístup: raw_ad_insights FINAL + WINDOW funkcie
   * → teraz čítame z predagregovaných denných súm (100× menej dát).
   */
  async detectMetricAnomalies(
    accountId: number,
    metric: string,
  ): Promise<AnomalyDetectionResult[]> {
    this.validateMetric(metric);

    const result = await this.client.query({
      query: `
        WITH baseline AS (
          -- Vypočítaj baseline z predagregovanej tabuľky (nie raw_ad_insights)
          SELECT
            campaign_id,
            avg(${metric})    AS mean,
            stddevPop(${metric}) AS std
          FROM analytics.campaign_metric_daily FINAL
          WHERE
            account_id = {accountId:UInt64}
            AND date BETWEEN today() - {window:UInt32} - 1 AND today() - 2
            AND ${metric} > 0
          GROUP BY campaign_id
          HAVING count() >= 7  -- Minimálne 7 dní pre spoľahlivý baseline
        ),
        today_values AS (
          SELECT
            campaign_id,
            ${metric} AS current_value
          FROM analytics.campaign_metric_daily FINAL
          WHERE
            account_id = {accountId:UInt64}
            AND date = today() - 1
            AND ${metric} > 0
        )
        SELECT
          t.campaign_id,
          t.current_value,
          b.mean   AS baseline_mean,
          b.std    AS baseline_std,
          if(b.std > 0, (t.current_value - b.mean) / b.std, 0) AS z_score
        FROM today_values t
        INNER JOIN baseline b USING (campaign_id)
        WHERE
          b.std > 0
          AND abs(if(b.std > 0, (t.current_value - b.mean) / b.std, 0)) >= {warnThreshold:Float64}
        ORDER BY abs(z_score) DESC
        LIMIT 50
      `,
      query_params: {
        accountId,
        window: ANOMALY_BASELINE_DAYS,
        warnThreshold: ANOMALY_Z_SCORE_WARNING,
      },
      format: 'JSONEachRow',
    });

    const rows = await result.json<{
      campaign_id: string;
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
      severity: Math.abs(row.z_score) >= ANOMALY_Z_SCORE_CRITICAL ? 'critical' : 'warning',
      detectedAt: new Date(),
    }));
  }

  /**
   * Sezónne Z-skóre: porovnáva rovnaký deň týždňa (napr. Pondelok vs. Pondelok).
   *
   * Príklad: Dnešný pondelok vs. posledných N pondelkov.
   * Eliminuje šum z víkendovej vs. pracovnej sezónnosti.
   *
   * Implementácia:
   *   - day_of_week z campaign_metric_daily (toDayOfWeek: 1=Pon, 7=Ned)
   *   - Porovnávame len záznamy s rovnakým day_of_week
   *   - Minimálne 4 rovnaké dni v okne (≥ 4 týždne)
   */
  async detectWithSeasonality(
    accountId: number,
    metric: string,
  ): Promise<AnomalyDetectionResult[]> {
    this.validateMetric(metric);

    const result = await this.client.query({
      query: `
        WITH today_dow AS (
          SELECT toDayOfWeek(today() - 1) AS dow
        ),
        seasonal_baseline AS (
          -- Baseline len z rovnakého dňa v týždni
          SELECT
            campaign_id,
            avg(${metric})       AS mean,
            stddevPop(${metric}) AS std,
            count()              AS sample_count
          FROM analytics.campaign_metric_daily FINAL
          CROSS JOIN today_dow
          WHERE
            account_id = {accountId:UInt64}
            AND day_of_week = today_dow.dow
            AND date BETWEEN today() - 90 AND today() - 8  -- posledných 12 týždňov, vynechaj minulý týždeň
            AND ${metric} > 0
          GROUP BY campaign_id
          HAVING count() >= 4  -- min 4 rovnaké dni v týždni
        ),
        today_values AS (
          SELECT
            campaign_id,
            ${metric} AS current_value
          FROM analytics.campaign_metric_daily FINAL
          WHERE
            account_id = {accountId:UInt64}
            AND date = today() - 1
            AND ${metric} > 0
        )
        SELECT
          t.campaign_id,
          t.current_value,
          b.mean         AS baseline_mean,
          b.std          AS baseline_std,
          b.sample_count AS sample_count,
          if(b.std > 0, (t.current_value - b.mean) / b.std, 0) AS z_score
        FROM today_values t
        INNER JOIN seasonal_baseline b USING (campaign_id)
        WHERE
          b.std > 0
          AND abs(if(b.std > 0, (t.current_value - b.mean) / b.std, 0)) >= {warnThreshold:Float64}
        ORDER BY abs(z_score) DESC
        LIMIT 50
      `,
      query_params: {
        accountId,
        warnThreshold: ANOMALY_Z_SCORE_WARNING,
      },
      format: 'JSONEachRow',
    });

    const rows = await result.json<{
      campaign_id: string;
      current_value: number;
      baseline_mean: number;
      baseline_std: number;
      sample_count: number;
      z_score: number;
    }>();

    return rows.map((row) => ({
      campaignId: row.campaign_id,
      metric: `${metric}_seasonal`,
      currentValue: row.current_value,
      baselineMean: row.baseline_mean,
      baselineStdDev: row.baseline_std,
      zScore: row.z_score,
      severity: Math.abs(row.z_score) >= ANOMALY_Z_SCORE_CRITICAL ? 'critical' : 'warning',
      detectedAt: new Date(),
    }));
  }

  /**
   * IQR metóda (Interquartile Range) — odolná voči outlierom.
   * Vhodná pre Black Friday, sviatky kde Z-skóre generuje falošné alarmy.
   * Teraz tiež používa campaign_metric_daily namiesto raw_ad_insights.
   */
  async detectIQRAnomalies(
    accountId: number,
    campaignId: number,
    metric: string,
  ) {
    this.validateMetric(metric);

    const result = await this.client.query({
      query: `
        WITH daily_values AS (
          -- Predagregované hodnoty — rýchle, bez FINAL skenu
          SELECT date, ${metric} AS metric_value
          FROM analytics.campaign_metric_daily FINAL
          WHERE
            account_id = {accountId:UInt64}
            AND campaign_id = {campaignId:UInt64}
            AND date BETWEEN today() - 30 AND today() - 1
            AND ${metric} > 0
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
          q.q3 - q.q1                     AS iqr,
          q.q1 - 1.5 * (q.q3 - q.q1)     AS lower_fence,
          q.q3 + 1.5 * (q.q3 - q.q1)     AS upper_fence,
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

  /**
   * Uloženie detekovaných anomálií do logu.
   */
  async logAnomalies(
    anomalies: AnomalyDetectionResult[],
    accountId: number,
  ): Promise<void> {
    if (anomalies.length === 0) return;

    await this.client.insert({
      table: 'analytics.anomaly_log',
      values: anomalies.map((a) => ({
        detected_at: a.detectedAt.toISOString().replace('T', ' ').split('.')[0],
        account_id: accountId,
        campaign_id: parseInt(a.campaignId, 10) || 0,
        metric: a.metric,
        current_value: a.currentValue,
        baseline_mean: a.baselineMean,
        baseline_std: a.baselineStdDev,
        z_score: a.zScore,
        severity: a.severity,
        day_of_week: new Date().getDay() || 7, // ISO: 0→7 pre nedeľu
      })),
      format: 'JSONEachRow',
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
    });
  }

  /**
   * Načíta posledné anomálie z logu (pre dashboard).
   */
  async getRecentAnomalies(
    accountId: number,
    hoursBack = 24,
    limit = 50,
  ): Promise<Array<{
    detected_at: string;
    campaign_id: string;
    metric: string;
    current_value: number;
    baseline_mean: number;
    z_score: number;
    severity: string;
  }>> {
    const result = await this.client.query({
      query: `
        SELECT
          formatDateTime(detected_at, '%Y-%m-%dT%H:%i:%sZ') AS detected_at,
          toString(campaign_id) AS campaign_id,
          metric,
          current_value,
          baseline_mean,
          z_score,
          severity
        FROM analytics.anomaly_log
        WHERE
          account_id = {accountId:UInt64}
          AND detected_at >= now() - INTERVAL {hoursBack:UInt32} HOUR
        ORDER BY detected_at DESC
        LIMIT {limit:UInt32}
      `,
      query_params: { accountId, hoursBack, limit },
      format: 'JSONEachRow',
    });

    return result.json();
  }

  private validateMetric(metric: string): void {
    const ALLOWED = new Set(['spend', 'revenue', 'impressions', 'clicks', 'conversions', 'roas', 'cpa', 'ctr']);
    if (!ALLOWED.has(metric)) {
      throw new Error(`Neznáma metrika: "${metric}". Povolené: ${[...ALLOWED].join(', ')}`);
    }
  }
}
