import {
  Controller,
  Get,
  Query,
  UseGuards,
  Redirect,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MetaAuthService } from './meta-auth.service';
import { ConfigService } from '@nestjs/config';

@Controller('auth/meta')
export class MetaAuthController {
  constructor(
    private readonly metaAuthService: MetaAuthService,
    private readonly config: ConfigService,
  ) {}

  // Endpoint pre inicializáciu OAuth flow
  @Get('connect')
  @UseGuards(JwtAuthGuard)
  initiateOAuth(@CurrentUser() user: any) {
    const authUrl = this.metaAuthService.generateAuthUrl(
      user.organizationId,
      user.id,
    );
    return { authUrl };
  }

  // Callback endpoint — Meta presmeruje sem po autorizácii
  @Get('callback')
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const frontendUrl = this.config.get<string>('frontendUrl');

    if (error) {
      return res.redirect(`${frontendUrl}/settings/integrations?error=${encodeURIComponent(error)}`);
    }

    try {
      const result = await this.metaAuthService.exchangeCodeForToken(code, state);
      return res.redirect(
        `${frontendUrl}/settings/integrations?success=true&tokenId=${result.tokenId}`,
      );
    } catch (err: any) {
      return res.redirect(
        `${frontendUrl}/settings/integrations?error=${encodeURIComponent(err.message)}`,
      );
    }
  }
}
