import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as Redis from 'ioredis';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { CAPI_EVENT_DEDUP_WINDOW_HOURS, CAPI_MIN_EMQ_SCORE } from '@adtech/shared-types';

export interface CapiEventData {
  eventName: string;
  eventTime: number; // Unix timestamp
  eventId: string;   // UUID pre deduplikáciu
  eventSourceUrl?: string;
  userData: {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    externalId?: string;
    clientIpAddress?: string;
    clientUserAgent?: string;
    fbp?: string;    // _fbp cookie
    fbc?: string;    // _fbc cookie
  };
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

    // Hashujeme osobné údaje (PII)
    const hashedEvents = deduplicatedEvents.map((event) =>
      this.hashUserData(event),
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

  // SHA-256 hashing všetkých PII polí
  private hashUserData(event: CapiEventData): Record<string, any> {
    const { userData, ...rest } = event;

    const hashedUser: Record<string, string | undefined> = {};

    if (userData.email) {
      hashedUser['em'] = this.sha256(userData.email.toLowerCase().trim());
    }
    if (userData.phone) {
      // Normalizácia: len číslice, bez medzier
      const normalizedPhone = userData.phone.replace(/\D/g, '');
      hashedUser['ph'] = this.sha256(normalizedPhone);
    }
    if (userData.firstName) {
      hashedUser['fn'] = this.sha256(userData.firstName.toLowerCase().trim());
    }
    if (userData.lastName) {
      hashedUser['ln'] = this.sha256(userData.lastName.toLowerCase().trim());
    }
    if (userData.externalId) {
      hashedUser['external_id'] = this.sha256(userData.externalId);
    }

    // Tieto polia sa NEHASHUJÚ
    if (userData.clientIpAddress) hashedUser['client_ip_address'] = userData.clientIpAddress;
    if (userData.clientUserAgent) hashedUser['client_user_agent'] = userData.clientUserAgent;
    if (userData.fbp) hashedUser['fbp'] = userData.fbp;
    if (userData.fbc) hashedUser['fbc'] = userData.fbc;

    return {
      event_name: rest.eventName,
      event_time: rest.eventTime,
      event_id: rest.eventId,
      event_source_url: rest.eventSourceUrl,
      action_source: rest.actionSource,
      user_data: hashedUser,
      custom_data: rest.customData,
    };
  }

  private sha256(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
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
