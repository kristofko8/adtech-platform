import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AdAccountsService } from './ad-accounts.service';
import { AdAccountsController } from './ad-accounts.controller';
import { MetaAuthModule } from '../meta-auth/meta-auth.module';

@Module({
  imports: [HttpModule, MetaAuthModule],
  controllers: [AdAccountsController],
  providers: [AdAccountsService],
  exports: [AdAccountsService],
})
export class AdAccountsModule {}
