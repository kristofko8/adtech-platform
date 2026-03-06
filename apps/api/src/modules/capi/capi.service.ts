import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import * as Redis from 'ioredis';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { CAPI_EVENT_DEDUP_WINDOW_HOURS, CAPI_MIN_EMQ_SCORE } from '@adtech/shared-types';
import { PiiNormalizerService, type RawUserData } from './pii-normalizer.service';

export interface CapiEventData {
  eventName: string;
  eventTime: number; // Unix timestamp
  eventId: string;   // UUID pre deduplikáciu
  eventSourceUrl?: string;
  userData: RawUserData; // Rozšírené o city/state/zip/country
  customData?: {
    currency?: string;
    value?: number;
    contentIds?: string[];
    contentType?: string;
    orderId?: string;
  };
  actionSource: 'website' | 'app' | 'physical_store' | 'chat' | 'email' | 'crm';
}

export interface CapiResponse {
  eventsReceived: number;
  fbtrace_id: string;
  messages?: string[];
}

// ============================================================
// Conversions API (CAPI) Servis
// Server-side odosielanie udalostí s deduplikáciou a SHA-256
// ============================================================
@Injectable()
export class CapiService {
  private readonly logger = new Logger(CapiService.name);
  private readonly redis: Redis.Redis;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly piiNormalizer: PiiNormalizerService,
  ) {
    this.redis = new Redis.Redis({
      host: config.get('redis.host'),
      port: config.get('redis.port'),
      password: config.get('redis.password'),
    });
  }

  // Odoslanie udalosti do Meta CAPI
  async sendEvent(
    pixelId: string,
    accessToken: string,
    events: CapiEventData[],
    testEventCode?: string,
  ): Promise<CapiResponse> {
    const apiBaseUrl = this.config.get<string>('meta.apiBaseUrl');
    const apiVersion = this.config.get<string>('meta.apiVersion');

    // Kontrola deduplikácie
    const deduplicatedEvents: CapiEventData[] = [];
    for (const event of events) {
      const isDuplicate = await this.isDuplicateEvent(pixelId, event.eventId);
      if (!isDuplicate) {
        deduplicatedEvents.push(event);
        await this.markEventAsSent(pixelId, event.eventId);
      } else {
        this.logger.debug(`Skipping duplicate event: ${event.eventId}`);
      }
    }

    if (deduplicatedEvents.length === 0) {
      return { eventsReceived: 0, fbtrace_id: 'deduped' };
    }

    // Normalizácia + SHA-256 hashing PII cez PiiNormalizerService
    const hashedEvents = deduplicatedEvents.map((event) =>
      this.buildMetaPayload(event),
    );

    const payload: Record<string, any> = {
      data: hashedEvents,
    };

    if (testEventCode) {
      payload['test_event_code'] = testEventCode;
    }

    const response = await firstValueFrom(
      this.http.post<CapiResponse>(
        `${apiBaseUrl}/${apiVersion}/${pixelId}/events`,
        payload,
        {
          params: { access_token: accessToken },
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    this.logger.log(
      `CAPI: Sent ${deduplicatedEvents.length} events to pixel ${pixelId}`,
    );

    return response.data;
  }

  // Normalizácia PII + zostavenie Meta payload
  private buildMetaPayload(event: CapiEventData): Record<string, any> {
    const { userData, ...rest } = event;

    // PiiNormalizerService:
    //  - detekuje dvojité hashovanie (64-char hex → skip)
    //  - validuje formát emailu + E.164 telefónu
    //  - hashuje city/state/zip/country (Meta Extended Match)
    //  - loguje varovania pri nevalidných vstupoch
    const { hashed, warnings, hashedFieldCount } = this.piiNormalizer.normalize(userData);

    if (warnings.length > 0) {
      this.logger.warn(
        `[CapiService] PII varovania pre event "${rest.eventName}" (${rest.eventId}):\n` +
        warnings.join('\n'),
      );
    }

    if (hashedFieldCount === 0) {
      this.logger.warn(
        `[CapiService] Udalosť "${rest.eventName}" nemá žiadne PII polia — Meta EMQ bude 0`,
      );
    }

    return {
      event_name: rest.eventName,
      event_time: rest.eventTime,
      event_id: rest.eventId,
      event_source_url: rest.eventSourceUrl,
      action_source: rest.actionSource,
      user_data: hashed,
      custom_data: rest.customData,
    };
  }

  // Kontrola, či sme túto udalosť už odoslali (deduplikácia)
  private async isDuplicateEvent(pixelId: string, eventId: string): Promise<boolean> {
    const key = `capi:dedup:${pixelId}:${eventId}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  // Označenie udalosti ako odoslanej
  private async markEventAsSent(pixelId: string, eventId: string): Promise<void> {
    const key = `capi:dedup:${pixelId}:${eventId}`;
    const ttlSeconds = CAPI_EVENT_DEDUP_WINDOW_HOURS * 3600;
    await this.redis.setex(key, ttlSeconds, '1');
  }

  // Monitorovanie EMQ skóre
  async checkEmqScore(pixelId: string, accessToken: string): Promise<number | null> {
    const apiBaseUrl = this.config.get<string>('meta.apiBaseUrl');
    const apiVersion = this.config.get<string>('meta.apiVersion');

    try {
      const response = await firstValueFrom(
        this.http.get<{ data: Array<{ score: number }> }>(
          `${apiBaseUrl}/${apiVersion}/${pixelId}/event_match_quality`,
          {
            params: {
              access_token: accessToken,
              fields: 'score,event_name,coverage',
            },
          },
        ),
      );

      if (response.data?.data?.length > 0) {
        const avgScore =
          response.data.data.reduce((sum, item) => sum + item.score, 0) /
          response.data.data.length;

        // Upozornenie ak je EMQ nízke
        if (avgScore < CAPI_MIN_EMQ_SCORE) {
          this.logger.warn(
            `Low EMQ score for pixel ${pixelId}: ${avgScore.toFixed(1)}/10`,
          );
        }

        return avgScore;
      }

      return null;
    } catch (err: any) {
      this.logger.error(`Failed to check EMQ for pixel ${pixelId}: ${err.message}`);
      return null;
    }
  }
}
