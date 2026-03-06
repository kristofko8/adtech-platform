import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CapiService } from './capi.service';
import { CapiController } from './capi.controller';
import { EmqMonitorService } from './emq-monitor.service';

@Module({
  imports: [HttpModule],
  controllers: [CapiController],
  providers: [
    CapiService,
    EmqMonitorService,   // Pravidelný EMQ monitoring + Slack notifikácie
  ],
  exports: [CapiService, EmqMonitorService],
})
export class CapiModule {}
