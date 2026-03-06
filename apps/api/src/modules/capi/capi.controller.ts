import { Controller, Post, Body, Param, Get, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { CapiService, CapiEventData } from './capi.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { MetaTokenEncryptionService } from '../meta-auth/meta-token-encryption.service';

// Tento endpoint je dostupný aj bez JWT — volá ho server klienta (napr. Stripe webhook)
@Controller('capi')
export class CapiController {
  constructor(
    private readonly capiService: CapiService,
    private readonly prisma: PrismaService,
    private readonly encryption: MetaTokenEncryptionService,
  ) {}

  // Server-to-server endpoint pre odoslanie udalostí
  @Post('pixels/:pixelId/events')
  async sendEvents(
    @Param('pixelId') pixelId: string,
    @Body() body: {
      events: CapiEventData[];
      apiKey: string; // API kľúč pre CAPI connector autorizáciu
      testEventCode?: string;
    },
    @Req() req: Request,
  ) {
    // Nájdi CAPI connector pre daný pixel
    const connector = await this.prisma.capiConnector.findFirst({
      where: { pixelId, isActive: true },
    });

    if (!connector) {
      return { error: 'CAPI connector not found for this pixel' };
    }

    const accessToken = this.encryption.decrypt(connector.accessToken);

    // Pridaj IP adresu a User-Agent ak chýbajú
    const enrichedEvents = body.events.map((event) => ({
      ...event,
      userData: {
        clientIpAddress: event.userData.clientIpAddress || req.ip,
        clientUserAgent: event.userData.clientUserAgent || req.headers['user-agent'],
        ...event.userData,
      },
    }));

    return this.capiService.sendEvent(
      pixelId,
      accessToken,
      enrichedEvents,
      body.testEventCode || connector.testEventCode || undefined,
    );
  }

  // EMQ monitoring endpoint
  @Get('pixels/:pixelId/emq')
  @UseGuards(JwtAuthGuard)
  async getEmqScore(@Param('pixelId') pixelId: string) {
    const connector = await this.prisma.capiConnector.findFirst({
      where: { pixelId, isActive: true },
    });

    if (!connector) {
      return { error: 'CAPI connector not found' };
    }

    const accessToken = this.encryption.decrypt(connector.accessToken);
    const score = await this.capiService.checkEmqScore(pixelId, accessToken);

    return {
      pixelId,
      emqScore: score,
      status: score && score >= 6.0 ? 'good' : 'needs_improvement',
    };
  }
}
