// ============================================================
// Meta API Rate Limiter — Bodový systém
// Sleduje X-Business-Use-Case-Usage hlavičky a dynamicky
// obmedzuje priepustnosť volaní, aby sme nikdy nedosiahli limit
// ============================================================

import {
  META_RATE_LIMIT_SAFE_THRESHOLD,
  META_RATE_LIMIT_PAUSE_THRESHOLD,
} from '@adtech/shared-types';

export interface RateLimitState {
  callCount: number;        // Aktuálne použité body
  totalCputime: number;     // CPU čas (Meta interná metrika)
  totalTime: number;        // Celkový čas (Meta interná metrika)
  type: string;             // Typ limitu (ads_management atď.)
  estimatedResetMs?: number; // Odhadovaný čas do resetu (ms)
  lastUpdated: number;      // Unix timestamp poslednej aktualizácie
  pausedUntil?: number;     // Pozastavenie do tohto timestampu
}

// In-memory store pre rate limit stav (v produkcii: Redis)
const rateLimitStore = new Map<string, RateLimitState>();

// Parsovanie Meta rate limit hlavičiek
export function parseRateLimitHeader(headerValue: string): Partial<RateLimitState> | null {
  try {
    const data = JSON.parse(headerValue);
    return {
      callCount: data.call_count || 0,
      totalCputime: data.total_cputime || 0,
      totalTime: data.total_time || 0,
      type: data.type || 'unknown',
      estimatedResetMs: data.estimated_time_to_regain_access
        ? data.estimated_time_to_regain_access * 1000
        : undefined,
    };
  } catch {
    return null;
  }
}

// Aktualizácia stavu po každom Meta API volaní
export function updateRateLimit(accountId: string, headerValue: string): void {
  const parsed = parseRateLimitHeader(headerValue);
  if (!parsed) return;

  const existing = rateLimitStore.get(accountId) || {
    callCount: 0,
    totalCputime: 0,
    totalTime: 0,
    type: 'unknown',
    lastUpdated: Date.now(),
  };

  rateLimitStore.set(accountId, {
    ...existing,
    ...parsed,
    lastUpdated: Date.now(),
  });
}

// Kontrola, či môžeme vykonať ďalšie volanie
export function canMakeRequest(accountId: string): {
  allowed: boolean;
  delayMs: number;
  reason: string;
} {
  const state = rateLimitStore.get(accountId);

  if (!state) {
    return { allowed: true, delayMs: 0, reason: 'no_state' };
  }

  // Ak sme pozastavení (po 429)
  if (state.pausedUntil && Date.now() < state.pausedUntil) {
    return {
      allowed: false,
      delayMs: state.pausedUntil - Date.now(),
      reason: 'paused_after_429',
    };
  }

  const usage = state.callCount / 100; // Meta udáva call_count ako percentuálnu hodnotu

  if (usage >= META_RATE_LIMIT_PAUSE_THRESHOLD) {
    return {
      allowed: false,
      delayMs: 60000, // Čakáme 60 sekúnd (Meta reset window)
      reason: `quota_critical_${Math.round(usage * 100)}pct`,
    };
  }

  if (usage >= META_RATE_LIMIT_SAFE_THRESHOLD) {
    // Shaping: spomalíme, ale nezastavíme
    const delayMs = Math.round((usage - META_RATE_LIMIT_SAFE_THRESHOLD) * 10000);
    return {
      allowed: true,
      delayMs,
      reason: `quota_shaping_${Math.round(usage * 100)}pct`,
    };
  }

  return { allowed: true, delayMs: 0, reason: 'ok' };
}

// Nastavenie pozastavenia po 429 odpovedi
export function setRateLimitPause(accountId: string, resetMs?: number): void {
  const state = rateLimitStore.get(accountId) || {
    callCount: 100,
    totalCputime: 0,
    totalTime: 0,
    type: 'unknown',
    lastUpdated: Date.now(),
  };

  state.pausedUntil = Date.now() + (resetMs || 60000);
  rateLimitStore.set(accountId, state);
}

// Exponenciálny backoff helper
export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelayMs: number = 5000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (error?.response?.status === 429) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * 1000; // Pridáme náhodnosť
        await new Promise((resolve) => setTimeout(resolve, delay + jitter));
        continue;
      }

      // Pre iné chyby nevykonávame retry
      throw error;
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

// Delay helper
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
