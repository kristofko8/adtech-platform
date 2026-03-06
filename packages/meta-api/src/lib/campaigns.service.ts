import { MetaHttpClient } from './meta-http.client.js';
import { MetaCampaignSchema, MetaAdSetSchema, MetaAdSchema, type MetaCampaign, type MetaAdSet, type MetaAd } from '@adtech/shared-types';

const CAMPAIGN_FIELDS = [
  'id', 'name', 'status', 'effective_status', 'objective',
  'buying_type', 'daily_budget', 'lifetime_budget', 'budget_remaining',
  'start_time', 'stop_time', 'created_time', 'updated_time',
].join(',');

const ADSET_FIELDS = [
  'id', 'name', 'campaign_id', 'status', 'effective_status',
  'optimization_goal', 'billing_event', 'bid_strategy',
  'daily_budget', 'lifetime_budget', 'start_time', 'end_time',
  'targeting', 'created_time', 'updated_time',
].join(',');

const AD_FIELDS = [
  'id', 'name', 'adset_id', 'campaign_id', 'status',
  'effective_status', 'creative', 'created_time', 'updated_time',
].join(',');

export class CampaignsService {
  constructor(private readonly client: MetaHttpClient) {}

  async getCampaigns(accountId: string): Promise<MetaCampaign[]> {
    const raw = await this.client.getAll<unknown>(
      `${accountId}/campaigns`,
      { fields: CAMPAIGN_FIELDS, effective_status: ['ACTIVE', 'PAUSED'] },
    );

    return raw.map((item) => MetaCampaignSchema.parse(item));
  }

  async getAdSets(campaignId: string): Promise<MetaAdSet[]> {
    const raw = await this.client.getAll<unknown>(
      `${campaignId}/adsets`,
      { fields: ADSET_FIELDS },
    );

    return raw.map((item) => MetaAdSetSchema.parse(item));
  }

  async getAds(adSetId: string): Promise<MetaAd[]> {
    const raw = await this.client.getAll<unknown>(
      `${adSetId}/ads`,
      { fields: AD_FIELDS },
    );

    return raw.map((item) => MetaAdSchema.parse(item));
  }

  async getAllAdsForAccount(accountId: string): Promise<MetaAd[]> {
    const raw = await this.client.getAll<unknown>(
      `${accountId}/ads`,
      { fields: AD_FIELDS, effective_status: ['ACTIVE', 'PAUSED'] },
    );

    return raw.map((item) => MetaAdSchema.parse(item));
  }

  // Zmena statusu kampane (pre Rule Engine)
  async updateCampaignStatus(
    campaignId: string,
    status: 'ACTIVE' | 'PAUSED',
  ): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(campaignId, { status });
  }

  // Aktualizácia denného rozpočtu (pre Scaling Winner pravidlo)
  async updateAdSetBudget(
    adSetId: string,
    dailyBudget: number,
  ): Promise<{ success: boolean }> {
    return this.client.post<{ success: boolean }>(adSetId, {
      daily_budget: Math.round(dailyBudget * 100), // Meta akceptuje v centoch
    });
  }
}
