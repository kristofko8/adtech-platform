import axios, { AxiosInstance, AxiosResponse } from 'axios';
import {
  RedisRateLimiter,
  withExponentialBackoff,
  sleep,
  parseRateLimitHeader,
} from './rate-limiter.redis.js';
import { META_API_VERSION, META_API_BASE_URL } from '@adtech/shared-types';

export interface MetaClientConfig {
  accessToken: string;
  appSecretProof: string;
  accountId: string;
  apiVersion?: string;
  baseUrl?: string;
  /**
   * Redis rate limiter inštancia (distribuovaná).
   * Ak nie je poskytnutá, rate limiting je deaktivovaný (vhodné pre unit testy).
   */
  rateLimiter?: RedisRateLimiter;
}

// ============================================================
// Meta HTTP Klient s distribuovaným Redis Rate Limiterom
//
// JEDINÝ vstupný bod pre Meta API volania. Každý worker
// zdieľa rate-limit stav cez Redis — žiadne in-memory stavy.
// ============================================================
export class MetaHttpClient {
  private readonly axios: AxiosInstance;
  private readonly accountId: string;
  private readonly accessToken: string;
  private readonly appSecretProof: string;
  private readonly rateLimiter?: RedisRateLimiter;

  constructor(config: MetaClientConfig) {
    this.accountId = config.accountId;
    this.accessToken = config.accessToken;
    this.appSecretProof = config.appSecretProof;
    this.rateLimiter = config.rateLimiter;

    this.axios = axios.create({
      baseURL: `${config.baseUrl || META_API_BASE_URL}/${config.apiVersion || META_API_VERSION}`,
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    // Response interceptor — zachytávanie rate limit hlavičiek
    this.axios.interceptors.response.use(
      async (response) => {
        await this.handleRateLimitHeaders(response);
        return response;
      },
      async (error) => {
        if (error.response) {
          await this.handleRateLimitHeaders(error.response);

          if (error.response.status === 429 && this.rateLimiter) {
            const retryAfterSec = error.response.headers['retry-after'];
            const pauseMs = retryAfterSec
              ? parseInt(retryAfterSec, 10) * 1000
              : 60_000;
            await this.rateLimiter.setPause(this.accountId, pauseMs);
          }
        }
        throw error;
      },
    );
  }

  private async handleRateLimitHeaders(response: AxiosResponse): Promise<void> {
    if (!this.rateLimiter) return;

    const bucHeader = response.headers['x-business-use-case-usage'];
    const adAccountHeader = response.headers['x-ad-account-usage'];

    // X-Business-Use-Case-Usage: { "<business_id>": [{ call_count, type, ... }] }
    if (bucHeader) {
      await this.rateLimiter.updateFromHeader(this.accountId, bucHeader);
    } else if (adAccountHeader) {
      // Fallback na starší header formát
      const parsed = parseRateLimitHeader(adAccountHeader);
      if (parsed) {
        await this.rateLimiter.updateFromHeader(
          this.accountId,
          JSON.stringify({ legacy: [parsed] }),
        );
      }
    }
  }

  private async checkRateLimit(): Promise<void> {
    if (!this.rateLimiter) return;

    const { allowed, delayMs, reason } = await this.rateLimiter.canMakeRequest(this.accountId);

    if (!allowed) {
      console.warn(
        `[MetaClient] Rate limit — account ${this.accountId}, reason: ${reason}, ` +
        `čakám ${Math.round(delayMs / 1000)}s`,
      );
      await sleep(delayMs);

      // Rekurzívna kontrola po pauze (môže byť ešte stále nad limitom)
      return this.checkRateLimit();
    }

    if (delayMs > 0) {
      // Shaping — spomaľujeme, ale nezastavujeme
      await sleep(delayMs);
    }
  }

  // Hlavná GET metóda s automatickým rate limit checknutím
  async get<T>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
    return withExponentialBackoff(
      async () => {
        await this.checkRateLimit();

        const response = await this.axios.get<T>(endpoint, {
          params: {
            access_token: this.accessToken,
            appsecret_proof: this.appSecretProof,
            ...params,
          },
        });

        return response.data;
      },
      {
        maxRetries: 5,
        baseDelayMs: 5_000,
        onRetry: (attempt, err) =>
          console.warn(`[MetaClient] Retry ${attempt} pre ${endpoint}: ${err.message}`),
      },
    );
  }

  // POST pre mutácie (kampane, rozpočty, CAPI udalosti atď.)
  async post<T>(endpoint: string, data: Record<string, unknown> = {}): Promise<T> {
    return withExponentialBackoff(
      async () => {
        await this.checkRateLimit();

        const response = await this.axios.post<T>(endpoint, null, {
          params: {
            access_token: this.accessToken,
            appsecret_proof: this.appSecretProof,
            ...data,
          },
        });

        return response.data;
      },
      {
        maxRetries: 3, // POST má nižší retry limit (idempotencia)
        baseDelayMs: 5_000,
      },
    );
  }

  // Automatická cursor-based paginácia
  async getAll<T>(
    endpoint: string,
    params: Record<string, unknown> = {},
    pageSize = 100,
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

      results.push(...(response.data ?? []));
      cursor = response.paging?.cursors?.after;

      if (!response.paging?.next) break;
    } while (cursor);

    return results;
  }
}
