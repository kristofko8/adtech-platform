// ============================================================
// Creative Sync Processor
//
// Stiahne kreatívy pre daný Ad Account z Meta API a:
//   1. Vytvorí/aktualizuje záznamy v AssetMap (entity resolution)
//   2. Vytvorí MetaCreativeMap záznamy (mapovanie ad_id → creative_id)
//   3. Spätne opraví creative_id = 0 záznamy v ClickHouse (backfill)
//
// Spúšťa sa po každom AccountDiscovery ako samostatný job,
// aby insights-sync mohol okamžite referovať správne creative_id.
// ============================================================

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaClient } from '@adtech/database';
import { PrismaPg } from '@prisma/adapter-pg';
import { CreativesService, MetaHttpClient, CampaignsService } from '@adtech/meta-api';
import { CreativeRepository } from '@adtech/analytics';
import { QUEUE_CREATIVE_SYNC } from '@adtech/shared-types';

export interface CreativeSyncJobData {
  adAccountId: string;
  metaAccountId: string;
  accessToken: string;
  appSecretProof: string;
}

interface AdWithCreative {
  id: string;           // Meta Ad ID
  creative?: { id: string };
  campaign_id?: string;
  adset_id?: string;
}

@Processor(QUEUE_CREATIVE_SYNC)
export class CreativeSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(CreativeSyncProcessor.name);
  private readonly prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' }) } as never);

  async process(job: Job<CreativeSyncJobData>): Promise<void> {
    const { adAccountId, metaAccountId, accessToken, appSecretProof } = job.data;

    this.logger.log(`Starting creative sync for account ${metaAccountId}`);

    const metaClient = new MetaHttpClient({
      accessToken,
      appSecretProof,
      accountId: metaAccountId,
    });

    const creativesService = new CreativesService(metaClient);
    const campaignsService = new CampaignsService(metaClient);

    // ── Krok 1: Načítaj všetky kreatívy pre účet ──────────────────────────
    const rawCreatives = await creativesService.getAccountCreatives(metaAccountId);
    this.logger.log(`Fetched ${rawCreatives.length} creatives for ${metaAccountId}`);

    // ── Krok 2: Vypočítaj globalAssetId a ulož do AssetMap ───────────────
    const creativeIdToGlobalAsset = new Map<string, string>(); // metaCreativeId → globalAssetId

    for (const creative of rawCreatives) {
      const enriched = creativesService.generateGlobalAssetId(creative);

      await this.prisma.assetMap.upsert({
        where: { globalAssetId: enriched.globalAssetId },
        create: {
          globalAssetId: enriched.globalAssetId,
          assetType: enriched.assetType,
          imageHash: creative.image_hash ?? null,
          videoId: creative.video_id ?? null,
          thumbnailUrl: creative.thumbnail_url ?? null,
          imageUrl: creative.image_url ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        update: {
          thumbnailUrl: creative.thumbnail_url ?? null,
          imageUrl: creative.image_url ?? null,
          updatedAt: new Date(),
        },
      });

      creativeIdToGlobalAsset.set(creative.id, enriched.globalAssetId);
    }

    this.logger.log(`Upserted ${creativeIdToGlobalAsset.size} asset map entries`);

    // ── Krok 3: Stiahni Ads a ich creative_id mapovanie ──────────────────
    // Meta API: GET act_{accountId}/ads?fields=id,creative{id},campaign_id,adset_id
    const ads = await metaClient.getAll<AdWithCreative>(
      `act_${metaAccountId.replace('act_', '')}/ads`,
      {
        fields: 'id,creative{id},campaign_id,adset_id',
        limit: 500,
      },
    );

    this.logger.log(`Fetched ${ads.length} ads with creative mappings`);

    // ── Krok 4: Ulož MetaCreativeMap (ad_id → creative_id) ───────────────
    let mappingsCreated = 0;
    const adIdToCreativeId = new Map<string, string>(); // Meta ad_id → Meta creative_id

    for (const ad of ads) {
      const metaCreativeId = ad.creative?.id;
      if (!metaCreativeId) continue;

      const globalAssetId = creativeIdToGlobalAsset.get(metaCreativeId);

      await this.prisma.metaCreativeMap.upsert({
        where: {
          metaAdId_adAccountId: {
            metaAdId: ad.id,
            adAccountId,
          },
        },
        create: {
          metaAdId: ad.id,
          metaCreativeId,
          adAccountId,
          globalAssetId: globalAssetId ?? null,
          updatedAt: new Date(),
        },
        update: {
          metaCreativeId,
          globalAssetId: globalAssetId ?? null,
          updatedAt: new Date(),
        },
      });

      adIdToCreativeId.set(ad.id, metaCreativeId);
      mappingsCreated++;
    }

    this.logger.log(`Upserted ${mappingsCreated} MetaCreativeMap entries`);

    // ── Krok 5: Backfill creative_id = 0 v ClickHouse ────────────────────
    await this.backfillClickHouseCreativeIds(metaAccountId, adIdToCreativeId);

    // ── Krok 6: Aktualizuj sync job záznam ───────────────────────────────
    await this.prisma.syncJob.updateMany({
      where: {
        adAccountId,
        status: 'RUNNING',
        type: 'CREATIVES',
      },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        itemsProcessed: mappingsCreated,
      },
    });

    this.logger.log(`Creative sync completed for ${metaAccountId}`);
  }

  /**
   * Opraví záznamy v ClickHouse kde creative_id = 0.
   *
   * Používa ReplacingMergeTree mechanizmus — vloží nový riadok
   * s vyšším version timestamp. ClickHouse automaticky zachová
   * posledný (najvyšší version) záznam po OPTIMIZE TABLE alebo FINAL.
   */
  private async backfillClickHouseCreativeIds(
    metaAccountId: string,
    adIdToCreativeId: Map<string, string>,
  ): Promise<void> {
    if (adIdToCreativeId.size === 0) return;

    const creativeRepo = new CreativeRepository();
    const accountNumericId = parseInt(metaAccountId.replace('act_', ''), 10);

    // Načítaj existujúce záznamy s creative_id = 0 pre daný účet
    const orphanedInsights = await creativeRepo.getOrphanedInsights(accountNumericId);

    if (orphanedInsights.length === 0) {
      this.logger.log('No orphaned insights (creative_id=0) found — nothing to backfill');
      return;
    }

    this.logger.log(`Backfilling ${orphanedInsights.length} orphaned insight records`);

    const toUpdate = orphanedInsights
      .map((insight) => {
        const metaCreativeIdStr = adIdToCreativeId.get(String(insight.ad_id));
        if (!metaCreativeIdStr) return null;

        const metaCreativeIdNum = parseInt(metaCreativeIdStr, 10);
        if (isNaN(metaCreativeIdNum)) return null;

        return {
          ...insight,
          creative_id: metaCreativeIdNum,
          version: Date.now(), // Nový vyšší version pre ReplacingMergeTree
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (toUpdate.length > 0) {
      // Chunked insert pre výkon
      const chunkSize = 500;
      for (let i = 0; i < toUpdate.length; i += chunkSize) {
        await creativeRepo.batchInsertInsights(toUpdate.slice(i, i + chunkSize));
      }
      this.logger.log(`Backfilled creative_id for ${toUpdate.length} records`);
    }
  }
}
