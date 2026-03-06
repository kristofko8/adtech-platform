import { MetaHttpClient } from './meta-http.client.js';
import { MetaInsightSchema, type MetaInsight } from '@adtech/shared-types';

// Polia, ktoré sťahujeme pre každý insight record
const INSIGHT_FIELDS = [
  'account_id', 'campaign_id', 'adset_id', 'ad_id',
  'date_start', 'date_stop',
  'impressions', 'clicks', 'spend', 'reach', 'frequency',
  'ctr', 'cpc', 'cpm', 'cpp',
  'actions', 'action_values',
  'video_p25_watched_actions',
  'video_p100_watched_actions',
  'video_play_actions',
  'video_thruplay_watched_actions',
].join(',');

export interface InsightsQueryParams {
  dateFrom: string;   // YYYY-MM-DD
  dateTo: string;     // YYYY-MM-DD
  level?: 'account' | 'campaign' | 'adset' | 'ad';
  breakdowns?: string[];
  timeIncrement?: number; // 1 = denné, 7 = týždenné
}

export class InsightsService {
  constructor(private readonly client: MetaHttpClient) {}

  async getInsights(
    objectId: string,
    params: InsightsQueryParams,
  ): Promise<MetaInsight[]> {
    const raw = await this.client.getAll<unknown>(
      `${objectId}/insights`,
      {
        fields: INSIGHT_FIELDS,
        time_range: JSON.stringify({ since: params.dateFrom, until: params.dateTo }),
        level: params.level || 'ad',
        time_increment: params.timeIncrement || 1,
        breakdowns: params.breakdowns?.join(',') || undefined,
        limit: 500,
      },
    );

    return raw.map((item) => MetaInsightSchema.parse(item));
  }

  // Asynchrónny report pre veľké objemy dát
  async createAsyncReport(
    accountId: string,
    params: InsightsQueryParams,
  ): Promise<string> {
    const response = await this.client.post<{ report_run_id: string }>(
      `${accountId}/insights`,
      {
        fields: INSIGHT_FIELDS,
        time_range: JSON.stringify({ since: params.dateFrom, until: params.dateTo }),
        level: params.level || 'ad',
        time_increment: 1,
        async: true,
      },
    );

    return response.report_run_id;
  }

  // Kontrola stavu asynchrónneho reportu
  async checkReportStatus(reportRunId: string): Promise<{
    status: 'Job Not Started' | 'Job Running' | 'Job Failed' | 'Job Completed';
    percentComplete: number;
  }> {
    const response = await this.client.get<{
      async_status: string;
      async_percent_completion: number;
    }>(reportRunId);

    return {
      status: response.async_status as any,
      percentComplete: response.async_percent_completion,
    };
  }

  // Načítanie výsledkov dokončeného asynchrónneho reportu
  async getAsyncReportResults(reportRunId: string): Promise<MetaInsight[]> {
    const raw = await this.client.getAll<unknown>(`${reportRunId}/insights`);
    return raw.map((item) => MetaInsightSchema.parse(item));
  }

  // Konverzia Meta actions array na prázdny objekt pre jednoduchšie spracovanie
  extractActionValue(
    insight: MetaInsight,
    actionType: string,
  ): number {
    const action = insight.actions?.find((a) => a.action_type === actionType);
    return action ? action.value : 0;
  }

  extractRevenue(insight: MetaInsight): number {
    const purchaseValue = insight.action_values?.find(
      (a) => a.action_type === 'offsite_conversion.fb_pixel_purchase',
    );
    return purchaseValue ? purchaseValue.value : 0;
  }

  extractConversions(insight: MetaInsight): number {
    return this.extractActionValue(
      insight,
      'offsite_conversion.fb_pixel_purchase',
    );
  }

  extract3sVideoViews(insight: MetaInsight): number {
    const action = insight.video_play_actions?.find(
      (a) => a.action_type === 'video_view',
    );
    return action ? action.value : 0;
  }

  extractThruPlays(insight: MetaInsight): number {
    const action = insight.video_thruplay_watched_actions?.find(
      (a) => a.action_type === 'video_view',
    );
    return action ? action.value : 0;
  }
}
