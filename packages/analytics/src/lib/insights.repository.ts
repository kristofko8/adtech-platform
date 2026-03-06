import { ClickHouseClient } from '@clickhouse/client';
import { RawAdInsight } from '@adtech/shared-types';
import { getClickHouseClient } from './clickhouse.client.js';

export class InsightsRepository {
  private readonly client: ClickHouseClient;

  constructor(client?: ClickHouseClient) {
    this.client = client || getClickHouseClient();
  }

  /**
   * Batch insert insightov do ClickHouse.
   *
   * Používa async_insert + wait_for_async_insert=0 pre maximálny výkon:
   * - ClickHouse prijme dáta a vloží ich asynchrónne (neblokuje worker)
   * - Malé časti sa akumulujú v buffri a zapisujú naraz (menej partícií)
   * - Odporúčaná veľkosť chunku: 1 000–10 000 riadkov
   *
   * POZOR: wait_for_async_insert=0 znamená, že chyby insertu nie sú
   * okamžite reportované — monitoruj ClickHouse system.asynchronous_insert_log
   */
  async batchInsert(insights: RawAdInsight[]): Promise<void> {
    if (insights.length === 0) return;

    await this.client.insert({
      table: 'analytics.raw_ad_insights',
      values: insights,
      format: 'JSONEachRow',
      clickhouse_settings: {
        // Asynchrónny insert — ClickHouse bufferuje dáta a zapisuje naraz
        async_insert: 1,
        // Neblokujeme worker čakaním na potvrdenie insertu
        // (pre kritické dáta nastav na 1 — pomalšie, ale garantované)
        wait_for_async_insert: 0,
        // Maximálna veľkosť buffra pred vynútením flush
        async_insert_max_data_size: '10485760', // 10 MB
        // Maximálny čas čakania na flush (sekundy)
        async_insert_busy_timeout_ms: 1000,
      },
    });
  }

  /**
   * Synchronný batch insert pre kritické dáta (backfill, resync).
   * Čaká na potvrdenie insertu — pomalšie, ale garantované.
   */
  async batchInsertSync(insights: RawAdInsight[]): Promise<void> {
    if (insights.length === 0) return;

    await this.client.insert({
      table: 'analytics.raw_ad_insights',
      values: insights,
      format: 'JSONEachRow',
      clickhouse_settings: {
        async_insert: 0, // Synchrónny insert
      },
    });
  }

  // Načítanie výkonu za časové obdobie s FINAL kľúčovým slovom
  // (FINAL zabezpečí zlúčenie ReplacingMergeTree duplicít)
  async getAccountPerformance(
    accountId: number,
    dateFrom: string,
    dateTo: string,
  ) {
    const result = await this.client.query({
      query: `
        SELECT
          campaign_id,
          sum(impressions)  AS total_impressions,
          sum(clicks)       AS total_clicks,
          sum(spend)        AS total_spend,
          sum(conversions)  AS total_conversions,
          sum(revenue)      AS total_revenue,
          if(sum(impressions) > 0, sum(clicks) / sum(impressions) * 100, 0) AS ctr,
          if(sum(clicks) > 0, sum(spend) / sum(clicks), 0) AS avg_cpc,
          if(sum(spend) > 0, sum(revenue) / sum(spend), 0) AS roas,
          if(sum(conversions) > 0, sum(spend) / sum(conversions), 0) AS cpa
        FROM analytics.raw_ad_insights FINAL
        WHERE
          account_id = {accountId:UInt64}
          AND date BETWEEN {dateFrom:Date} AND {dateTo:Date}
        GROUP BY campaign_id
        ORDER BY total_spend DESC
      `,
      query_params: { accountId, dateFrom, dateTo },
      format: 'JSONEachRow',
    });

    return result.json();
  }

  // Časová rada pre dashboard grafy
  async getTimeSeries(
    accountId: number,
    campaignIds: number[],
    dateFrom: string,
    dateTo: string,
    metric: string = 'spend',
  ) {
    const result = await this.client.query({
      query: `
        SELECT
          date,
          campaign_id,
          sum(spend)        AS spend,
          sum(impressions)  AS impressions,
          sum(clicks)       AS clicks,
          sum(conversions)  AS conversions,
          sum(revenue)      AS revenue,
          if(sum(spend) > 0, sum(revenue) / sum(spend), 0) AS roas,
          if(sum(conversions) > 0, sum(spend) / sum(conversions), 0) AS cpa
        FROM analytics.raw_ad_insights FINAL
        WHERE
          account_id = {accountId:UInt64}
          AND campaign_id IN ({campaignIds:Array(UInt64)})
          AND date BETWEEN {dateFrom:Date} AND {dateTo:Date}
        GROUP BY date, campaign_id
        ORDER BY date ASC
      `,
      query_params: { accountId, campaignIds, dateFrom, dateTo },
      format: 'JSONEachRow',
    });

    return result.json();
  }

  // Z-skóre výpočet pre anomálie
  async getZScores(
    accountId: number,
    campaignId: number,
    metric: string,
    lookbackDays: number = 21,
  ) {
    const result = await this.client.query({
      query: `
        SELECT
          date,
          ${metric} AS metric_value,
          avg(${metric}) OVER w AS rolling_mean,
          stddevPop(${metric}) OVER w AS rolling_std,
          if(
            stddevPop(${metric}) OVER w > 0,
            (${metric} - avg(${metric}) OVER w) / stddevPop(${metric}) OVER w,
            0
          ) AS z_score
        FROM (
          SELECT
            date,
            sum(spend)        AS spend,
            sum(impressions)  AS impressions,
            sum(clicks)       AS clicks,
            sum(conversions)  AS conversions,
            if(sum(spend) > 0, sum(revenue) / sum(spend), 0) AS roas,
            if(sum(conversions) > 0, sum(spend) / sum(conversions), 0) AS cpa,
            if(sum(impressions) > 0, sum(clicks) / sum(impressions) * 100, 0) AS ctr
          FROM analytics.raw_ad_insights FINAL
          WHERE
            account_id = {accountId:UInt64}
            AND campaign_id = {campaignId:UInt64}
            AND date >= today() - {lookbackDays:UInt32}
          GROUP BY date
          ORDER BY date ASC
        )
        WINDOW w AS (ORDER BY date ROWS BETWEEN {lookbackDays:UInt32} PRECEDING AND 1 PRECEDING)
        ORDER BY date DESC
        LIMIT 30
      `,
      query_params: { accountId, campaignId, lookbackDays },
      format: 'JSONEachRow',
    });

    return result.json<{
      date: string;
      metric_value: number;
      rolling_mean: number;
      rolling_std: number;
      z_score: number;
    }>();
  }
}
