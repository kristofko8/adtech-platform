// ============================================================
// Redis-based Meta API Rate Limiter
//
// Nahrádza in-memory Map riešenie distribuovaným stavom v Redis.
// Všetky worker inštancie zdieľajú rovnaký rate-limit stav,
// čím sa zabraňuje 429 chybám pri horizontálnom škálovaní.
//
// Kľúčová schéma: meta:rl:{accountId}  (Hash, TTL = 3600s)
// ============================================================

import {
  META_RATE_LIMIT_SAFE_THRESHOLD,
  META_RATE_LIMIT_PAUSE_THRESHOLD,
} from '@adtech/shared-types';

// Minimalistické Redis rozhranie — kompatibilné s ioredis aj node-redis
export interface RedisClient {
  hset(key: string, field: string, value: string): Promise<unknown>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string> | null>;
  expire(key: string, seconds: number): Promise<unknown>;
  set(key: string, value: string, expiryMode: string, time: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

export interface RateLimitState {
  callCount: number;
  totalCputime: number;
  totalTime: number;
  type: string;
  estimatedResetMs?: number;
  lastUpdated: number;
  pausedUntil?: number;
}

// Výsledok kontroly
export interface RateLimitCheck {
  allowed: boolean;
  delayMs: number;
  reason: string;
}

const KEY_PREFIX = 'meta:rl';
const KEY_TTL_SECONDS = 3600; // Meta hodinové okno

function buildKey(accountId: string): string {
  return `${KEY_PREFIX}:${accountId}`;
}

// Parsovanie Meta rate limit hlavičiek (X-Business-Use-Case-Usage)
export function parseRateLimitHeader(headerValue: string): Partial<RateLimitState> | null {
  try {
    const parsed = JSON.parse(headerValue);
    // Meta vracia objekt kde kľúč je business_id → pole objektov
    // Príklad: { "123456": [{ "call_count": 42, "type": "ads_management", ... }] }
    const entries = Object.values(parsed);
    if (!entries.length) return null;

    const data = Array.isArray(entries[0]) ? (entries[0] as any[])[0] : entries[0];

    return {
      callCount: data.call_count ?? 0,
      totalCputime: data.total_cputime ?? 0,
      totalTime: data.total_time ?? 0,
      type: data.type ?? 'unknown',
      estimatedResetMs: data.estimated_time_to_regain_access
        ? data.estimated_time_to_regain_access * 1000
        : undefined,
    };
  } catch {
    return null;
  }
}

export class RedisRateLimiter {
  constructor(private readonly redis: RedisClient) {}

  // Načítanie stavu z Redis
  private async getState(accountId: string): Promise<RateLimitState | null> {
    const raw = await this.redis.hgetall(buildKey(accountId));
    if (!raw) return null;

    return {
      callCount: parseFloat(raw['callCount'] ?? '0'),
      totalCputime: parseFloat(raw['totalCputime'] ?? '0'),
      totalTime: parseFloat(raw['totalTime'] ?? '0'),
      type: raw['type'] ?? 'unknown',
      estimatedResetMs: raw['estimatedResetMs'] ? parseFloat(raw['estimatedResetMs']) : undefined,
      lastUpdated: parseFloat(raw['lastUpdated'] ?? '0'),
      pausedUntil: raw['pausedUntil'] ? parseFloat(raw['pausedUntil']) : undefined,
    };
  }

  // Uloženie stavu do Redis (atomic cez HSET + EXPIRE)
  private async setState(accountId: string, state: RateLimitState): Promise<void> {
    const key = buildKey(accountId);
    const fields: [string, string][] = [
      ['callCount', String(state.callCount)],
      ['totalCputime', String(state.totalCputime)],
      ['totalTime', String(state.totalTime)],
      ['type', state.type],
      ['lastUpdated', String(state.lastUpdated)],
    ];

    if (state.estimatedResetMs !== undefined) {
      fields.push(['estimatedResetMs', String(state.estimatedResetMs)]);
    }
    if (state.pausedUntil !== undefined) {
      fields.push(['pausedUntil', String(state.pausedUntil)]);
    }

    for (const [field, value] of fields) {
      await this.redis.hset(key, field, value);
    }
    await this.redis.expire(key, KEY_TTL_SECONDS);
  }

  // Aktualizácia po každom Meta API volaní
  async updateFromHeader(accountId: string, headerValue: string): Promise<void> {
    const parsed = parseRateLimitHeader(headerValue);
    if (!parsed) return;

    const existing = await this.getState(accountId) ?? {
      callCount: 0,
      totalCputime: 0,
      totalTime: 0,
      type: 'unknown',
      lastUpdated: Date.now(),
    };

    await this.setState(accountId, {
      ...existing,
      ...parsed,
      lastUpdated: Date.now(),
    });
  }

  // Kontrola, či môžeme vykonať ďalšie volanie
  async canMakeRequest(accountId: string): Promise<RateLimitCheck> {
    const state = await this.getState(accountId);

    if (!state) {
      return { allowed: true, delayMs: 0, reason: 'no_state' };
    }

    // Skontroluj aktívne pozastavenie (po 429)
    if (state.pausedUntil && Date.now() < state.pausedUntil) {
      return {
        allowed: false,
        delayMs: state.pausedUntil - Date.now(),
        reason: 'paused_after_429',
      };
    }

    // Meta udáva call_count ako percentuálnu hodnotu (0–100)
    const usage = state.callCount / 100;

    if (usage >= META_RATE_LIMIT_PAUSE_THRESHOLD) {
      return {
        allowed: false,
        delayMs: state.estimatedResetMs ?? 60_000,
        reason: `quota_critical_${Math.round(usage * 100)}pct`,
      };
    }

    if (usage >= META_RATE_LIMIT_SAFE_THRESHOLD) {
      // Shaping: spomalíme proporcionálne k prekročeniu prahu
      const overRatio = (usage - META_RATE_LIMIT_SAFE_THRESHOLD) /
        (META_RATE_LIMIT_PAUSE_THRESHOLD - META_RATE_LIMIT_SAFE_THRESHOLD);
      const delayMs = Math.round(overRatio * 30_000); // Max 30s oneskorenie pri shapingu
      return {
        allowed: true,
        delayMs,
        reason: `quota_shaping_${Math.round(usage * 100)}pct`,
      };
    }

    return { allowed: true, delayMs: 0, reason: 'ok' };
  }

  // Nastavenie pozastavenia po 429 odpovedi
  async setPause(accountId: string, resetMs?: number): Promise<void> {
    const existing = await this.getState(accountId) ?? {
      callCount: 100,
      totalCputime: 0,
      totalTime: 0,
      type: 'unknown',
      lastUpdated: Date.now(),
    };

    await this.setState(accountId, {
      ...existing,
      pausedUntil: Date.now() + (resetMs ?? 60_000),
      lastUpdated: Date.now(),
    });
  }

  // Načítanie aktuálneho stavu (pre monitoring/dashboard)
  async getStatus(accountId: string): Promise<RateLimitState | null> {
    return this.getState(accountId);
  }

  // Reset stavu (po úspešnom Meta API volaní po pauze)
  async clearPause(accountId: string): Promise<void> {
    const state = await this.getState(accountId);
    if (!state?.pausedUntil) return;

    const { pausedUntil: _removed, ...rest } = state;
    await this.setState(accountId, { ...rest, lastUpdated: Date.now() });
  }
}

// ─── Exponenciálny backoff helper (nezávisí na Redis) ────────────────────────

export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {},
): Promise<T> {
  const { maxRetries = 5, baseDelayMs = 5_000, onRetry } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error as Error;

      if (error?.response?.status === 429) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1_000;
        onRetry?.(attempt + 1, lastError);
        await sleep(delay);
        continue;
      }

      throw error; // Iné chyby neretryujeme
    }
  }

  throw lastError ?? new Error('Max retries exceeded');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
