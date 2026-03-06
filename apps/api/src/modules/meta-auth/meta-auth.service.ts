import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MetaTokenEncryptionService } from './meta-token-encryption.service';

interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

interface MetaUserInfo {
  id: string;
  name: string;
  email?: string;
}

@Injectable()
export class MetaAuthService {
  private readonly logger = new Logger(MetaAuthService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly encryption: MetaTokenEncryptionService,
  ) {}

  // Generovanie OAuth URL pre presmerovanie používateľa na Meta
  generateAuthUrl(organizationId: string, userId: string): string {
    const appId = this.config.get<string>('meta.appId');
    const redirectUri = this.config.get<string>('meta.redirectUri');

    // State parameter pre CSRF ochranu
    const state = Buffer.from(JSON.stringify({ organizationId, userId })).toString('base64');

    const scopes = [
      'ads_management',
      'ads_read',
      'business_management',
      'read_insights',
    ].join(',');

    return [
      `https://www.facebook.com/dialog/oauth`,
      `?client_id=${appId}`,
      `&redirect_uri=${encodeURIComponent(redirectUri || '')}`,
      `&scope=${scopes}`,
      `&response_type=code`,
      `&state=${encodeURIComponent(state)}`,
    ].join('');
  }

  // Výmena auth kódu za prístupový token
  async exchangeCodeForToken(code: string, state: string): Promise<{
    organizationId: string;
    userId: string;
    tokenId: string;
  }> {
    const appId = this.config.get<string>('meta.appId');
    const appSecret = this.config.get<string>('meta.appSecret');
    const redirectUri = this.config.get<string>('meta.redirectUri');
    const apiBaseUrl = this.config.get<string>('meta.apiBaseUrl');
    const apiVersion = this.config.get<string>('meta.apiVersion');

    // Dekódovanie state pre získanie organizácie a používateľa
    let stateData: { organizationId: string; userId: string };
    try {
      stateData = JSON.parse(Buffer.from(decodeURIComponent(state), 'base64').toString());
    } catch {
      throw new BadRequestException('Invalid state parameter');
    }

    // Výmena kódu za krátkodobý token
    const tokenResponse = await firstValueFrom(
      this.http.get<MetaTokenResponse>(`${apiBaseUrl}/${apiVersion}/oauth/access_token`, {
        params: {
          client_id: appId,
          client_secret: appSecret,
          redirect_uri: redirectUri,
          code,
        },
      }),
    );

    const shortLivedToken = tokenResponse.data.access_token;

    // Konverzia na dlhodobý token (60 dní)
    const longLivedResponse = await firstValueFrom(
      this.http.get<MetaTokenResponse>(`${apiBaseUrl}/${apiVersion}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortLivedToken,
        },
      }),
    );

    const longLivedToken = longLivedResponse.data.access_token;

    // Získanie informácií o používateľovi
    const userInfo = await firstValueFrom(
      this.http.get<MetaUserInfo>(`${apiBaseUrl}/${apiVersion}/me`, {
        params: {
          fields: 'id,name,email',
          access_token: longLivedToken,
        },
      }),
    );

    // Výpočet expirácie (60 dní)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 60);

    // Zašifrovanie tokenov pred uložením
    const encryptedShortToken = this.encryption.encrypt(shortLivedToken);
    const encryptedLongToken = this.encryption.encrypt(longLivedToken);

    // Uloženie do databázy
    const metaToken = await this.prisma.metaToken.create({
      data: {
        accessToken: encryptedShortToken,
        longLivedToken: encryptedLongToken,
        tokenType: 'bearer',
        expiresAt,
        appScopedUserId: userInfo.data.id,
        scopes: ['ads_management', 'ads_read', 'business_management', 'read_insights'],
        organizationId: stateData.organizationId,
      },
    });

    this.logger.log(`Meta token created for org ${stateData.organizationId}, user ${userInfo.data.id}`);

    return {
      organizationId: stateData.organizationId,
      userId: stateData.userId,
      tokenId: metaToken.id,
    };
  }

  // Získanie decryptovaného prístupového tokenu (vždy aktuálneho)
  async getValidAccessToken(tokenId: string): Promise<string> {
    const metaToken = await this.prisma.metaToken.findUniqueOrThrow({
      where: { id: tokenId },
    });

    if (!metaToken.isActive) {
      throw new UnauthorizedException('Meta token is inactive');
    }

    // Kontrola expirácie s rezervou 7 dní
    if (metaToken.expiresAt) {
      const sevenDaysFromNow = new Date();
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

      if (metaToken.expiresAt < sevenDaysFromNow) {
        this.logger.warn(`Token ${tokenId} expires soon, refreshing...`);
        return this.refreshLongLivedToken(tokenId);
      }
    }

    // Preferujeme long-lived token
    const tokenToDecrypt = metaToken.longLivedToken || metaToken.accessToken;
    return this.encryption.decrypt(tokenToDecrypt);
  }

  // Obnova dlhodobého tokenu pred expiráciou
  async refreshLongLivedToken(tokenId: string): Promise<string> {
    const appId = this.config.get<string>('meta.appId');
    const appSecret = this.config.get<string>('meta.appSecret');
    const apiBaseUrl = this.config.get<string>('meta.apiBaseUrl');
    const apiVersion = this.config.get<string>('meta.apiVersion');

    const metaToken = await this.prisma.metaToken.findUniqueOrThrow({
      where: { id: tokenId },
    });

    const currentToken = this.encryption.decrypt(
      metaToken.longLivedToken || metaToken.accessToken,
    );

    try {
      const response = await firstValueFrom(
        this.http.get<MetaTokenResponse>(`${apiBaseUrl}/${apiVersion}/oauth/access_token`, {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: currentToken,
          },
        }),
      );

      const newToken = response.data.access_token;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 60);

      await this.prisma.metaToken.update({
        where: { id: tokenId },
        data: {
          longLivedToken: this.encryption.encrypt(newToken),
          expiresAt,
          lastRefreshedAt: new Date(),
        },
      });

      this.logger.log(`Token ${tokenId} refreshed successfully`);
      return newToken;
    } catch (error) {
      this.logger.error(`Failed to refresh token ${tokenId}:`, error);
      // Deaktivovanie tokenu ak refresh zlyhá opakovane
      await this.prisma.metaToken.update({
        where: { id: tokenId },
        data: { isActive: false },
      });
      throw new UnauthorizedException('Meta token expired and could not be refreshed');
    }
  }

  // Výpočet appsecret_proof pre zabezpečenie API volaní
  generateAppSecretProof(accessToken: string): string {
    const appSecret = this.config.get<string>('meta.appSecret') || '';
    return crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex');
  }
}
