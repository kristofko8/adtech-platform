/**
 * API klient pre AdTech backend (NestJS)
 * Používa Next.js Server Components — volania sa dejú server-side
 */

const API_BASE = process.env['API_BASE_URL'] ?? 'http://localhost:3000/api/v1';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    next: { revalidate: 60 }, // ISR: 60s cache pre dashboard dáta
    ...init,
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${path}`);
  }

  return res.json() as Promise<T>;
}

// ── Typy ─────────────────────────────────────────────────────────────────────

export interface AccountKpis {
  totalSpend: number;
  totalRevenue: number;
  roas: number;
  cpa: number;
  totalImpressions: number;
  totalClicks: number;
  ctr: number;
  currency: string;
}

export interface SpendDataPoint {
  date: string;
  spend: number;
  revenue: number;
  roas: number;
}

export type CreativeTier = 'elite' | 'strong' | 'average' | 'fix-it';

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
  performance_tier: CreativeTier;
  thumbnail_url?: string;
  ad_name?: string;
  // WoW porovnanie (voliteľné — keď API vracia porovnanie periód)
  wow_roas_change?: number;     // napr. +0.34 = ROAS stúplo o 0.34
  wow_spend_change?: number;    // napr. -0.12 = výdavky klesli o 12%
}

// Porovnanie period pre ComparisonChart
export interface CreativePeriodComparison {
  creative_id: string;
  ad_name?: string;
  current: { hook_rate: number; hold_rate: number; roas: number; cpa: number; spend: number };
  previous: { hook_rate: number; hold_rate: number; roas: number; cpa: number; spend: number };
}

// Stav BullMQ front (pre admin monitoring)
export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  isPaused: boolean;
}

export interface QueueJobCounts {
  queues: QueueStats[];
  fetchedAt: string;
}

export type AnomalySeverity = 'WARNING' | 'CRITICAL';

export interface AnomalyRecord {
  detected_at: string;
  account_id: number;
  campaign_id: number;
  campaign_name?: string;
  metric: string;
  current_value: number;
  baseline_mean: number;
  baseline_std: number;
  z_score: number;
  severity: AnomalySeverity;
}

export interface EmqStatus {
  pixel_id: string;
  pixel_name: string;
  emq_score: number | null;
  last_checked_at: string | null;
  status: 'ok' | 'warning' | 'critical' | 'unknown';
  events_received_24h: number;
  match_rate?: number;
}

// ── API metódy ────────────────────────────────────────────────────────────────

export async function getAccountKpis(
  accountId: string,
  dateFrom: string,
  dateTo: string,
): Promise<AccountKpis> {
  return apiFetch(`/analytics/accounts/${accountId}/kpis?dateFrom=${dateFrom}&dateTo=${dateTo}`);
}

export async function getSpendTimeSeries(
  accountId: string,
  dateFrom: string,
  dateTo: string,
): Promise<SpendDataPoint[]> {
  return apiFetch(
    `/analytics/accounts/${accountId}/timeseries?dateFrom=${dateFrom}&dateTo=${dateTo}&metric=spend`,
  );
}

export async function getCreativeInsights(
  accountId: string,
  dateFrom: string,
  dateTo: string,
): Promise<CreativeInsight[]> {
  return apiFetch(
    `/analytics/accounts/${accountId}/creatives?dateFrom=${dateFrom}&dateTo=${dateTo}`,
  );
}

export async function getAnomalies(
  accountId: string,
  limit = 50,
): Promise<AnomalyRecord[]> {
  return apiFetch(`/analytics/accounts/${accountId}/anomalies?limit=${limit}`);
}

export async function getEmqStatuses(accountId: string): Promise<EmqStatus[]> {
  return apiFetch(`/capi/accounts/${accountId}/emq`);
}

export async function getCreativePeriodComparison(
  accountId: string,
  dateFrom: string,
  dateTo: string,
): Promise<CreativePeriodComparison[]> {
  return apiFetch(
    `/analytics/accounts/${accountId}/creatives/compare?dateFrom=${dateFrom}&dateTo=${dateTo}`,
  );
}

export async function getQueueStats(): Promise<QueueJobCounts> {
  return apiFetch('/admin/queues/stats');
}

// ── Mock dáta pre dev (keď API nie je dostupné) ───────────────────────────────

export function getMockKpis(): AccountKpis {
  return {
    totalSpend: 48_230,
    totalRevenue: 193_540,
    roas: 4.01,
    cpa: 18.4,
    totalImpressions: 2_840_000,
    totalClicks: 142_000,
    ctr: 5.0,
    currency: 'EUR',
  };
}

export function getMockTimeSeries(): SpendDataPoint[] {
  const data: SpendDataPoint[] = [];
  const base = new Date();
  base.setDate(base.getDate() - 29);

  for (let i = 0; i < 30; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    const spend = 1400 + Math.sin(i * 0.4) * 400 + Math.random() * 300;
    const roas = 3.5 + Math.sin(i * 0.3) * 0.8 + Math.random() * 0.4;
    data.push({
      date: d.toISOString().split('T')[0],
      spend: Math.round(spend),
      revenue: Math.round(spend * roas),
      roas: parseFloat(roas.toFixed(2)),
    });
  }

  return data;
}

export function getMockCreatives(): CreativeInsight[] {
  return [
    { creative_id: '1001', total_impressions: 420000, total_3s_views: 210000, total_thru_plays: 126000, total_spend: 8200, total_conversions: 410, total_revenue: 38000, hook_rate: 0.50, hold_rate: 0.60, roas: 4.63, cpa: 20.0, performance_tier: 'elite', ad_name: 'Produktové video — UGC štýl Q1', wow_roas_change: 0.31, wow_spend_change: 0.18 },
    { creative_id: '1002', total_impressions: 380000, total_3s_views: 152000, total_thru_plays: 76000, total_spend: 7100, total_conversions: 341, total_revenue: 28400, hook_rate: 0.40, hold_rate: 0.50, roas: 4.00, cpa: 20.8, performance_tier: 'strong', ad_name: 'Benefit carousel — 5 slides', wow_roas_change: 0.12, wow_spend_change: 0.07 },
    { creative_id: '1003', total_impressions: 290000, total_3s_views: 75400, total_thru_plays: 27000, total_spend: 5400, total_conversions: 189, total_revenue: 16800, hook_rate: 0.26, hold_rate: 0.36, roas: 3.11, cpa: 28.6, performance_tier: 'average', ad_name: 'Static banner — summer 2024', wow_roas_change: -0.09, wow_spend_change: -0.05 },
    { creative_id: '1004', total_impressions: 180000, total_3s_views: 32400, total_thru_plays: 8100, total_spend: 4200, total_conversions: 63, total_revenue: 9100, hook_rate: 0.18, hold_rate: 0.25, roas: 2.17, cpa: 66.7, performance_tier: 'fix-it', ad_name: 'Testimonial video — generic', wow_roas_change: -0.44, wow_spend_change: -0.20 },
    { creative_id: '1005', total_impressions: 510000, total_3s_views: 234600, total_thru_plays: 140800, total_spend: 9800, total_conversions: 520, total_revenue: 44800, hook_rate: 0.46, hold_rate: 0.60, roas: 4.57, cpa: 18.8, performance_tier: 'elite', ad_name: 'Before/After — skincare results', wow_roas_change: 0.22, wow_spend_change: 0.31 },
    { creative_id: '1006', total_impressions: 150000, total_3s_views: 37500, total_thru_plays: 15000, total_spend: 3100, total_conversions: 78, total_revenue: 12500, hook_rate: 0.25, hold_rate: 0.40, roas: 4.03, cpa: 39.7, performance_tier: 'average', ad_name: 'Brand awareness loop — 15s', wow_roas_change: 0.41, wow_spend_change: 0.09 },
  ];
}

export function getMockCreativeComparison(): CreativePeriodComparison[] {
  return [
    {
      creative_id: '1005',
      ad_name: 'Before/After — skincare',
      current:  { hook_rate: 0.46, hold_rate: 0.60, roas: 4.57, cpa: 18.8, spend: 9800 },
      previous: { hook_rate: 0.35, hold_rate: 0.48, roas: 3.35, cpa: 24.1, spend: 7500 },
    },
    {
      creative_id: '1001',
      ad_name: 'UGC štýl Q1',
      current:  { hook_rate: 0.50, hold_rate: 0.60, roas: 4.63, cpa: 20.0, spend: 8200 },
      previous: { hook_rate: 0.44, hold_rate: 0.55, roas: 4.32, cpa: 21.8, spend: 6950 },
    },
    {
      creative_id: '1002',
      ad_name: 'Benefit carousel',
      current:  { hook_rate: 0.40, hold_rate: 0.50, roas: 4.00, cpa: 20.8, spend: 7100 },
      previous: { hook_rate: 0.37, hold_rate: 0.47, roas: 3.88, cpa: 22.0, spend: 6640 },
    },
  ];
}

export function getMockQueueStats(): QueueJobCounts {
  return {
    queues: [
      { name: 'account-discovery', waiting: 0, active: 1, completed: 842, failed: 3, delayed: 0, paused: false, isPaused: false },
      { name: 'insights-sync',     waiting: 4, active: 2, completed: 7218, failed: 12, delayed: 8, paused: false, isPaused: false },
      { name: 'creative-sync',     waiting: 1, active: 0, completed: 419, failed: 0, delayed: 1, paused: false, isPaused: false },
    ],
    fetchedAt: new Date().toISOString(),
  };
}

export function getMockAnomalies(): AnomalyRecord[] {
  return [
    { detected_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), account_id: 123456, campaign_id: 555001, campaign_name: 'Retargeting — All visitors', metric: 'cpa', current_value: 68.2, baseline_mean: 22.4, baseline_std: 5.1, z_score: 8.98, severity: 'CRITICAL' },
    { detected_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), account_id: 123456, campaign_id: 555002, campaign_name: 'Prospecting — Lookalike 3%', metric: 'roas', current_value: 1.2, baseline_mean: 3.8, baseline_std: 0.6, z_score: -4.33, severity: 'CRITICAL' },
    { detected_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), account_id: 123456, campaign_id: 555003, campaign_name: 'Brand Awareness — Video views', metric: 'spend', current_value: 8400, baseline_mean: 5200, baseline_std: 980, z_score: 3.27, severity: 'WARNING' },
    { detected_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), account_id: 123456, campaign_id: 555004, campaign_name: 'DPA — Product catalog', metric: 'ctr', current_value: 0.8, baseline_mean: 2.4, baseline_std: 0.4, z_score: -4.0, severity: 'WARNING' },
  ];
}

export function getMockEmqStatuses(): EmqStatus[] {
  return [
    { pixel_id: '111111111', pixel_name: 'Hlavný pixel — shop', emq_score: 8.7, last_checked_at: new Date().toISOString(), status: 'ok', events_received_24h: 4240, match_rate: 0.91 },
    { pixel_id: '222222222', pixel_name: 'Pixel — landing page', emq_score: 5.2, last_checked_at: new Date(Date.now() - 30 * 60000).toISOString(), status: 'warning', events_received_24h: 890, match_rate: 0.67 },
    { pixel_id: '333333333', pixel_name: 'Pixel — blog', emq_score: null, last_checked_at: null, status: 'unknown', events_received_24h: 0 },
  ];
}
