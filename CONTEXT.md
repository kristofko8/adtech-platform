# CONTEXT.md — AdTech Platform Master Context

> Tento súbor slúži ako "single source of truth" pre Claude Code a vývojový tím.
> Obsahuje všetky architektonické rozhodnutia, konvencie a kritické implementačné detaily.

---

## 1. Projektový prehľad

**Účel:** Vlastná AdTech platforma pre inteligentnú správu a analytiku Meta Ads.
**Cieľová skupina:** Digitálne agentúry a veľkí inzerenti spravujúci viaceré Meta reklamné účty.
**Kľúčová výhoda oproti Ads Manageru:** Vlastná kreatívna inteligencia, automatizácia + dáta bez fragmentácie.

---

## 2. Monorepo štruktúra

```
adtech-platform/           ← root (Nx workspace, pnpm)
├── apps/
│   ├── api/               ← NestJS REST API  (port 3000)
│   ├── worker/            ← NestJS BullMQ Worker (bez HTTP portu)
│   └── web/               ← Next.js 15 App Router (port 4200)
├── packages/
│   ├── shared-types/      ← @adtech/shared-types  — Zod schémy, TS typy, konštanty
│   ├── database/          ← @adtech/database       — Prisma schéma + singleton klient
│   ├── analytics/         ← @adtech/analytics      — ClickHouse klient + repozitáre
│   └── meta-api/          ← @adtech/meta-api       — Meta HTTP klient + rate limiter
├── infra/
│   └── clickhouse/        ← config.xml, users.xml pre Docker
├── docker-compose.yml
├── .env.example
└── CONTEXT.md             ← tento súbor
```

**Pravidlo:** Aplikácie (`apps/`) sú tenké — biznis logika patrí do `packages/`.

---

## 3. Technologický stack a verzie

| Komponent | Technológia | Verzia | Poznámka |
|-----------|-------------|--------|----------|
| Monorepo | Nx | 22.x | `pnpm nx <cmd>` |
| Package Manager | pnpm | 10.x | Workspace linking |
| Backend | NestJS | 11.x | Modular architecture |
| Frontend | Next.js | 15.x | App Router + RSC |
| ORM | Prisma | 6.x | PostgreSQL |
| OLTP DB | PostgreSQL | 16 | Transakčné dáta |
| OLAP DB | ClickHouse | 24 | Analytické dáta |
| Queue | BullMQ + Redis | 7.x | ETL orchestrácia |
| Validácia | Zod | 3.x | Contract-first |
| Auth | Passport.js + JWT | — | JWT + refresh tokeny |
| HTTP klient | Axios | 1.x | Pre Meta API |

---

## 4. Databázová architektúra (duálna stratégia)

### 4.1 PostgreSQL — OLTP (transakčné dáta)
Spravuje: organizácie, používateľov, tokeny, pravidlá, sync joby, asset mapu.

**Kľúčové modely:**
- `Organization` → `User` → `RefreshToken`
- `Organization` → `MetaToken` → `AdAccount`
- `AdAccount` → `AutomationRule` → `RuleExecution`
- `AdAccount` → `SyncJob`
- `AssetMap` → `MetaCreativeMap` (Entity Resolution)
- `AdAccount` → `CapiConnector`

**Prisma schéma:** `packages/database/prisma/schema.prisma`
**Klient:** `packages/database/src/lib/prisma.client.ts` — singleton pattern

### 4.2 ClickHouse — OLAP (analytické dáta)
Spravuje: reklamné insighty, kreatívne metriky, anomálie.

**Tabuľky:**
```sql
analytics.raw_ad_insights          -- ReplacingMergeTree(version), hlavná tabuľka
analytics.skan_insights            -- iOS 14+ SKAdNetwork dáta
analytics.creative_performance_agg -- AggregatingMergeTree (pre MV)
analytics.campaign_daily_agg       -- AggregatingMergeTree (pre MV)
analytics.anomaly_log              -- MergeTree, TTL 90 dní
```

**Materialized Views:**
- `creative_performance_mv` → `creative_performance_agg`
- `campaign_daily_mv` → `campaign_daily_agg`

**Krit. detail:** Pri dotazoch na `raw_ad_insights` vždy používaj `FINAL` keyword pre korektné zlúčenie duplikátov z `ReplacingMergeTree`.

**Migrácie:** `packages/analytics/src/lib/clickhouse.migrations.ts` — spúšťa sa pri štarte API.

---

## 5. Meta API integrácia

### 5.1 OAuth 2.0 Flow
```
User → GET /api/v1/auth/meta/connect
     → MetaAuthService.generateAuthUrl()
     → Meta dialog
     → GET /api/v1/auth/meta/callback?code=X&state=Y
     → exchangeCodeForToken() → longLivedToken (60 dní)
     → AES-256-GCM šifrovanie → uloženie do MetaToken tabuľky
```

**Šifrovanie tokenov:** `MetaTokenEncryptionService` — AES-256-GCM, kľúč odvodený z `APP_SECRET` cez SHA-256.
**Bezpečnosť:** `appsecret_proof` = HMAC-SHA256(access_token, app_secret) — povinný pre všetky API volania.

### 5.2 Rate Limiting
**Súbor:** `packages/meta-api/src/lib/rate-limiter.ts`

Meta používa bodový systém (call_count) v hlavičkách:
- `X-Business-Use-Case-Usage` — primárna hlavička
- `X-Ad-Account-Usage` — sekundárna hlavička

**Prahy:**
- `> 80% kvóty` → shaping mode (spomalenie)
- `> 95% kvóty` → pauza (čakáme 60s)
- `HTTP 429` → exponenciálny backoff (5s × 2^n + jitter), max 5 pokusov

**In-memory store** (vyrobiť na Redis v produkcii): `Map<accountId, RateLimitState>`

### 5.3 Batch API
Max 50 požiadaviek v jednom batchi. Šetrí bodovú kvótu.
```typescript
BatchApiService.buildInsightsBatchRequests(campaignIds, datePreset, fields)
```

### 5.4 Hierarchia synchronizácie
```
AdAccount → Campaigns → AdSets → Ads → AdCreatives
                                   ↓
                              Insights (na úrovni Ad, denné)
```

---

## 6. ETL Pipeline (BullMQ)

### 6.1 Fronty a priority
| Fronta | Konštanta | Priorita | Interval |
|--------|-----------|----------|---------|
| `account-discovery` | `QUEUE_ACCOUNT_DISCOVERY` | Nízka | Každých 6h |
| `insights-sync` | `QUEUE_INSIGHTS_SYNC` | Stredná | Per trigger |
| `automation-rules` | `QUEUE_AUTOMATION_RULES` | Kritická | Každých 15min |
| `media-proxy` | `QUEUE_MEDIA_PROXY` | Nízka | On-demand |
| `capi-events` | `QUEUE_CAPI_EVENTS` | Vysoká | On-demand |

### 6.2 iOS 14+ Resync okno
```typescript
// Každý sync sťahuje posledných 72 hodín (nie len včerajšok)
const resyncWindowHours = IOS14_RESYNC_WINDOW_HOURS; // = 72
```
ReplacingMergeTree zabezpečí, že staršie záznamy s rovnakým kľúčom budú nahradené novšími (verzia = Unix timestamp).

### 6.3 Chybová logika
- `attempts: 5`, `backoff: exponential (5000ms)`
- `removeOnComplete: { count: 100 }` — 100 dokončených v Redis
- `removeOnFail: { count: 200 }` — 200 chybových pre debugovanie

---

## 7. Kreatívna inteligencia

### 7.1 Metriky
```
Hook Rate = video_3s_views / impressions × 100
Hold Rate = thru_plays / video_3s_views × 100
```

### 7.2 Klasifikácia výkonu
| Tier | Hook Rate | Hold Rate | Akcia |
|------|-----------|-----------|-------|
| Elite | ≥ 45% | ≥ 50% | Škálovať + replikovať |
| Strong | 30-45% | 40-50% | Jemná optimalizácia |
| Average | 20-29% | 30-39% | A/B testovanie |
| Fix-it | < 20% | < 30% | Prepracovať |

**Konštanty:** `packages/shared-types/src/lib/constants.ts`

### 7.3 Entity Resolution (Asset Map)
Problém: rovnaká kreatíva beží pod rôznymi Meta creative_id.

Riešenie:
1. `image_hash` (Meta) alebo `video_id` → generovanie `globalAssetId` (SHA-256)
2. PostgreSQL: `AssetMap` ↔ `MetaCreativeMap` (N:1)
3. ClickHouse dotazy agregujú podľa `creative_id` → JOIN na `AssetMap`

**Súbor:** `packages/meta-api/src/lib/creatives.service.ts` — `generateGlobalAssetId()`

### 7.4 Creative Fatigue detekcia
Podmienka: `hookRateDrop > 20%` AND `frequency > 3.5`
```sql
-- ClickHouse: creative.repository.ts → detectCreativeFatigue()
max(hook_rate) OVER (ORDER BY date ROWS UNBOUNDED PRECEDING) AS max_hook_rate
```

---

## 8. Media Proxy

**Problém:** Meta CDN URL expirujú po krátkom čase.

**Riešenie:**
```
Frontend → GET /api/v1/media/preview?creative_id=X
         → Redis cache check (TTL 48h)
         → Cache HIT → return cached URL
         → Cache MISS → Meta API getAdCreative → fresh URL → cache → return
```

**Súbory:**
- `apps/api/src/modules/media-proxy/media-proxy.service.ts`
- `apps/api/src/modules/media-proxy/media-proxy.controller.ts`

**Redis kľúč:** `cdn_url:{creativeId}`, TTL: `REDIS_TTL_CDN_URL = 172800s` (48h)

---

## 9. Rule Engine a Anomálie

### 9.1 Z-skóre algoritmus
```
Z = (x - μ) / σ

μ = priemer za posledných 21 dní (ANOMALY_BASELINE_DAYS)
σ = smerodajná odchýlka za posledných 21 dní

|Z| ≥ 2.0 → WARNING
|Z| ≥ 3.0 → CRITICAL (99.7% pravdepodobnosť, že nejde o náhodu)
```

**SQL implementácia:** `packages/analytics/src/lib/insights.repository.ts` → `getZScores()`
**ClickHouse:** `stddevPop()` + `avg()` cez okennú funkciu `ROWS BETWEEN N PRECEDING AND 1 PRECEDING`

### 9.2 IQR metóda (odolná voči outlierom)
```
IQR = Q3 - Q1
Outlier ak: value < Q1 - 1.5×IQR  alebo  value > Q3 + 1.5×IQR
```
Použitie: Black Friday, výpredaje — situácie kde Z-skóre falošne alarmuje.

### 9.3 Predefinované typy pravidiel
| Typ | Trigger | Akcia |
|-----|---------|-------|
| `BUDGET_PROTECTION` | spend > 120% plánu | Pozastaviť kampaň + notifikácia |
| `PERFORMANCE_DROP` | ROAS Z-skóre < -2.5 | Znížiť bid o 20% |
| `CREATIVE_FATIGUE` | CTR Z-skóre < -2.0 + freq > 4.0 | Označiť kreatívu |
| `SCALING_WINNER` | CPA < target + ROAS > 3.0 | Zvýšiť rozpočet o 15% |

### 9.4 Cron plán
```
*/15 * * * *    → Budget Protection + Performance Drop
0 */6 * * *     → Scaling Winner
0 0 * * *       → Creative Fatigue
```

### 9.5 Ochranné limity
- `cooldownMinutes` — minimálny čas medzi dvoma vykonaniami pravidla
- `maxExecutionsPerDay` — denný strop (default 3)

---

## 10. CAPI (Conversions API)

### 10.1 Deduplikácia udalostí
```
Browser Pixel → event_id: UUID
Server CAPI   → rovnaký event_id

Meta spočíta konverziu iba raz (podľa event_id).
```
Redis kľúč: `capi:dedup:{pixelId}:{eventId}`, TTL: `CAPI_EVENT_DEDUP_WINDOW_HOURS × 3600 = 172800s`

### 10.2 PII Hashing (povinné!)
Všetky osobné údaje → SHA-256 pred odoslaním do Meta:
- `email` → lowercase + trim → SHA-256
- `phone` → len číslice → SHA-256
- `firstName`, `lastName` → lowercase → SHA-256
- `clientIpAddress`, `clientUserAgent`, `fbp`, `fbc` → BEZ hashovania

### 10.3 EMQ (Event Match Quality)
- Cieľová hodnota: `≥ 6.0 / 10.0`
- Monitoring: `CapiService.checkEmqScore()`
- Endpoint: `GET /api/v1/capi/pixels/:pixelId/emq`

---

## 11. Bezpečnosť (RBAC)

### 11.1 Role hierarchy
```
SUPER_ADMIN (4) > MEDIA_BUYER (3) > ANALYST (2) > CLIENT (1)
```
Vyššia úroveň má prístup ku všetkému nižšej úrovne.

### 11.2 Guards
- `JwtAuthGuard` — overuje Bearer token
- `RolesGuard` — kontroluje minimálnu požadovanú rolu

### 11.3 Endpoint ochrana
```typescript
@Roles(UserRole.MEDIA_BUYER)  // = minimálne MEDIA_BUYER alebo vyšší
@UseGuards(JwtAuthGuard, RolesGuard)
```

---

## 12. Environment premenné

| Premenná | Popis | Povinná |
|----------|-------|---------|
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `CLICKHOUSE_HOST` | ClickHouse HTTP endpoint | ✅ |
| `REDIS_HOST/PORT/PASSWORD` | Redis spojenie | ✅ |
| `META_APP_ID` | Facebook App ID | ✅ |
| `META_APP_SECRET` | Facebook App Secret | ✅ |
| `META_REDIRECT_URI` | OAuth callback URL | ✅ |
| `JWT_SECRET` | Podpisovací kľúč pre JWT | ✅ |
| `APP_SECRET` | Šifrovací kľúč pre tokeny (min 32 znakov) | ✅ |
| `S3_ENDPOINT` | MinIO/S3 endpoint pre archív kreatív | ⚡ |
| `SLACK_WEBHOOK_URL` | Slack notifikácie | ⚡ |

---

## 13. Konvencie kódu

### 13.1 Import paths
```typescript
import { MetaHttpClient } from '@adtech/meta-api';      // ✅
import { RawAdInsight } from '@adtech/shared-types';    // ✅
import { PrismaService } from '../prisma/prisma.service'; // ✅ (relatívne v rámci app)
```

### 13.2 ClickHouse dotazy
- Vždy `FINAL` pre `ReplacingMergeTree` tabuľky
- `sumMerge()` / `avgMerge()` pre `AggregatingMergeTree` tabuľky
- Parametre cez `{name:Type}` syntax (nie string interpolácia!)
- `PREWHERE` pred `WHERE` pre optimalizáciu

### 13.3 Meta API
- Nikdy nevolaj Meta API priamo — vždy cez `MetaHttpClient`
- Vždy pripájaj `appsecret_proof` k volaniam
- Asynchrónne stiahnutie veľkých insightov: `createAsyncReport()` → `checkReportStatus()` → `getAsyncReportResults()`

### 13.4 Šifrovanie
- Meta tokeny: AES-256-GCM (`MetaTokenEncryptionService`)
- CAPI tokeny: rovnaký service
- PII pre CAPI: SHA-256 (`CapiService.sha256()`)
- Heslá: bcrypt s cost factor 12

---

## 14. Nasadenie (Docker)

### Lokálny vývoj
```bash
pnpm docker:up          # Spustí postgres, clickhouse, redis, minio
pnpm dev:api            # NestJS API (hot reload)
pnpm dev:worker         # BullMQ worker (hot reload)
pnpm dev:web            # Next.js (hot reload)
```

### Inicializácia (prvýkrát)
```bash
# 1. Skopírovať env
cp .env.example .env

# 2. Spustiť infraštruktúru
pnpm docker:up

# 3. Vytvoriť PostgreSQL tabuľky
pnpm --filter @adtech/database db:push

# 4. Seed demo dát
pnpm --filter @adtech/database db:seed

# 5. ClickHouse migrácie sa spustia automaticky pri prvom štarte API
pnpm dev:api
```

### Demo účty (po seede)
| Email | Heslo | Rola |
|-------|-------|------|
| admin@demo-agency.com | Admin@123456 | SUPER_ADMIN |
| buyer@demo-agency.com | Buyer@123456 | MEDIA_BUYER |
| analyst@demo-agency.com | Analyst@123456 | ANALYST |

---

## 15. Kľúčové súbory pre Claude Code

Pri implementácii nových funkcií vždy konzultuj tieto súbory:

| Čo hľadáš | Kde |
|-----------|-----|
| Typy a Zod schémy | `packages/shared-types/src/lib/` |
| Konštanty (prahy, TTL, názvy front) | `packages/shared-types/src/lib/constants.ts` |
| Prisma modely | `packages/database/prisma/schema.prisma` |
| ClickHouse schémy | `packages/analytics/src/lib/clickhouse.migrations.ts` |
| Meta API endpointy | `packages/meta-api/src/lib/` |
| Auth logika | `apps/api/src/modules/auth/` + `meta-auth/` |
| NestJS konfigurácia | `apps/api/src/config/configuration.ts` |
| Docker services | `docker-compose.yml` |

---

*Posledná aktualizácia: 2026-03-06*
