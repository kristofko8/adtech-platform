import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CapiService } from './capi.service';
import { CapiController } from './capi.controller';

@Module({
  imports: [HttpModule],
  controllers: [CapiController],
  providers: [CapiService],
  exports: [CapiService],
})
export class CapiModule {}
