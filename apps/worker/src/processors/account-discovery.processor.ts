import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { MetaHttpClient, CampaignsService } from '@adtech/meta-api';
import {
  QUEUE_ACCOUNT_DISCOVERY,
  QUEUE_INSIGHTS_SYNC,
  QUEUE_CREATIVE_SYNC,
  IOS14_RESYNC_WINDOW_HOURS,
} from '@adtech/shared-types';

export interface AccountDiscoveryJobData {
  adAccountId: string;
  metaAccountId: string;
  accessToken: string;
  appSecretProof: string;
}

@Processor(QUEUE_ACCOUNT_DISCOVERY)
export class AccountDiscoveryProcessor extends WorkerHost {
  private readonly logger = new Logger(AccountDiscoveryProcessor.name);
  private readonly prisma = new PrismaClient();

  constructor(
    @InjectQueue(QUEUE_INSIGHTS_SYNC)
    private readonly insightsSyncQueue: Queue,
    @InjectQueue(QUEUE_CREATIVE_SYNC)
    private readonly creativeSyncQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<AccountDiscoveryJobData>): Promise<void> {
    const { adAccountId, metaAccountId, accessToken, appSecretProof } = job.data;

    this.logger.log(`Running account discovery for ${metaAccountId}`);

    const metaClient = new MetaHttpClient({
      accessToken,
      appSecretProof,
      accountId: metaAccountId,
    });

    const campaignsService = new CampaignsService(metaClient);

    // 1. Stiahnutie a uloženie štruktúry kampaní
    const campaigns = await campaignsService.getCampaigns(metaAccountId);
    this.logger.log(`Discovered ${campaigns.length} campaigns`);

    const today = new Date();
    const dateTo = today.toISOString().split('T')[0];

    const resyncFrom = new Date(today);
    resyncFrom.setHours(resyncFrom.getHours() - IOS14_RESYNC_WINDOW_HOURS);
    const dateFrom = resyncFrom.toISOString().split('T')[0];

    // 2. Spusti creative-sync ako PRVÝ — aby insights-sync vedel creative_id hneď
    await this.creativeSyncQueue.add(
      'sync-creatives',
      { adAccountId, metaAccountId, accessToken, appSecretProof },
      {
        priority: 1,   // Vyššia priorita ako insights-sync
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        jobId: `creative-sync:${metaAccountId}:${dateTo}`, // Zabráni duplikátom
      },
    );

    // 3. Naplánuj insights-sync s oneskorením 30s (čas pre creative-sync)
    // V produkcii je lepšie event-driven cez job completion hook
    await this.insightsSyncQueue.add(
      'sync-insights',
      {
        adAccountId,
        metaAccountId,
        accessToken,
        appSecretProof,
        dateFrom,
        dateTo,
        isResync: true,
        forceAsync: campaigns.length >= 50,
      },
      {
        priority: 5,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        delay: 30_000, // 30s oneskorenie — dáva čas creative-sync dokončiť sa
      },
    );

    this.logger.log(
      `Scheduled creative-sync (priority 1) + insights-sync (priority 5, delay 30s) for ${metaAccountId}`,
    );
  }
}
