// ============================================================
// Insights Sync Processor — BullMQ Worker
//
// Stiahne Meta Ads insighty a vloží ich do ClickHouse.
// Pre veľké účty (≥50 kampaní) používa asynchrónne Meta reporty,
// pre menšie synchrónne volanie getInsights.
//
// creative_id je naplnené priamo z MetaCreativeMap (Prisma).
// Ak záznam ešte neexistuje (creative-sync ešte nebežal),
// nastaví sa 0 a CreativeSyncProcessor ho opraví cez backfill.
// ============================================================

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaClient } from '@adtech/database';
import { PrismaPg } from '@prisma/adapter-pg';
import { InsightsRepository } from '@adtech/analytics';
import { MetaHttpClient, InsightsService, CampaignsService } from '@adtech/meta-api';
import { QUEUE_INSIGHTS_SYNC, IOS14_RESYNC_WINDOW_HOURS } from '@adtech/shared-types';
import type { RawAdInsight } from '@adtech/shared-types';

export interface InsightsSyncJobData {
  adAccountId: string;
  metaAccountId: string;
  accessToken: string;
  appSecretProof: string;
  dateFrom: string;
  dateTo: string;
  isResync?: boolean;   // iOS 14+ resync okno (72h)
  forceAsync?: boolean; // Vynúti asynchrónny report bez ohľadu na počet kampaní
}

// Prah pre prepnutie na asynchrónne reporty
const ASYNC_REPORT_CAMPAIGN_THRESHOLD = 50;

// Timeout pre čakanie na asynchrónny report (30 minút)
const ASYNC_REPORT_TIMEOUT_MS = 30 * 60 * 1_000;
const ASYNC_REPORT_POLL_INTERVAL_MS = 15_000;

@Processor(QUEUE_INSIGHTS_SYNC)
export class InsightsSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(InsightsSyncProcessor.name);
  private readonly prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' }) } as never);
  private readonly insightsRepo = new InsightsRepository();

  async process(job: Job<InsightsSyncJobData>): Promise<void> {
    const {
      adAccountId,
      metaAccountId,
      accessToken,
      appSecretProof,
      dateFrom,
      dateTo,
      isResync,
      forceAsync,
    } = job.data;

    this.logger.log(
      `Insights sync: account=${metaAccountId}, ${dateFrom}→${dateTo}, resync=${isResync}`,
    );

    const metaClient = new MetaHttpClient({
      accessToken,
      appSecretProof,
      accountId: metaAccountId,
    });

    const insightsService = new InsightsService(metaClient);
    const campaignsService = new CampaignsService(metaClient);

    try {
      // ── Krok 1: Načítaj mapovanie ad_id → creative_id z Prisma ────────
      const creativeMapEntries = await this.prisma.metaCreativeMap.findMany({
        where: { adAccountId },
        select: { metaAdId: true, metaCreativeId: true },
      });

      const adToCreative = new Map<string, number>(
        creativeMapEntries
          .map((e): [string, number] | null => {
            const n = parseInt(e.metaCreativeId, 10);
            return isNaN(n) ? null : [e.metaAdId, n];
          })
          .filter((e): e is [string, number] => e !== null),
      );

      this.logger.log(`Loaded ${adToCreative.size} creative_id mappings from DB`);

      // ── Krok 2: Zisti počet kampaní → rozhodnutie sync vs. async ──────
      const campaigns = await campaignsService.getCampaigns(metaAccountId);
      this.logger.log(`Found ${campaigns.length} campaigns for ${metaAccountId}`);

      let allInsights: RawAdInsight[];

      if (forceAsync || campaigns.length >= ASYNC_REPORT_CAMPAIGN_THRESHOLD) {
        allInsights = await this.fetchViaAsyncReport(
          insightsService,
          metaAccountId,
          { dateFrom, dateTo },
          job,
          adToCreative,
        );
      } else {
        allInsights = await this.fetchSynchronously(
          insightsService,
          campaigns,
          metaAccountId,
          { dateFrom, dateTo },
          job,
          adToCreative,
        );
      }

      // ── Krok 3: Batch insert do ClickHouse ─────────────────────────────
      if (allInsights.length > 0) {
        const chunkSize = 1_000;
        for (let i = 0; i < allInsights.length; i += chunkSize) {
          await this.insightsRepo.batchInsert(allInsights.slice(i, i + chunkSize));
        }
        this.logger.log(`Inserted ${allInsights.length} insight records for ${metaAccountId}`);
      }

      // ── Krok 4: Aktualizuj sync job ────────────────────────────────────
      await this.prisma.syncJob.updateMany({
        where: { adAccountId, status: 'RUNNING', type: 'INSIGHTS' },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          itemsProcessed: allInsights.length,
        },
      });

      void IOS14_RESYNC_WINDOW_HOURS; // Zabraňuje "unused import" lint warningom

    } catch (err: any) {
      this.logger.error(`Insights sync failed for ${metaAccountId}: ${err.message}`);
      throw err; // Re-throw pre BullMQ retry mechanizmus
    }
  }

  // ── Synchrónne sťahovanie (pre malé účty <50 kampaní) ─────────────────
  private async fetchSynchronously(
    insightsService: InsightsService,
    campaigns: { id: string }[],
    metaAccountId: string,
    range: { dateFrom: string; dateTo: string },
    job: Job<InsightsSyncJobData>,
    adToCreative: Map<string, number>,
  ): Promise<RawAdInsight[]> {
    const results: RawAdInsight[] = [];

    for (let i = 0; i < campaigns.length; i++) {
      await job.updateProgress(Math.round((i / campaigns.length) * 80));

      try {
        const insights = await insightsService.getInsights(campaigns[i].id, {
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
          level: 'ad',
          timeIncrement: 1,
        });

        results.push(
          ...this.transformInsights(insights, metaAccountId, insightsService, adToCreative),
        );
      } catch (err: any) {
        this.logger.error(`Campaign ${campaigns[i].id} insights failed: ${err.message}`);
      }
    }

    return results;
  }

  // ── Asynchrónne sťahovanie cez Meta Async Reports (pre veľké účty) ───
  private async fetchViaAsyncReport(
    insightsService: InsightsService,
    metaAccountId: string,
    range: { dateFrom: string; dateTo: string },
    job: Job<InsightsSyncJobData>,
    adToCreative: Map<string, number>,
  ): Promise<RawAdInsight[]> {
    this.logger.log(`Using async report for large account ${metaAccountId}`);

    const reportRunId = await insightsService.createAsyncReport(metaAccountId, {
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      level: 'ad',
      timeIncrement: 1,
    });

    this.logger.log(`Async report created: runId=${reportRunId}`);

    // Polling kým Meta report nedokončí (s timeoutom)
    const deadline = Date.now() + ASYNC_REPORT_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const status = await insightsService.checkReportStatus(reportRunId);
      await job.updateProgress(Math.round(status.percentComplete * 0.8));

      if (status.status === 'Job Completed') break;

      if (status.status === 'Job Failed') {
        throw new Error(`Meta async report ${reportRunId} zlyhal — skúste znova`);
      }

      await new Promise((resolve) => setTimeout(resolve, ASYNC_REPORT_POLL_INTERVAL_MS));
    }

    if (Date.now() >= deadline) {
      throw new Error(`Async report ${reportRunId} timeout po ${ASYNC_REPORT_TIMEOUT_MS / 60_000} min`);
    }

    const insights = await insightsService.getAsyncReportResults(reportRunId);
    this.logger.log(`Async report returned ${insights.length} insights`);

    return this.transformInsights(insights, metaAccountId, insightsService, adToCreative);
  }

  // ── Spoločná transformácia Meta formátu → ClickHouse formát ───────────
  private transformInsights(
    insights: any[],
    metaAccountId: string,
    insightsService: InsightsService,
    adToCreative: Map<string, number>,
  ): RawAdInsight[] {
    const version = Date.now();

    return insights.map((insight) => {
      const adId = insight.ad_id ?? '0';
      const creativeId = adToCreative.get(adId) ?? 0; // 0 = opraví creative-sync neskôr

      return {
        account_id: parseInt(metaAccountId.replace('act_', ''), 10),
        campaign_id: parseInt(insight.campaign_id ?? '0', 10),
        adset_id: parseInt(insight.adset_id ?? '0', 10),
        ad_id: parseInt(adId, 10),
        creative_id: creativeId,
        date: insight.date_start,
        impressions: insight.impressions,
        clicks: insight.clicks,
        spend: insight.spend,
        reach: insight.reach ?? 0,
        frequency: insight.frequency ?? 0,
        ctr: insight.ctr ?? 0,
        cpc: insight.cpc ?? 0,
        cpm: insight.cpm ?? 0,
        video_3s_views: insightsService.extract3sVideoViews(insight),
        thru_plays: insightsService.extractThruPlays(insight),
        conversions: insightsService.extractConversions(insight),
        revenue: insightsService.extractRevenue(insight),
        platform: 'meta',
        currency: 'USD',
        updated_at: new Date().toISOString().replace('T', ' ').split('.')[0],
        version,
      };
    });
  }
}
