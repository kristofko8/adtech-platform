import { Controller, Get, Query, Res, UseGuards, Param } from '@nestjs/common';
import { Response } from 'express';
import { MediaProxyService } from './media-proxy.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaProxyController {
  constructor(private readonly mediaProxy: MediaProxyService) {}

  // Endpoint: /api/v1/media/preview?creative_id=XXX&account_id=act_YYY
  // Frontend nikdy nepoužíva Meta CDN URL priamo — vždy cez tento proxy
  @Get('preview')
  async getPreview(
    @Query('creative_id') creativeId: string,
    @Query('account_id') accountId: string,
    @Query('access_token') accessToken: string,
    @Query('app_secret_proof') appSecretProof: string,
    @Res() res: Response,
  ) {
    const url = await this.mediaProxy.getProxyUrl(
      creativeId,
      accessToken,
      appSecretProof,
      accountId,
    );

    if (!url) {
      return res.status(404).json({ error: 'Creative URL not found' });
    }

    // 302 redirect na čerstvú CDN URL
    // Alternatíva: streamovanie obsahu cez proxy
    return res.redirect(302, url);
  }
}
