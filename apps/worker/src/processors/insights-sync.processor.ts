import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
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
  isResync?: boolean; // Pre iOS 14+ resync okno
}

@Processor(QUEUE_INSIGHTS_SYNC)
export class InsightsSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(InsightsSyncProcessor.name);
  private readonly prisma = new PrismaClient();
  private readonly insightsRepo = new InsightsRepository();

  async process(job: Job<InsightsSyncJobData>): Promise<void> {
    const { adAccountId, metaAccountId, accessToken, appSecretProof, dateFrom, dateTo, isResync } = job.data;

    this.logger.log(`Processing insights sync for account ${metaAccountId}, ${dateFrom} - ${dateTo}, resync: ${isResync}`);

    const metaClient = new MetaHttpClient({
      accessToken,
      appSecretProof,
      accountId: metaAccountId,
    });

    const insightsService = new InsightsService(metaClient);
    const campaignsService = new CampaignsService(metaClient);

    try {
      // 1. Získaj zoznam aktívnych kampaní
      const campaigns = await campaignsService.getCampaigns(metaAccountId);

      this.logger.log(`Found ${campaigns.length} campaigns for account ${metaAccountId}`);

      // 2. Pre každú kampaň stiahni insighty na úrovni Ad
      const allInsights: RawAdInsight[] = [];

      for (const campaign of campaigns) {
        await job.updateProgress(
          Math.round((campaigns.indexOf(campaign) / campaigns.length) * 100),
        );

        try {
          const insights = await insightsService.getInsights(campaign.id, {
            dateFrom,
            dateTo,
            level: 'ad',
            timeIncrement: 1,
          });

          // 3. Transformácia Meta formátu na ClickHouse formát
          for (const insight of insights) {
            const version = Date.now();

            allInsights.push({
              account_id: parseInt(metaAccountId.replace('act_', ''), 10),
              campaign_id: parseInt(insight.campaign_id || campaign.id, 10),
              adset_id: parseInt(insight.adset_id || '0', 10),
              ad_id: parseInt(insight.ad_id || '0', 10),
              creative_id: 0, // Bude naplnené v ďalšom kroku (creative sync)
              date: insight.date_start,
              impressions: insight.impressions,
              clicks: insight.clicks,
              spend: insight.spend,
              reach: 0,
              frequency: insight.frequency || 0,
              ctr: insight.ctr || 0,
              cpc: insight.cpc || 0,
              cpm: insight.cpm || 0,
              video_3s_views: insightsService.extract3sVideoViews(insight),
              thru_plays: insightsService.extractThruPlays(insight),
              conversions: insightsService.extractConversions(insight),
              revenue: insightsService.extractRevenue(insight),
              platform: 'meta',
              currency: 'USD',
              updated_at: new Date().toISOString().replace('T', ' ').split('.')[0],
              version,
            });
          }
        } catch (err: any) {
          this.logger.error(`Failed to fetch insights for campaign ${campaign.id}: ${err.message}`);
        }
      }

      // 4. Batch insert do ClickHouse
      if (allInsights.length > 0) {
        // Chunked insert pre veľké objemy
        const chunkSize = 1000;
        for (let i = 0; i < allInsights.length; i += chunkSize) {
          const chunk = allInsights.slice(i, i + chunkSize);
          await this.insightsRepo.batchInsert(chunk);
        }

        this.logger.log(`Inserted ${allInsights.length} insight records for account ${metaAccountId}`);
      }

      // 5. Aktualizácia sync job záznamu
      await this.prisma.syncJob.updateMany({
        where: {
          adAccountId,
          status: 'RUNNING',
          type: 'INSIGHTS',
        },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          itemsProcessed: allInsights.length,
        },
      });

    } catch (err: any) {
      this.logger.error(`Insights sync failed for account ${metaAccountId}: ${err.message}`);
      throw err; // Re-throw pre BullMQ retry mechanizmus
    }
  }
}
