import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { MetaAuthService } from '../meta-auth/meta-auth.service';

@Injectable()
export class AdAccountsService {
  private readonly logger = new Logger(AdAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly metaAuth: MetaAuthService,
  ) {}

  async connectAccount(data: {
    metaAccountId: string;
    metaTokenId: string;
    organizationId: string;
  }) {
    const apiBaseUrl = this.config.get<string>('meta.apiBaseUrl');
    const apiVersion = this.config.get<string>('meta.apiVersion');

    // Overenie tokenu a načítanie dát účtu z Meta
    const accessToken = await this.metaAuth.getValidAccessToken(data.metaTokenId);
    const appSecretProof = this.metaAuth.generateAppSecretProof(accessToken);

    const accountId = data.metaAccountId.startsWith('act_')
      ? data.metaAccountId
      : `act_${data.metaAccountId}`;

    const response = await firstValueFrom(
      this.http.get(`${apiBaseUrl}/${apiVersion}/${accountId}`, {
        params: {
          fields: 'id,name,currency,timezone_name,account_status,spend_cap,balance,business_name',
          access_token: accessToken,
          appsecret_proof: appSecretProof,
        },
      }),
    );

    const metaAccount = response.data;

    const statusMap: Record<number, string> = {
      1: 'ACTIVE',
      2: 'DISABLED',
      3: 'IN_GRACE_PERIOD',
      7: 'PENDING_REVIEW',
      8: 'PENDING_CLOSURE',
      100: 'CLOSED',
      101: 'TEMPORARILY_UNAVAILABLE',
    };

    return this.prisma.adAccount.upsert({
      where: { metaAccountId: accountId },
      create: {
        metaAccountId: accountId,
        name: metaAccount.name,
        currency: metaAccount.currency || 'USD',
        timezone: metaAccount.timezone_name || 'UTC',
        status: (statusMap[metaAccount.account_status] || 'ACTIVE') as any,
        spendCap: metaAccount.spend_cap ? parseFloat(metaAccount.spend_cap) : null,
        balance: metaAccount.balance ? parseFloat(metaAccount.balance) : null,
        businessName: metaAccount.business_name,
        organizationId: data.organizationId,
        metaTokenId: data.metaTokenId,
      },
      update: {
        name: metaAccount.name,
        status: (statusMap[metaAccount.account_status] || 'ACTIVE') as any,
        spendCap: metaAccount.spend_cap ? parseFloat(metaAccount.spend_cap) : null,
        balance: metaAccount.balance ? parseFloat(metaAccount.balance) : null,
      },
    });
  }

  async findAll(organizationId: string) {
    return this.prisma.adAccount.findMany({
      where: { organizationId },
      include: {
        _count: { select: { automationRules: true } },
      },
    });
  }

  async findById(id: string, organizationId: string) {
    const account = await this.prisma.adAccount.findFirst({
      where: { id, organizationId },
      include: { automationRules: true, capiConnectors: true },
    });
    if (!account) throw new NotFoundException('Ad account not found');
    return account;
  }

  async syncMetadata(id: string) {
    const account = await this.prisma.adAccount.findUniqueOrThrow({ where: { id } });

    await this.prisma.adAccount.update({
      where: { id },
      data: { lastSyncAt: new Date() },
    });

    return { message: 'Sync initiated', accountId: id };
  }
}
