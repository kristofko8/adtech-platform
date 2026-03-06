import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CapiService } from './capi.service';
import { CapiController } from './capi.controller';
import { EmqMonitorService } from './emq-monitor.service';
import { PiiNormalizerService } from './pii-normalizer.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MetaAuthModule } from '../meta-auth/meta-auth.module';

@Module({
  imports: [HttpModule, PrismaModule, MetaAuthModule],
  controllers: [CapiController],
  providers: [
    PiiNormalizerService,  // SHA-256 normalizácia PII + ochrana pred dvojitým hashovaním
    CapiService,
    EmqMonitorService,     // Pravidelný EMQ monitoring + Slack notifikácie
  ],
  exports: [CapiService, EmqMonitorService, PiiNormalizerService],
})
export class CapiModule {}
