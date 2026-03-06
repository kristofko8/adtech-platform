// ============================================================
// Typy pre analytické dáta (ClickHouse)
// ============================================================

export interface RawAdInsight {
  account_id: number;
  campaign_id: number;
  adset_id: number;
  ad_id: number;
  creative_id: number;
  date: string; // 'YYYY-MM-DD'
  impressions: number;
  clicks: number;
  spend: number;
  video_3s_views: number;
  thru_plays: number;
  conversions: number;
  revenue: number;
  updated_at: string;
  version: number;
}

export interface CreativePerformance {
  account_id: number;
  creative_id: number;
  date: string;
  total_impressions: number;
  total_3s_views: number;
  total_thru_plays: number;
  total_spend: number;
  total_conversions: number;
  // Vypočítané metriky
  hook_rate: number;   // total_3s_views / total_impressions
  hold_rate: number;   // total_thru_plays / total_3s_views
  roas: number;        // revenue / spend
  cpa: number;         // spend / conversions
}

export interface AnomalyDetectionResult {
  campaignId: string;
  metric: string;
  currentValue: number;
  baselineMean: number;
  baselineStdDev: number;
  zScore: number;
  severity: 'normal' | 'warning' | 'critical';
  detectedAt: Date;
}

export interface ZScoreWindow {
  metric: string;
  date: string;
  value: number;
  rollingMean: number;
  rollingStdDev: number;
  zScore: number;
}

export interface CreativeFatigueSignal {
  adId: string;
  creativeId: string;
  currentHookRate: number;
  maxHookRate: number;
  hookRateDropPercent: number;
  currentFrequency: number;
  isFatigued: boolean;
}

export type MetricKey = 'roas' | 'cpa' | 'ctr' | 'cpc' | 'cpm' | 'spend' | 'impressions' | 'clicks' | 'conversions';

export interface DashboardMetrics {
  totalSpend: number;
  totalRevenue: number;
  roas: number;
  totalConversions: number;
  cpa: number;
  impressions: number;
  clicks: number;
  ctr: number;
}
