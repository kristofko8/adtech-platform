import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import * as Redis from 'ioredis';
import { MetaHttpClient, CreativesService } from '@adtech/meta-api';
import { REDIS_TTL_CDN_URL } from '@adtech/shared-types';
import * as crypto from 'crypto';

@Injectable()
export class MediaProxyService {
  private readonly logger = new Logger(MediaProxyService.name);
  private readonly redis: Redis.Redis;

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {
    this.redis = new Redis.Redis({
      host: config.get('redis.host'),
      port: config.get('redis.port'),
      password: config.get('redis.password'),
    });
  }

  // Získanie platnej CDN URL pre kreatívu
  // Toto je jadro Media Proxy servisu
  async getProxyUrl(
    creativeId: string,
    accessToken: string,
    appSecretProof: string,
    accountId: string,
  ): Promise<string | null> {
    const cacheKey = `cdn_url:${creativeId}`;

    // 1. Skontroluj cache
    const cachedUrl = await this.redis.get(cacheKey);
    if (cachedUrl) {
      this.logger.debug(`Cache hit for creative ${creativeId}`);
      return cachedUrl;
    }

    // 2. Cache miss — vyžiadaj čerstvú URL od Meta
    this.logger.debug(`Cache miss for creative ${creativeId}, fetching from Meta`);

    try {
      const metaClient = new MetaHttpClient({
        accessToken,
        appSecretProof,
        accountId,
      });

      const creativesService = new CreativesService(metaClient);
      const freshUrls = await creativesService.getFreshCreativeUrl(creativeId);

      const url = freshUrls.imageUrl || freshUrls.thumbnailUrl;

      if (url) {
        // 3. Ulož do cache s TTL 48 hodín
        await this.redis.setex(cacheKey, REDIS_TTL_CDN_URL, url);
        return url;
      }

      return null;
    } catch (err: any) {
      this.logger.error(`Failed to fetch CDN URL for creative ${creativeId}: ${err.message}`);
      return null;
    }
  }

  // Invalidácia cache pre konkrétnu kreatívu
  async invalidateCache(creativeId: string): Promise<void> {
    await this.redis.del(`cdn_url:${creativeId}`);
  }

  // Invalidácia celého cache pre účet
  async invalidateAccountCache(accountId: string): Promise<void> {
    const pattern = `cdn_url:${accountId}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  // Archivovanie kreatívy do S3 pre dlhodobé uchovanie
  async archiveToS3(
    creativeId: string,
    sourceUrl: string,
  ): Promise<string | null> {
    try {
      // Stiahnutie obrázka
      const response = await this.http.axiosRef.get(sourceUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });

      const buffer = Buffer.from(response.data);
      const contentType = response.headers['content-type'] || 'image/jpeg';
      const extension = contentType.split('/')[1] || 'jpg';
      const s3Key = `creatives/${creativeId}.${extension}`;

      // V produkcii: upload do S3/MinIO
      this.logger.log(`Would archive creative ${creativeId} to S3: ${s3Key} (${buffer.length} bytes)`);

      return s3Key;
    } catch (err: any) {
      this.logger.error(`Failed to archive creative ${creativeId}: ${err.message}`);
      return null;
    }
  }
}
