import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { RuleEngineService } from './rule-engine.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '@adtech/database';
import { PrismaService } from '../prisma/prisma.service';

@Controller('rules')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RuleEngineController {
  constructor(
    private readonly ruleEngine: RuleEngineService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('ad-accounts/:accountId/evaluate')
  @Roles(UserRole.MEDIA_BUYER)
  async evaluateNow(
    @Param('accountId') accountId: string,
  ) {
    await this.ruleEngine.evaluateRulesForAccount(accountId);
    return { message: 'Rule evaluation completed' };
  }

  @Get('ad-accounts/:accountId/executions')
  async getExecutions(
    @Param('accountId') accountId: string,
    @CurrentUser() user: any,
  ) {
    return this.prisma.ruleExecution.findMany({
      where: {
        rule: { adAccountId: accountId },
      },
      include: { rule: { select: { name: true, type: true } } },
      orderBy: { triggeredAt: 'desc' },
      take: 50,
    });
  }
}
