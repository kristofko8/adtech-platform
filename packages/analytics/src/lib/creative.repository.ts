import { ClickHouseClient } from '@clickhouse/client';
import { getClickHouseClient } from './clickhouse.client.js';
import {
  CREATIVE_HOOK_RATE_ELITE,
  CREATIVE_HOOK_RATE_STRONG,
  CREATIVE_HOOK_RATE_AVERAGE,
  CREATIVE_HOLD_RATE_ELITE,
  CREATIVE_HOLD_RATE_STRONG,
} from '@adtech/shared-types';

export type CreativePerformanceTier = 'elite' | 'strong' | 'average' | 'fix-it';

export interface CreativeInsight {
  creative_id: string;
  total_impressions: number;
  total_3s_views: number;
  total_thru_plays: number;
  total_spend: number;
  total_conversions: number;
  total_revenue: number;
  hook_rate: number;
  hold_rate: number;
  roas: number;
  cpa: number;
  performance_tier: CreativePerformanceTier;
}

function classifyTier(hookRate: number, holdRate: number): CreativePerformanceTier {
  if (hookRate >= CREATIVE_HOOK_RATE_ELITE && holdRate >= CREATIVE_HOLD_RATE_ELITE) return 'elite';
  if (hookRate >= CREATIVE_HOOK_RATE_STRONG && holdRate >= CREATIVE_HOLD_RATE_STRONG) return 'strong';
  if (hookRate >= CREATIVE_HOOK_RATE_AVERAGE) return 'average';
  return 'fix-it';
}

export class CreativeRepository {
  private readonly client: ClickHouseClient;

  constructor(client?: ClickHouseClient) {
    this.client = client || getClickHouseClient();
  }

  // Hook Rate a Hold Rate pre kreatívy s klasifikáciou
  async getCreativePerformance(
    accountId: number,
    dateFrom: string,
    dateTo: string,
  ): Promise<CreativeInsight[]> {
    const result = await this.client.query({
      query: `
        SELECT
          creative_id,
          sumMerge(total_impressions)   AS total_impressions,
          sumMerge(total_3s_views)      AS total_3s_views,
          sumMerge(total_thru_plays)    AS total_thru_plays,
          sumMerge(total_spend)         AS total_spend,
          sumMerge(total_conversions)   AS total_conversions,
          sumMerge(total_revenue)       AS total_revenue,
          if(sumMerge(total_impressions) > 0,
            sumMerge(total_3s_views) / sumMerge(total_impressions),
            0
          ) AS hook_rate,
          if(sumMerge(total_3s_views) > 0,
            sumMerge(total_thru_plays) / sumMerge(total_3s_views),
            0
          ) AS hold_rate,
          if(sumMerge(total_spend) > 0,
            sumMerge(total_revenue) / sumMerge(total_spend),
            0
          ) AS roas,
          if(sumMerge(total_conversions) > 0,
            sumMerge(total_spend) / sumMerge(total_conversions),
            0
          ) AS cpa
        FROM analytics.creative_performance_agg
        WHERE
          account_id = {accountId:UInt64}
          AND date BETWEEN {dateFrom:Date} AND {dateTo:Date}
        GROUP BY creative_id
        HAVING total_impressions > 100
        ORDER BY total_spend DESC
        LIMIT 200
      `,
      query_params: { accountId, dateFrom, dateTo },
      format: 'JSONEachRow',
    });

    const rows = await result.json<Omit<CreativeInsight, 'performance_tier'>>();

    return rows.map((row) => ({
      ...row,
      performance_tier: classifyTier(row.hook_rate, row.hold_rate),
    }));
  }

  // Top kreatívy za sledované obdobie (pre Scaling Winner detekciu)
  async getTopCreatives(
    accountId: number,
    dateFrom: string,
    dateTo: string,
    limit: number = 10,
  ) {
    const result = await this.client.query({
      query: `
        SELECT
          creative_id,
          sumMerge(total_spend) AS total_spend,
          sumMerge(total_revenue) AS total_revenue,
          sumMerge(total_conversions) AS total_conversions,
          if(sumMerge(total_spend) > 0,
            sumMerge(total_revenue) / sumMerge(total_spend), 0
          ) AS roas,
          if(sumMerge(total_impressions) > 0,
            sumMerge(total_3s_views) / sumMerge(total_impressions), 0
          ) AS hook_rate
        FROM analytics.creative_performance_agg
        WHERE
          account_id = {accountId:UInt64}
          AND date BETWEEN {dateFrom:Date} AND {dateTo:Date}
        GROUP BY creative_id
        HAVING total_spend > 10
        ORDER BY roas DESC, total_spend DESC
        LIMIT {limit:UInt32}
      `,
      query_params: { accountId, dateFrom, dateTo, limit },
      format: 'JSONEachRow',
    });

    return result.json();
  }

  // Detekcia kreatívnej únavy (fatigue)
  async detectCreativeFatigue(
    accountId: number,
    adId: number,
    creativeId: number,
  ) {
    const result = await this.client.query({
      query: `
        SELECT
          date,
          if(sum(impressions) > 0, sum(video_3s_views) / sum(impressions), 0) AS hook_rate,
          avg(frequency) AS avg_frequency,
          max(if(sum(impressions) > 0, sum(video_3s_views) / sum(impressions), 0))
            OVER (ORDER BY date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS max_hook_rate
        FROM analytics.raw_ad_insights FINAL
        WHERE
          account_id = {accountId:UInt64}
          AND ad_id = {adId:UInt64}
          AND creative_id = {creativeId:UInt64}
          AND date >= today() - 30
        GROUP BY date
        ORDER BY date ASC
      `,
      query_params: { accountId, adId, creativeId },
      format: 'JSONEachRow',
    });

    const rows = await result.json<{
      date: string;
      hook_rate: number;
      avg_frequency: number;
      max_hook_rate: number;
    }>();

    if (rows.length === 0) return null;

    const latest = rows[rows.length - 1];
    const hookRateDrop =
      latest.max_hook_rate > 0
        ? (latest.max_hook_rate - latest.hook_rate) / latest.max_hook_rate
        : 0;

    return {
      adId,
      creativeId,
      currentHookRate: latest.hook_rate,
      maxHookRate: latest.max_hook_rate,
      hookRateDropPercent: hookRateDrop * 100,
      currentFrequency: latest.avg_frequency,
      isFatigued: hookRateDrop > 0.2 && latest.avg_frequency > 3.5,
    };
  }
}
