import { z } from 'zod';

// ============================================================
// Meta API objekty - Zod schémy (Contract-First prístup)
// ============================================================

// Kampaň
export const MetaCampaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED']),
  effective_status: z.string(),
  objective: z.string(),
  buying_type: z.string().optional(),
  daily_budget: z.string().optional(),
  lifetime_budget: z.string().optional(),
  budget_remaining: z.string().optional(),
  start_time: z.string().optional(),
  stop_time: z.string().optional(),
  created_time: z.string(),
  updated_time: z.string(),
});

// Ad Set
export const MetaAdSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  campaign_id: z.string(),
  status: z.enum(['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED']),
  effective_status: z.string(),
  optimization_goal: z.string(),
  billing_event: z.string(),
  bid_strategy: z.string().optional(),
  daily_budget: z.string().optional(),
  lifetime_budget: z.string().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  targeting: z.record(z.unknown()).optional(),
  created_time: z.string(),
  updated_time: z.string(),
});

// Ad
export const MetaAdSchema = z.object({
  id: z.string(),
  name: z.string(),
  adset_id: z.string(),
  campaign_id: z.string(),
  status: z.enum(['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED', 'DISAPPROVED', 'PENDING_REVIEW']),
  effective_status: z.string(),
  creative: z.object({ id: z.string() }).optional(),
  created_time: z.string(),
  updated_time: z.string(),
});

// Ad Creative
export const MetaAdCreativeSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  image_hash: z.string().optional(),
  image_url: z.string().url().optional(),
  thumbnail_url: z.string().url().optional(),
  video_id: z.string().optional(),
  call_to_action_type: z.string().optional(),
  object_story_spec: z.record(z.unknown()).optional(),
  effective_object_story_id: z.string().optional(),
  created_time: z.string().optional(),
});

// Insights (metriky výkonu)
export const MetaInsightSchema = z.object({
  account_id: z.string(),
  campaign_id: z.string().optional(),
  adset_id: z.string().optional(),
  ad_id: z.string().optional(),
  date_start: z.string(),
  date_stop: z.string(),
  impressions: z.string().transform(Number),
  clicks: z.string().transform(Number),
  spend: z.string().transform(Number),
  reach: z.string().transform(Number).optional(),
  frequency: z.string().transform(Number).optional(),
  ctr: z.string().transform(Number).optional(),
  cpc: z.string().transform(Number).optional(),
  cpm: z.string().transform(Number).optional(),
  cpp: z.string().transform(Number).optional(),
  actions: z.array(z.object({
    action_type: z.string(),
    value: z.string().transform(Number),
  })).optional(),
  action_values: z.array(z.object({
    action_type: z.string(),
    value: z.string().transform(Number),
  })).optional(),
  video_p25_watched_actions: z.array(z.object({
    action_type: z.string(),
    value: z.string().transform(Number),
  })).optional(),
  video_p100_watched_actions: z.array(z.object({
    action_type: z.string(),
    value: z.string().transform(Number),
  })).optional(),
  video_play_actions: z.array(z.object({
    action_type: z.string(),
    value: z.string().transform(Number),
  })).optional(),
  video_thruplay_watched_actions: z.array(z.object({
    action_type: z.string(),
    value: z.string().transform(Number),
  })).optional(),
});

// Rate limit hlavičky z Meta API
export const MetaRateLimitHeaderSchema = z.object({
  call_count: z.number(),
  total_cputime: z.number(),
  total_time: z.number(),
  type: z.string(),
  estimated_time_to_regain_access: z.number().optional(),
});

// Typy odvodené zo schém
export type MetaCampaign = z.infer<typeof MetaCampaignSchema>;
export type MetaAdSet = z.infer<typeof MetaAdSetSchema>;
export type MetaAd = z.infer<typeof MetaAdSchema>;
export type MetaAdCreative = z.infer<typeof MetaAdCreativeSchema>;
export type MetaInsight = z.infer<typeof MetaInsightSchema>;
export type MetaRateLimitHeader = z.infer<typeof MetaRateLimitHeaderSchema>;
