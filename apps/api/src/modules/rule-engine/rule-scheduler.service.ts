import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RuleEngineService } from './rule-engine.service';

@Injectable()
export class RuleSchedulerService {
  private readonly logger = new Logger(RuleSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleEngine: RuleEngineService,
  ) {}

  // Budget protection: každých 15 minút
  @Cron('*/15 * * * *')
  async runBudgetProtectionRules(): Promise<void> {
    this.logger.log('Running budget protection rules...');

    const accounts = await this.prisma.adAccount.findMany({
      where: {
        status: 'ACTIVE',
        automationRules: {
          some: {
            status: 'ACTIVE',
            type: { in: ['BUDGET_PROTECTION', 'PERFORMANCE_DROP'] },
          },
        },
      },
    });

    for (const account of accounts) {
      try {
        await this.ruleEngine.evaluateRulesForAccount(account.id);
      } catch (err: any) {
        this.logger.error(`Failed to evaluate rules for account ${account.id}: ${err.message}`);
      }
    }
  }

  // Creative fatigue: každých 24 hodín (polnoc)
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runCreativeFatigueRules(): Promise<void> {
    this.logger.log('Running creative fatigue analysis...');

    const accounts = await this.prisma.adAccount.findMany({
      where: {
        status: 'ACTIVE',
        automationRules: {
          some: {
            status: 'ACTIVE',
            type: 'CREATIVE_FATIGUE',
          },
        },
      },
    });

    for (const account of accounts) {
      try {
        await this.ruleEngine.evaluateRulesForAccount(account.id);
      } catch (err: any) {
        this.logger.error(`Creative fatigue check failed for ${account.id}: ${err.message}`);
      }
    }
  }

  // Scaling winner: každých 6 hodín
  @Cron('0 */6 * * *')
  async runScalingWinnerRules(): Promise<void> {
    this.logger.log('Running scaling winner analysis...');

    const accounts = await this.prisma.adAccount.findMany({
      where: {
        status: 'ACTIVE',
        automationRules: {
          some: {
            status: 'ACTIVE',
            type: 'SCALING_WINNER',
          },
        },
      },
    });

    for (const account of accounts) {
      try {
        await this.ruleEngine.evaluateRulesForAccount(account.id);
      } catch (err: any) {
        this.logger.error(`Scaling winner check failed for ${account.id}: ${err.message}`);
      }
    }
  }
}
