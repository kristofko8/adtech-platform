// ============================================================
// Token Bucket Rate Limiter pre Meta API
//
// Implementuje klasický Token Bucket algoritmus v Redis
// pomocou Lua skriptu (atomárna operácia — žiadne race conditions).
//
// Ako funguje:
//   • Každý účet má "vedro" s max N tokenmi
//   • Tokeny pribúdajú konštantnou rýchlosťou (leak rate)
//   • Každé API volanie spotrebuje 1 token
//   • Ak je vedro prázdne → čakáme kým sa doplní
//
// Výhody oproti pevnému oknu (fixed window):
//   • Plynulá priepustnosť — žiadne "burst" na začiatku okna
//   • Presnejšie rešpektovanie Meta API limitov
//   • Automatická adaptácia na X-Business-Use-Case-Usage odpovede
//   • Distribuované — zdieľané medzi všetkými workermi
//
// Meta API limity (ads_management tier):
//   • ~200 bodov/hod pre štandardné volania
//   • ~600 bodov/hod pre read-only volania
//   • Každé volanie stojí 1 bod (call_count)
// ============================================================

export interface TokenBucketConfig {
  /** Maximálna kapacita vedra (tokeny). Default: 180 (90% z 200). */
  capacity: number;
  /** Rýchlosť dopĺňania: tokeny/sekunda. Default: 0.05 (= 180/hod). */
  refillRate: number;
  /** Minimálny počet tokenov pre povolenie volania. Default: 1. */
  minTokensRequired: number;
}

export interface TokenBucketResult {
  allowed: boolean;
  tokensRemaining: number;
  waitMs: number;    // Koľko ms čakať ak allowed=false
  reason: string;
}

export interface RedisForBucket {
  eval(script: string, numkeys: number, ...args: string[]): Promise<unknown>;
  set(key: string, value: string, expiryMode: string, time: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

const DEFAULT_CONFIG: TokenBucketConfig = {
  capacity: 180,         // 90% z Meta hodinového limitu 200
  refillRate: 0.05,      // 180 tokenov / 3600 sekúnd = 0.05/s
  minTokensRequired: 1,
};

// Redis kľúče
const TOKENS_KEY = (accountId: string) => `meta:tb:tokens:${accountId}`;
const LAST_REFILL_KEY = (accountId: string) => `meta:tb:refill:${accountId}`;
const TTL = 7200; // 2 hodiny TTL

/**
 * Lua skript pre atomárny token bucket.
 *
 * Vstup (KEYS): [tokensKey, lastRefillKey]
 * Vstup (ARGV): [capacity, refillRate, minRequired, nowMs]
 *
 * Výstup (array): [allowed (0/1), tokensAfter*100, waitMs]
 *
 * Prečo Lua: Redis zaručuje atomárne spustenie → žiadne race conditions
 * medzi čítaním a zápisom tokenov.
 */
const TOKEN_BUCKET_SCRIPT = `
local tokens_key = KEYS[1]
local refill_key = KEYS[2]

local capacity     = tonumber(ARGV[1])
local refill_rate  = tonumber(ARGV[2])
local min_required = tonumber(ARGV[3])
local now_ms       = tonumber(ARGV[4])

-- Načítame aktuálny stav
local tokens_raw    = redis.call('GET', tokens_key)
local last_refill   = redis.call('GET', refill_key)

local tokens        = tokens_raw    and tonumber(tokens_raw)    or capacity
local last_refill_t = last_refill   and tonumber(last_refill)   or now_ms

-- Vypočítame koľko tokenov pribudlo od posledného volania
local elapsed_s = (now_ms - last_refill_t) / 1000.0
local refilled  = elapsed_s * refill_rate
tokens = math.min(capacity, tokens + refilled)

-- Pokusíme sa spotrebovať token
local allowed = 0
local wait_ms = 0

if tokens >= min_required then
  tokens  = tokens - min_required
  allowed = 1
else
  -- Vypočítame čakaciu dobu kým sa doplní min_required tokenov
  local needed  = min_required - tokens
  wait_ms = math.ceil((needed / refill_rate) * 1000)
end

-- Zapíšeme nový stav (s TTL 7200s = 2 hodiny)
redis.call('SET', tokens_key, tostring(tokens), 'EX', 7200)
redis.call('SET', refill_key, tostring(now_ms),  'EX', 7200)

-- Vrátime: allowed, tokens*100 (int), wait_ms
return {allowed, math.floor(tokens * 100), wait_ms}
`;

export class TokenBucketRateLimiter {
  private readonly config: TokenBucketConfig;

  constructor(
    private readonly redis: RedisForBucket,
    config: Partial<TokenBucketConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Pokúsi sa spotrebovať token pre daný účet.
   * Atomárna operácia cez Redis Lua skript.
   */
  async consume(accountId: string, tokens = 1): Promise<TokenBucketResult> {
    const cfg = { ...this.config, minTokensRequired: tokens };

    const result = await this.redis.eval(
      TOKEN_BUCKET_SCRIPT,
      2,
      TOKENS_KEY(accountId),
      LAST_REFILL_KEY(accountId),
      String(cfg.capacity),
      String(cfg.refillRate),
      String(cfg.minTokensRequired),
      String(Date.now()),
    ) as [number, number, number];

    const [allowed, tokensCents, waitMs] = result;

    return {
      allowed: allowed === 1,
      tokensRemaining: tokensCents / 100,
      waitMs: Number(waitMs),
      reason: allowed === 1
        ? `ok (${(tokensCents / 100).toFixed(1)} tokenov zostatok)`
        : `throttled (čakaj ${waitMs}ms)`,
    };
  }

  /**
   * Zníženie kapacity vedra na základe X-Business-Use-Case-Usage.
   *
   * Ak Meta hlási že sme na 70% call_count, nastavíme tokeny
   * na 30% kapacity — synchronizujeme lokálny stav s Meta serverom.
   */
  async syncWithMetaUsage(
    accountId: string,
    callCountPct: number, // 0–100 z Meta API hlavičky
  ): Promise<void> {
    const remainingPct = Math.max(0, 100 - callCountPct) / 100;
    const adjustedTokens = Math.floor(this.config.capacity * remainingPct);

    await this.redis.set(
      TOKENS_KEY(accountId),
      String(adjustedTokens),
      'EX',
      TTL,
    );
  }

  /**
   * Naplnenie vedra po vypršaní Meta API okna (hodinový reset).
   */
  async refillBucket(accountId: string): Promise<void> {
    await this.redis.set(
      TOKENS_KEY(accountId),
      String(this.config.capacity),
      'EX',
      TTL,
    );
    await this.redis.set(
      LAST_REFILL_KEY(accountId),
      String(Date.now()),
      'EX',
      TTL,
    );
  }

  /**
   * Načítanie aktuálneho počtu tokenov (pre monitoring).
   */
  async getTokens(accountId: string): Promise<number> {
    const raw = await this.redis.get(TOKENS_KEY(accountId));
    return raw ? parseFloat(raw) : this.config.capacity;
  }

  /**
   * Pomocník: čaká kým je volanie povolené (polling loop).
   * Maximalny počet pokusov je 10 (= max ~10 minút čakania).
   */
  async waitForToken(accountId: string, maxAttempts = 10): Promise<boolean> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.consume(accountId);
      if (result.allowed) return true;

      await sleep(Math.min(result.waitMs, 60_000));
    }
    return false; // Timeout
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
