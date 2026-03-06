// ============================================================
// Konštanty platformy
// ============================================================

// Meta API
export const META_API_VERSION = 'v21.0';
export const META_API_BASE_URL = 'https://graph.facebook.com';
export const META_RATE_LIMIT_SAFE_THRESHOLD = 0.8; // 80% kvóty = spomalenie
export const META_RATE_LIMIT_PAUSE_THRESHOLD = 0.95; // 95% = pauza
export const META_MAX_BATCH_SIZE = 50; // Max požiadaviek v jednom batch

// Atribučné okno
export const ATTRIBUTION_WINDOW_DAYS = 7;
export const IOS14_RESYNC_WINDOW_HOURS = 72;

// ClickHouse tabuľky
export const CH_TABLE_RAW_INSIGHTS = 'raw_ad_insights';
export const CH_TABLE_SKAN_INSIGHTS = 'skan_insights';
export const CH_TABLE_CREATIVE_PERFORMANCE = 'creative_performance_mv';
export const CH_DATABASE = 'analytics';

// Anomálie - Z-skóre prahy
export const ANOMALY_Z_SCORE_WARNING = 2.0;
export const ANOMALY_Z_SCORE_CRITICAL = 3.0;
export const ANOMALY_BASELINE_DAYS = 21;

// Creative Intelligence
export const CREATIVE_HOOK_RATE_ELITE = 0.45;
export const CREATIVE_HOOK_RATE_STRONG = 0.30;
export const CREATIVE_HOOK_RATE_AVERAGE = 0.20;
export const CREATIVE_HOLD_RATE_ELITE = 0.50;
export const CREATIVE_HOLD_RATE_STRONG = 0.40;
export const CREATIVE_HOLD_RATE_AVERAGE = 0.30;
export const CREATIVE_FATIGUE_FREQUENCY_THRESHOLD = 3.5;
export const CREATIVE_FATIGUE_HOOK_RATE_DROP = 0.20; // 20% pokles

// BullMQ fronty
export const QUEUE_ACCOUNT_DISCOVERY = 'account-discovery';
export const QUEUE_INSIGHTS_SYNC = 'insights-sync';
export const QUEUE_AUTOMATION_RULES = 'automation-rules';
export const QUEUE_MEDIA_PROXY = 'media-proxy';
export const QUEUE_CAPI_EVENTS = 'capi-events';

// Redis TTL (sekundy)
export const REDIS_TTL_CDN_URL = 172800;       // 48 hodín
export const REDIS_TTL_RATE_LIMIT = 60;        // 1 minúta (Meta reset window)
export const REDIS_TTL_SESSION = 604800;        // 7 dní

// CAPI
export const CAPI_EVENT_DEDUP_WINDOW_HOURS = 48;
export const CAPI_MIN_EMQ_SCORE = 6.0;
