import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@adtech/database';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7: connection URL sa odovzdáva cez adapter
function createPrismaClient() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('[PrismaService] DATABASE_URL nie je nastavená');
  }
  const adapter = new PrismaPg({ connectionString });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new PrismaClient({ adapter } as any);
}

// Use composition to avoid TypeScript issues with dynamic class extension
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;

  constructor() {
    this.client = createPrismaClient();
  }

  // Expose db models directly for convenience
  get organization() { return this.client.organization; }
  get user() { return this.client.user; }
  get refreshToken() { return this.client.refreshToken; }
  get metaToken() { return this.client.metaToken; }
  get adAccount() { return this.client.adAccount; }
  get automationRule() { return this.client.automationRule; }
  get ruleExecution() { return this.client.ruleExecution; }
  get syncJob() { return this.client.syncJob; }
  get assetMap() { return this.client.assetMap; }
  get metaCreativeMap() { return this.client.metaCreativeMap; }
  get capiConnector() { return this.client.capiConnector; }
  get notification() { return this.client.notification; }
  get auditLog() { return this.client.auditLog; }

  get $transaction() { return this.client.$transaction.bind(this.client); }
  get $connect() { return this.client.$connect.bind(this.client); }
  get $disconnect() { return this.client.$disconnect.bind(this.client); }

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }

  // Helper pre transakcie
  async executeInTransaction<T>(
    fn: (client: PrismaClient) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(async (tx) => {
      return fn(tx as unknown as PrismaClient);
    });
  }
}
