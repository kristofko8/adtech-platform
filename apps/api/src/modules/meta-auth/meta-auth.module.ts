import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MetaAuthService } from './meta-auth.service';
import { MetaAuthController } from './meta-auth.controller';
import { MetaTokenEncryptionService } from './meta-token-encryption.service';

@Module({
  imports: [HttpModule],
  controllers: [MetaAuthController],
  providers: [MetaAuthService, MetaTokenEncryptionService],
  exports: [MetaAuthService, MetaTokenEncryptionService],
})
export class MetaAuthModule {}
