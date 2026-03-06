# AdTech Platform — Meta Ads Intelligence

Monorepo platforma pre inteligentnú správu a analytiku Meta Ads.

## Stack

| Vrstva | Technológia |
|--------|-------------|
| Monorepo | Nx + pnpm workspaces |
| Backend API | NestJS (apps/api) |
| ETL Worker | NestJS + BullMQ (apps/worker) |
| Frontend | Next.js 15 App Router (apps/web) |
| OLTP databáza | PostgreSQL 16 + Prisma ORM |
| OLAP databáza | ClickHouse 24 |
| Cache / Queue | Redis 7 |
| S3 Storage | MinIO (lokálne) / AWS S3 (prod) |

## Rýchly štart

### 1. Prerekvizity
```bash
node >= 20, pnpm >= 9, Docker Desktop
```

### 2. Klonuj a inštaluj závislosti
```bash
cd adtech-platform
pnpm install
```

### 3. Nastavenie environment
```bash
cp .env.example .env
# Vyplň META_APP_ID, META_APP_SECRET, JWT_SECRET
```

### 4. Spustenie infraštruktúry
```bash
pnpm docker:up
# PostgreSQL :5432, ClickHouse :8123, Redis :6379, MinIO :9001
```

### 5. Databázové migrácie
```bash
pnpm --filter @adtech/database db:push
pnpm --filter @adtech/database db:seed
```

### 6. ClickHouse migrácie
```bash
# Spustí sa automaticky pri prvom štarte API
# alebo manuálne: pnpm nx run analytics:migrate
```

### 7. Spustenie apiek
```bash
pnpm dev:api     # http://localhost:3000/api/v1
pnpm dev:worker  # BullMQ worker procesy
pnpm dev:web     # http://localhost:4200
```

## Architektúra

```
adtech-platform/
├── apps/
│   ├── api/          # NestJS REST API
│   │   └── modules/
│   │       ├── auth/           # JWT + refresh tokeny
│   │       ├── meta-auth/      # Meta OAuth 2.0 + token management
│   │       ├── organizations/  # Multi-tenant správa
│   │       ├── ad-accounts/    # Prepojenie Meta účtov
│   │       ├── media-proxy/    # Proxy pre Meta CDN URL
│   │       ├── rule-engine/    # Automatizačné pravidlá + cron
│   │       └── capi/           # Meta Conversions API
│   ├── worker/       # BullMQ ETL procesory
│   │   └── processors/
│   │       ├── account-discovery.processor.ts
│   │       └── insights-sync.processor.ts
│   └── web/          # Next.js dashboard
├── packages/
│   ├── shared-types/ # Zod schémy + TypeScript typy
│   ├── database/     # Prisma schema + klient
│   ├── analytics/    # ClickHouse klient + repozitáre
│   └── meta-api/     # Meta HTTP klient + rate limiter
└── docker-compose.yml
```

## Demo prihlasovacie údaje (po seede)

| Rola | Email | Heslo |
|------|-------|-------|
| Super Admin | admin@demo-agency.com | Admin@123456 |
| Media Buyer | buyer@demo-agency.com | Buyer@123456 |
| Analyst | analyst@demo-agency.com | Analyst@123456 |

## Kľúčové funkcie

- **Meta OAuth 2.0** — bezpečné prepojenie reklamných účtov s AES-256 šifrovaním tokenov
- **ETL Pipeline** — BullMQ fronty pre hierarchickú synchronizáciu kampaní s 72h iOS 14+ resync
- **Rate Limiter** — Inteligentné sledovanie X-Business-Use-Case-Usage hlavičiek
- **Creative Analytics** — Hook Rate, Hold Rate, klasifikácia Elite/Strong/Average/Fix-it
- **Media Proxy** — Transparentný proxy pre expirujúce Meta CDN URL s Redis cache
- **Rule Engine** — Automatizované pravidlá s Z-skóre detekciou anomálií
- **CAPI** — Server-side konverzie s SHA-256 hashovaním PII a deduplikáciou

---

> Celá architektúra a implementačné detaily sú zdokumentované v [CONTEXT.md](./CONTEXT.md)
