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

[Learn more about this workspace setup and its capabilities](https://nx.dev/nx-api/js?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or run `npx nx graph` to visually explore what was created. Now, let's get you up to speed!
## Finish your Nx platform setup

🚀 [Finish setting up your workspace](https://cloud.nx.app/connect/e7UVJQ2DU5) to get faster builds with remote caching, distributed task execution, and self-healing CI. [Learn more about Nx Cloud](https://nx.dev/ci/intro/why-nx-cloud).
## Generate a library

```sh
npx nx g @nx/js:lib packages/pkg1 --publishable --importPath=@my-org/pkg1
```

## Run tasks

To build the library use:

```sh
npx nx build pkg1
```

To run any task with Nx use:

```sh
npx nx <target> <project-name>
```

These targets are either [inferred automatically](https://nx.dev/concepts/inferred-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or defined in the `project.json` or `package.json` files.

[More about running tasks in the docs &raquo;](https://nx.dev/features/run-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Versioning and releasing

To version and release the library use

```
npx nx release
```

Pass `--dry-run` to see what would happen without actually releasing the library.

[Learn more about Nx release &raquo;](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Keep TypeScript project references up to date

Nx automatically updates TypeScript [project references](https://www.typescriptlang.org/docs/handbook/project-references.html) in `tsconfig.json` files to ensure they remain accurate based on your project dependencies (`import` or `require` statements). This sync is automatically done when running tasks such as `build` or `typecheck`, which require updated references to function correctly.

To manually trigger the process to sync the project graph dependencies information to the TypeScript project references, run the following command:

```sh
npx nx sync
```

You can enforce that the TypeScript project references are always in the correct state when running in CI by adding a step to your CI job configuration that runs the following command:

```sh
npx nx sync:check
```

[Learn more about nx sync](https://nx.dev/reference/nx-commands#sync)

## Nx Cloud

Nx Cloud ensures a [fast and scalable CI](https://nx.dev/ci/intro/why-nx-cloud?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) pipeline. It includes features such as:

- [Remote caching](https://nx.dev/ci/features/remote-cache?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task distribution across multiple machines](https://nx.dev/ci/features/distribute-task-execution?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Automated e2e test splitting](https://nx.dev/ci/features/split-e2e-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task flakiness detection and rerunning](https://nx.dev/ci/features/flaky-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

### Set up CI (non-Github Actions CI)

**Note:** This is only required if your CI provider is not GitHub Actions.

Use the following command to configure a CI workflow for your workspace:

```sh
npx nx g ci-workflow
```

[Learn more about Nx on CI](https://nx.dev/ci/intro/ci-with-nx#ready-get-started-with-your-provider?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Install Nx Console

Nx Console is an editor extension that enriches your developer experience. It lets you run tasks, generate code, and improves code autocompletion in your IDE. It is available for VSCode and IntelliJ.

[Install Nx Console &raquo;](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Useful links

Learn more:

- [Learn more about this workspace setup](https://nx.dev/nx-api/js?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Learn about Nx on CI](https://nx.dev/ci/intro/ci-with-nx?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Releasing Packages with Nx release](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [What are Nx plugins?](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

And join the Nx community:

- [Discord](https://go.nx.dev/community)
- [Follow us on X](https://twitter.com/nxdevtools) or [LinkedIn](https://www.linkedin.com/company/nrwl)
- [Our Youtube channel](https://www.youtube.com/@nxdevtools)
- [Our blog](https://nx.dev/blog?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
