import { MetaHttpClient } from './meta-http.client.js';
import { META_MAX_BATCH_SIZE } from '@adtech/shared-types';

export interface BatchRequest {
  method: 'GET' | 'POST' | 'DELETE';
  relative_url: string;
  body?: string;
}

export interface BatchResponse<T = unknown> {
  code: number;
  headers: Array<{ name: string; value: string }>;
  body: string;
  data?: T;
}

// ============================================================
// Batch API Service — konsolidácia Meta API volaní
// Ušetrí bodovú kvótu tým, že zlúči viacero volaní do jedného
// HTTP požiadavka. Max 50 požiadaviek v jednom batchi.
// ============================================================
export class BatchApiService {
  constructor(private readonly client: MetaHttpClient) {}

  async executeBatch<T>(requests: BatchRequest[]): Promise<BatchResponse<T>[]> {
    if (requests.length === 0) return [];

    const results: BatchResponse<T>[] = [];

    // Rozdelenie na chunks po MAX_BATCH_SIZE
    for (let i = 0; i < requests.length; i += META_MAX_BATCH_SIZE) {
      const chunk = requests.slice(i, i + META_MAX_BATCH_SIZE);
      const chunkResults = await this.executeSingleBatch<T>(chunk);
      results.push(...chunkResults);
    }

    return results;
  }

  private async executeSingleBatch<T>(
    requests: BatchRequest[],
  ): Promise<BatchResponse<T>[]> {
    const response = await this.client.post<BatchResponse<T>[]>('/', {
      batch: JSON.stringify(requests),
      include_headers: 'false', // Znižuje veľkosť odpovede
    });

    // Parsovanie JSON body v každej odpovedi
    return (Array.isArray(response) ? response : []).map((item) => {
      if (item.body && typeof item.body === 'string') {
        try {
          item.data = JSON.parse(item.body) as T;
        } catch {
          // Ignorovanie chyby parsingu
        }
      }
      return item;
    });
  }

  // Helper: vytvorenie GET batch požiadavky
  static makeGetRequest(path: string, params: Record<string, string> = {}): BatchRequest {
    const queryString = new URLSearchParams(params).toString();
    return {
      method: 'GET',
      relative_url: queryString ? `${path}?${queryString}` : path,
    };
  }

  // Helper: Batch načítanie insightov pre viacero kampaní
  static buildInsightsBatchRequests(
    campaignIds: string[],
    datePreset: string = 'last_7d',
    fields: string[] = ['impressions', 'clicks', 'spend', 'actions', 'action_values'],
  ): BatchRequest[] {
    return campaignIds.map((id) =>
      BatchApiService.makeGetRequest(`${id}/insights`, {
        date_preset: datePreset,
        fields: fields.join(','),
        level: 'campaign',
      }),
    );
  }
}
