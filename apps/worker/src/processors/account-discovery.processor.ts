import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { MetaHttpClient, CampaignsService } from '@adtech/meta-api';
import {
  QUEUE_ACCOUNT_DISCOVERY,
  QUEUE_INSIGHTS_SYNC,
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

    // 2. Pre každú aktívnu kampaň naplánuj sync insightov
    const today = new Date();
    const dateTo = today.toISOString().split('T')[0];

    // Synchronizácia posledných 3 dní + 72h resync okno pre iOS 14+
    const resyncFrom = new Date(today);
    resyncFrom.setHours(resyncFrom.getHours() - IOS14_RESYNC_WINDOW_HOURS);
    const dateFrom = resyncFrom.toISOString().split('T')[0];

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
      },
      {
        priority: 5,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    this.logger.log(`Scheduled insights sync for account ${metaAccountId}`);
  }
}
