// ============================================================
// EMQ Monitor Service — Event Match Quality sledovanie
//
// Meta EMQ skóre (0–10) meria kvalitu párovania konverzných
// udalostí CAPI s Facebook profilmi. Vyššie skóre = lepšie
// remarketingové publiká a presnejšia atribúcia konverzií.
//
// Meta odporúčania:
//   ≥ 7.0 → Vynikajúce (odporúčaná úroveň)
//   5.0–6.9 → Priemerné (ďalej optimalizovať)
//   < 5.0 → Nízke (urgentná optimalizácia)
//
// Čo EMQ ovplyvňuje:
//   - Počet odoslaných identifikátorov (email, telefón, meno...)
//   - Formát SHA-256 hashovania (lowercase, trim pre email)
//   - Konzistentnosť external_id s CAPI a Pixel eventmi
//
// Scheduler:
//   • Každé 4 hodiny kontrola pre všetky aktívne pixely
//   • Pri poklese < CAPI_MIN_EMQ_SCORE (7.0) → Slack alert
//   • Trend alert: pokles > 1.0 bodu za 24h → Slack varovanie
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { firstValueFrom } from 'rxjs';
import { CAPI_MIN_EMQ_SCORE } from '@adtech/shared-types';

interface EmqDataPoint {
  event_name: string;
  match_rate_approx: number;
  event_match_quality: number;
}

interface EmqCheckResult {
  pixelId: string;
  score: number | null;
  matchRate: number | null;
  eventsReceived: number;
  status: 'ok' | 'warning' | 'critical' | 'no_data';
  events: EmqDataPoint[];
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  fields?: Array<{ type: string; text: string }>;
}

@Injectable()
export class EmqMonitorService {
  private readonly logger = new Logger(EmqMonitorService.name);
  // Ukladá posledné skóre pre trend detekciu: pixelId → { score, checkedAt }
  private readonly scoreHistory = new Map<string, { score: number; checkedAt: Date }>();

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Pravidelná kontrola EMQ pre všetky aktívne CAPI konektory.
   * Beží každé 4 hodiny.
   */
  @Cron(CronExpression.EVERY_4_HOURS)
  async runScheduledEmqCheck(): Promise<void> {
    this.logger.log('Scheduled EMQ check started');

    const connectors = await this.prisma.capiConnector.findMany({
      where: { isActive: true },
      include: { adAccount: { include: { metaToken: true } } },
    });

    if (connectors.length === 0) {
      this.logger.debug('Žiadne aktívne CAPI konektory');
      return;
    }

    const results: EmqCheckResult[] = [];

    for (const connector of connectors) {
      const accessToken = connector.adAccount.metaToken?.encryptedAccessToken;
      if (!accessToken) continue;

      try {
        const result = await this.checkPixelEmq(connector.pixelId, accessToken);
        results.push(result);
        await this.processEmqResult(result, connector.adAccount.metaAccountId);
      } catch (err: any) {
        this.logger.error(`EMQ check failed pre pixel ${connector.pixelId}: ${err.message}`);
      }
    }

    this.logger.log(`EMQ check completed: ${results.length} pixelov skontrolovaných`);
  }

  /**
   * Načíta EMQ skóre priamo z Meta API.
   * Endpoint: GET /{pixel_id}?fields=event_stats{event_match_quality,...}
   */
  async checkPixelEmq(pixelId: string, accessToken: string): Promise<EmqCheckResult> {
    const apiBase = this.config.get<string>('meta.apiBaseUrl');
    const apiVersion = this.config.get<string>('meta.apiVersion');

    const url = `${apiBase}/${apiVersion}/${pixelId}`;
    const params = {
      access_token: accessToken,
      fields: [
        'event_stats{event_name,match_rate_approx,event_match_quality}',
        'stats_since_last_24h',
      ].join(','),
    };

    let eventsReceived = 0;
    let events: EmqDataPoint[] = [];

    try {
      const response = await firstValueFrom(
        this.http.get<{
          event_stats?: { data: EmqDataPoint[] };
          stats_since_last_24h?: { event_count: number };
        }>(url, { params }),
      );

      events = response.data.event_stats?.data ?? [];
      eventsReceived = response.data.stats_since_last_24h?.event_count ?? 0;
    } catch (err: any) {
      return {
        pixelId,
        score: null,
        matchRate: null,
        eventsReceived: 0,
        status: 'no_data',
        events: [],
      };
    }

    if (events.length === 0) {
      return { pixelId, score: null, matchRate: null, eventsReceived, status: 'no_data', events };
    }

    // Vážený priemer EMQ skóre cez všetky event typy
    const avgScore = events.reduce((sum, e) => sum + e.event_match_quality, 0) / events.length;
    const avgMatchRate = events.reduce((sum, e) => sum + e.match_rate_approx, 0) / events.length;

    const status =
      avgScore >= CAPI_MIN_EMQ_SCORE ? 'ok' :
      avgScore >= CAPI_MIN_EMQ_SCORE - 2 ? 'warning' : 'critical';

    return { pixelId, score: avgScore, matchRate: avgMatchRate, eventsReceived, status, events };
  }

  /**
   * Spracuje výsledok EMQ kontroly: porovná trend, odošle Slack alert.
   */
  private async processEmqResult(
    result: EmqCheckResult,
    accountId: string,
  ): Promise<void> {
    if (result.score === null) return;

    const previous = this.scoreHistory.get(result.pixelId);
    const scoreDrop = previous ? previous.score - result.score : 0;

    // Aktualizácia histórie
    this.scoreHistory.set(result.pixelId, {
      score: result.score,
      checkedAt: new Date(),
    });

    // Alert 1: Nízke absolútne skóre
    if (result.status !== 'ok') {
      await this.sendSlackEmqAlert({
        type: result.status === 'critical' ? 'KRITICKÉ' : 'VAROVANIE',
        pixelId: result.pixelId,
        score: result.score,
        matchRate: result.matchRate,
        eventsReceived: result.eventsReceived,
        accountId,
        details: this.buildRecommendations(result.score, result.events),
      });
    }

    // Alert 2: Výrazný pokles skóre (trend)
    if (scoreDrop >= 1.0 && result.status === 'ok') {
      await this.sendSlackEmqAlert({
        type: 'TREND',
        pixelId: result.pixelId,
        score: result.score,
        matchRate: result.matchRate,
        eventsReceived: result.eventsReceived,
        accountId,
        details: [`EMQ pokleslo o ${scoreDrop.toFixed(1)} boda za posledných 4 hodín.`],
      });
    }

    this.logger.log(
      `Pixel ${result.pixelId}: EMQ=${result.score?.toFixed(1)}, ` +
      `matchRate=${result.matchRate?.toFixed(0)}%, ` +
      `events24h=${result.eventsReceived}, status=${result.status}`,
    );
  }

  /**
   * Odošle Slack notifikáciu o probléme s EMQ skóre.
   */
  private async sendSlackEmqAlert(params: {
    type: string;
    pixelId: string;
    score: number | null;
    matchRate: number | null;
    eventsReceived: number;
    accountId: string;
    details: string[];
  }): Promise<void> {
    const webhookUrl = this.config.get<string>('slack.webhookUrl');
    if (!webhookUrl) return;

    const emoji = params.type === 'KRITICKÉ' ? '🔴' : params.type === 'TREND' ? '📉' : '🟡';
    const color = params.type === 'KRITICKÉ' ? '#ef4444' : '#f59e0b';

    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${emoji} CAPI EMQ ${params.type}: Pixel ${params.pixelId}`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*EMQ Skóre:*\n${params.score?.toFixed(1) ?? '—'}/10` },
          { type: 'mrkdwn', text: `*Match Rate:*\n${params.matchRate != null ? params.matchRate.toFixed(0) + '%' : '—'}` },
          { type: 'mrkdwn', text: `*Udalosti (24h):*\n${params.eventsReceived.toLocaleString()}` },
          { type: 'mrkdwn', text: `*Ad Account:*\n${params.accountId}` },
        ],
      },
    ];

    if (params.details.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Odporúčania pre zlepšenie:*\n${params.details.map((d) => `• ${d}`).join('\n')}`,
        },
      });
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Ideálne EMQ ≥ ${CAPI_MIN_EMQ_SCORE}/10*. Prah pre upozornenie: warning <${CAPI_MIN_EMQ_SCORE}, critical <${CAPI_MIN_EMQ_SCORE - 2}`,
      },
    });

    try {
      await firstValueFrom(
        this.http.post(webhookUrl, {
          attachments: [{ color, blocks }],
        }),
      );
    } catch (err: any) {
      this.logger.error(`Slack EMQ alert failed: ${err.message}`);
    }
  }

  /**
   * Generuje konkrétne odporúčania na základe skóre a event typov.
   */
  private buildRecommendations(score: number, events: EmqDataPoint[]): string[] {
    const recs: string[] = [];

    if (score < 7) {
      recs.push('Pridaj SHA-256 hashovanie emailu (lowercase + trim pred hashovaním)');
      recs.push('Odošli telefónne číslo v medzinárodnom formáte (+421...)');
    }

    if (score < 5) {
      recs.push('Skontroluj fbp/fbc cookies — musia sa posielať s každou udalosťou');
      recs.push('Implementuj external_id konzistentný s Meta Pixel (napr. interné user ID)');
      recs.push('Overif event_id deduplikáciu — duplicitné udalosti znižujú match rate');
    }

    // Event-specific recs
    const lowMatchEvents = events.filter((e) => e.match_rate_approx < 0.6);
    for (const e of lowMatchEvents.slice(0, 2)) {
      recs.push(
        `Event "${e.event_name}" má match rate ${(e.match_rate_approx * 100).toFixed(0)}% — ` +
        `skontroluj odosielané identifikátory`,
      );
    }

    return recs;
  }

  /**
   * Manuálna kontrola EMQ pre jeden pixel (pre API endpoint /capi/check-emq).
   */
  async manualCheck(pixelId: string, accessToken: string): Promise<EmqCheckResult> {
    return this.checkPixelEmq(pixelId, accessToken);
  }

  /**
   * Načíta aktuálny stav EMQ pre všetky pixely (pre dashboard).
   */
  async getAllEmqStatuses(): Promise<EmqCheckResult[]> {
    return [...this.scoreHistory.entries()].map(([pixelId, history]) => ({
      pixelId,
      score: history.score,
      matchRate: null, // Bez API volania
      eventsReceived: 0,
      status: (
        history.score >= CAPI_MIN_EMQ_SCORE ? 'ok' :
        history.score >= CAPI_MIN_EMQ_SCORE - 2 ? 'warning' : 'critical'
      ) as 'ok' | 'warning' | 'critical' | 'no_data',
      events: [],
    }));
  }
}
