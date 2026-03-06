import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { configuration } from '../config/configuration';
import { PrismaModule } from '../modules/prisma/prisma.module';
import { AuthModule } from '../modules/auth/auth.module';
import { MetaAuthModule } from '../modules/meta-auth/meta-auth.module';
import { OrganizationsModule } from '../modules/organizations/organizations.module';
import { AdAccountsModule } from '../modules/ad-accounts/ad-accounts.module';
import { MediaProxyModule } from '../modules/media-proxy/media-proxy.module';
import { RuleEngineModule } from '../modules/rule-engine/rule-engine.module';
import { CapiModule } from '../modules/capi/capi.module';
import { AdminModule } from '../modules/admin/admin.module';

@Module({
  imports: [
    // Konfigurácia
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),
    // Cron joby pre rule scheduler
    ScheduleModule.forRoot(),
    // Rate limiting pre REST API
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'long', ttl: 60000, limit: 200 },
    ]),
    // Core moduly
    PrismaModule,
    AuthModule,
    MetaAuthModule,
    OrganizationsModule,
    AdAccountsModule,
    // Biznis moduly
    MediaProxyModule,
    RuleEngineModule,
    CapiModule,
    // Admin / Monitoring
    AdminModule,  // BullBoard UI + REST queue stats
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
