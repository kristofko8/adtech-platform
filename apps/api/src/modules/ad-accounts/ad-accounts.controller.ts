import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { AdAccountsService } from './ad-accounts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@adtech/database';

@Controller('ad-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdAccountsController {
  constructor(private readonly adAccountsService: AdAccountsService) {}

  @Post('connect')
  @Roles(UserRole.MEDIA_BUYER)
  connect(
    @Body() body: { metaAccountId: string; metaTokenId: string },
    @CurrentUser() user: any,
  ) {
    return this.adAccountsService.connectAccount({
      ...body,
      organizationId: user.organizationId,
    });
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.adAccountsService.findAll(user.organizationId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.adAccountsService.findById(id, user.organizationId);
  }

  @Post(':id/sync')
  @Roles(UserRole.MEDIA_BUYER)
  sync(@Param('id') id: string) {
    return this.adAccountsService.syncMetadata(id);
  }
}
