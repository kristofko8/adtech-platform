import axios, { AxiosInstance, AxiosResponse } from 'axios';
import {
  canMakeRequest,
  updateRateLimit,
  setRateLimitPause,
  withExponentialBackoff,
  sleep,
} from './rate-limiter.js';
import { META_API_VERSION, META_API_BASE_URL } from '@adtech/shared-types';

export interface MetaClientConfig {
  accessToken: string;
  appSecretProof: string;
  accountId: string; // Pre sledovanie rate limitov
  apiVersion?: string;
  baseUrl?: string;
}

// ============================================================
// Meta HTTP Klient s integrovaným Rate Limiterom
// Toto je JEDINÝ vstupný bod pre Meta API volania
// ============================================================
export class MetaHttpClient {
  private readonly axios: AxiosInstance;
  private readonly accountId: string;
  private readonly accessToken: string;
  private readonly appSecretProof: string;

  constructor(config: MetaClientConfig) {
    this.accountId = config.accountId;
    this.accessToken = config.accessToken;
    this.appSecretProof = config.appSecretProof;

    this.axios = axios.create({
      baseURL: `${config.baseUrl || META_API_BASE_URL}/${config.apiVersion || META_API_VERSION}`,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    // Response interceptor — zachytávanie rate limit hlavičiek a chýb
    this.axios.interceptors.response.use(
      (response) => {
        this.handleRateLimitHeaders(response);
        return response;
      },
      async (error) => {
        if (error.response) {
          this.handleRateLimitHeaders(error.response);

          if (error.response.status === 429) {
            const resetTime = error.response.headers['x-app-usage-reset-time'];
            setRateLimitPause(this.accountId, resetTime ? parseInt(resetTime) * 1000 : 60000);
          }
        }
        throw error;
      },
    );
  }

  private handleRateLimitHeaders(response: AxiosResponse): void {
    const bucHeader = response.headers['x-business-use-case-usage'];
    const adAccountHeader = response.headers['x-ad-account-usage'];

    if (bucHeader) {
      try {
        const parsed = JSON.parse(bucHeader);
        const firstKey = Object.keys(parsed)[0];
        if (firstKey && parsed[firstKey][0]) {
          updateRateLimit(this.accountId, JSON.stringify(parsed[firstKey][0]));
        }
      } catch {
        // Ignorovanie chyby parsingu
      }
    }

    if (adAccountHeader) {
      updateRateLimit(this.accountId, adAccountHeader);
    }
  }

  // Hlavná GET metóda s automatickým rate limit checknutím
  async get<T>(endpoint: string, params: Record<string, any> = {}): Promise<T> {
    return withExponentialBackoff(async () => {
      const { allowed, delayMs, reason } = canMakeRequest(this.accountId);

      if (!allowed) {
        console.warn(`[MetaClient] Rate limit hit for account ${this.accountId}, reason: ${reason}. Waiting ${delayMs}ms`);
        await sleep(delayMs);
      } else if (delayMs > 0) {
        // Shaping mode
        await sleep(delayMs);
      }

      const response = await this.axios.get<T>(endpoint, {
        params: {
          access_token: this.accessToken,
          appsecret_proof: this.appSecretProof,
          ...params,
        },
      });

      return response.data;
    });
  }

  // POST pre mutácie (kampane, rozpočty atď.)
  async post<T>(endpoint: string, data: Record<string, any> = {}): Promise<T> {
    return withExponentialBackoff(async () => {
      const { allowed, delayMs } = canMakeRequest(this.accountId);

      if (!allowed) {
        await sleep(delayMs);
      }

      const response = await this.axios.post<T>(endpoint, null, {
        params: {
          access_token: this.accessToken,
          appsecret_proof: this.appSecretProof,
          ...data,
        },
      });

      return response.data;
    });
  }

  // Automatická paginácia cez cursor-based systém Meta
  async getAll<T>(
    endpoint: string,
    params: Record<string, any> = {},
    pageSize: number = 100,
  ): Promise<T[]> {
    const results: T[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.get<{
        data: T[];
        paging?: { cursors?: { after?: string }; next?: string };
      }>(endpoint, {
        ...params,
        limit: pageSize,
        after: cursor,
      });

      results.push(...(response.data || []));
      cursor = response.paging?.cursors?.after;

      // Zastavíme ak nie je ďalšia strana
      if (!response.paging?.next) {
        break;
      }
    } while (cursor);

    return results;
  }
}
