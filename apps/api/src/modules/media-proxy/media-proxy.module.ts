import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MediaProxyService } from './media-proxy.service';
import { MediaProxyController } from './media-proxy.controller';

@Module({
  imports: [HttpModule],
  controllers: [MediaProxyController],
  providers: [MediaProxyService],
  exports: [MediaProxyService],
})
export class MediaProxyModule {}
