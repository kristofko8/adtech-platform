import { ClickHouseClient } from '@clickhouse/client';

// ============================================================
// ClickHouse DDL migrácie pre AdTech analytiku
// ============================================================

export async function runMigrations(client: ClickHouseClient): Promise<void> {
  console.log('Running ClickHouse migrations...');

  // 1. Vytvorenie databázy
  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS analytics`,
  });

  // 2. Hlavná tabuľka pre surové insighty
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS analytics.raw_ad_insights (
        account_id    UInt64,
        campaign_id   UInt64,
        adset_id      UInt64,
        ad_id         UInt64,
        creative_id   UInt64,
        date          Date,
        impressions   UInt32  CODEC(Delta, ZSTD(3)),
        clicks        UInt32  CODEC(Delta, ZSTD(3)),
        spend         Float64 CODEC(Gorilla, ZSTD(3)),
        reach         UInt32  CODEC(Delta, ZSTD(3)),
        frequency     Float32 CODEC(Gorilla, ZSTD(3)),
        ctr           Float32 CODEC(Gorilla, ZSTD(3)),
        cpc           Float32 CODEC(Gorilla, ZSTD(3)),
        cpm           Float32 CODEC(Gorilla, ZSTD(3)),
        video_3s_views  UInt32 CODEC(Delta, ZSTD(3)),
        thru_plays      UInt32 CODEC(Delta, ZSTD(3)),
        conversions     UInt32 CODEC(Delta, ZSTD(3)),
        revenue         Float64 CODEC(Gorilla, ZSTD(3)),
        platform        LowCardinality(String) DEFAULT '',
        currency        LowCardinality(String) DEFAULT 'USD',
        updated_at      DateTime DEFAULT now(),
        version         UInt64
      )
      ENGINE = ReplacingMergeTree(version)
      PARTITION BY toYYYYMM(date)
      ORDER BY (account_id, date, campaign_id, adset_id, ad_id)
      SETTINGS
        index_granularity = 8192,
        -- Async insert nastavenia na úrovni tabuľky (ClickHouse 22.8+)
        -- Akumuluje malé inserty a zapisuje ich naraz — menej partícií
        async_insert = 1,
        async_insert_max_data_size = 10485760, -- 10 MB flush trigger
        async_insert_busy_timeout_ms = 1000    -- Max 1s čakania pred flush
    `,
  });

  // 3. SKAdNetwork tabuľka (iOS 14+)
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS analytics.skan_insights (
        account_id               UInt64,
        campaign_id              UInt64,
        ad_id                    UInt64,
        date                     Date,
        skan_conversion_value    UInt8,
        installs                 UInt32 CODEC(Delta, ZSTD(3)),
        re_engagements           UInt32 CODEC(Delta, ZSTD(3)),
        mode                     Enum8('AggregatedEventMeasurement' = 1, 'SKAdNetwork' = 2),
        updated_at               DateTime DEFAULT now(),
        version                  UInt64
      )
      ENGINE = ReplacingMergeTree(version)
      PARTITION BY toYYYYMM(date)
      ORDER BY (account_id, date, campaign_id, ad_id)
      SETTINGS index_granularity = 8192
    `,
  });

  // 4. Materialized View pre agregáciu kreatív
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS analytics.creative_performance_agg (
        account_id          UInt64,
        creative_id         UInt64,
        date                Date,
        total_impressions   AggregateFunction(sum, UInt32),
        total_3s_views      AggregateFunction(sum, UInt32),
        total_thru_plays    AggregateFunction(sum, UInt32),
        total_spend         AggregateFunction(sum, Float64),
        total_conversions   AggregateFunction(sum, UInt32),
        total_revenue       AggregateFunction(sum, Float64),
        total_clicks        AggregateFunction(sum, UInt32)
      )
      ENGINE = AggregatingMergeTree()
      PARTITION BY toYYYYMM(date)
      ORDER BY (account_id, creative_id, date)
    `,
  });

  await client.command({
    query: `
      CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.creative_performance_mv
      TO analytics.creative_performance_agg
      AS SELECT
        account_id,
        creative_id,
        date,
        sumState(impressions)   AS total_impressions,
        sumState(video_3s_views) AS total_3s_views,
        sumState(thru_plays)    AS total_thru_plays,
        sumState(spend)         AS total_spend,
        sumState(conversions)   AS total_conversions,
        sumState(revenue)       AS total_revenue,
        sumState(clicks)        AS total_clicks
      FROM analytics.raw_ad_insights
      GROUP BY account_id, creative_id, date
    `,
  });

  // 5. Denné sumáre kampaní (pre rýchle dashboardy)
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS analytics.campaign_daily_agg (
        account_id      UInt64,
        campaign_id     UInt64,
        date            Date,
        total_impressions AggregateFunction(sum, UInt32),
        total_clicks    AggregateFunction(sum, UInt32),
        total_spend     AggregateFunction(sum, Float64),
        total_conversions AggregateFunction(sum, UInt32),
        total_revenue   AggregateFunction(sum, Float64),
        avg_frequency   AggregateFunction(avg, Float32)
      )
      ENGINE = AggregatingMergeTree()
      PARTITION BY toYYYYMM(date)
      ORDER BY (account_id, campaign_id, date)
    `,
  });

  await client.command({
    query: `
      CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.campaign_daily_mv
      TO analytics.campaign_daily_agg
      AS SELECT
        account_id,
        campaign_id,
        date,
        sumState(impressions)   AS total_impressions,
        sumState(clicks)        AS total_clicks,
        sumState(spend)         AS total_spend,
        sumState(conversions)   AS total_conversions,
        sumState(revenue)       AS total_revenue,
        avgState(frequency)     AS avg_frequency
      FROM analytics.raw_ad_insights
      GROUP BY account_id, campaign_id, date
    `,
  });

  // 6. Anomálie log tabuľka
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS analytics.anomaly_log (
        detected_at   DateTime,
        account_id    UInt64,
        campaign_id   UInt64,
        metric        LowCardinality(String),
        current_value Float64,
        baseline_mean Float64,
        baseline_std  Float64,
        z_score       Float64,
        severity      LowCardinality(String)
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(detected_at)
      ORDER BY (account_id, detected_at)
      TTL detected_at + INTERVAL 90 DAY
    `,
  });

  console.log('ClickHouse migrations completed successfully');
}
