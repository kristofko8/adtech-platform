import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import {
  QUEUE_ACCOUNT_DISCOVERY,
  QUEUE_INSIGHTS_SYNC,
  QUEUE_CREATIVE_SYNC,
  QUEUE_AUTOMATION_RULES,
  QUEUE_MEDIA_PROXY,
  QUEUE_CAPI_EVENTS,
} from '@adtech/shared-types';
import { AccountDiscoveryProcessor } from '../processors/account-discovery.processor';
import { InsightsSyncProcessor } from '../processors/insights-sync.processor';
import { CreativeSyncProcessor } from '../processors/creative-sync.processor';

const configuration = () => ({
  redis: {
    host: process.env['REDIS_HOST'] || 'localhost',
    port: parseInt(process.env['REDIS_PORT'] || '6379', 10),
    password: process.env['REDIS_PASSWORD'] || 'adtech_secret',
  },
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    // BullMQ konfigurácia s Redis
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('redis.host'),
          port: config.get('redis.port'),
          password: config.get('redis.password'),
        },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 200 },
        },
      }),
    }),
    // Registrácia všetkých front
    BullModule.registerQueue(
      { name: QUEUE_ACCOUNT_DISCOVERY },
      { name: QUEUE_INSIGHTS_SYNC },
      { name: QUEUE_CREATIVE_SYNC },
      { name: QUEUE_AUTOMATION_RULES },
      { name: QUEUE_MEDIA_PROXY },
      { name: QUEUE_CAPI_EVENTS },
    ),
  ],
  providers: [
    AccountDiscoveryProcessor,
    InsightsSyncProcessor,
    CreativeSyncProcessor,
  ],
})
export class AppModule {}
