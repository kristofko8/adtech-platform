import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnomalyQueries } from '@adtech/analytics';
import { MetaHttpClient, CampaignsService } from '@adtech/meta-api';
import {
  ANOMALY_Z_SCORE_WARNING,
  ANOMALY_Z_SCORE_CRITICAL,
} from '@adtech/shared-types';

export interface RuleCondition {
  metric: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  value: number;
  window: string;
}

export interface RuleAction {
  action: string;
  params?: Record<string, any>;
}

@Injectable()
export class RuleEngineService {
  private readonly logger = new Logger(RuleEngineService.name);
  private readonly anomalyQueries = new AnomalyQueries();

  constructor(private readonly prisma: PrismaService) {}

  // Spustenie všetkých aktívnych pravidiel pre daný účet
  async evaluateRulesForAccount(adAccountId: string): Promise<void> {
    const account = await this.prisma.adAccount.findUniqueOrThrow({
      where: { id: adAccountId },
      include: {
        automationRules: {
          where: { status: 'ACTIVE' },
        },
      },
    });

    this.logger.log(`Evaluating ${account.automationRules.length} rules for account ${account.metaAccountId}`);

    for (const rule of account.automationRules) {
      try {
        await this.evaluateRule(rule, account);
      } catch (err: any) {
        this.logger.error(`Rule ${rule.id} evaluation failed: ${err.message}`);
      }
    }
  }

  private async evaluateRule(rule: any, account: any): Promise<void> {
    // Kontrola cooldown periody
    if (rule.lastTriggeredAt) {
      const cooldownMs = rule.cooldownMinutes * 60 * 1000;
      const nextAllowed = new Date(rule.lastTriggeredAt.getTime() + cooldownMs);
      if (new Date() < nextAllowed) {
        this.logger.debug(`Rule ${rule.id} is in cooldown period`);
        return;
      }
    }

    // Kontrola denného limitu vykonaní
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayExecutions = await this.prisma.ruleExecution.count({
      where: {
        ruleId: rule.id,
        triggeredAt: { gte: today },
        result: 'success',
      },
    });

    if (todayExecutions >= rule.maxExecutionsPerDay) {
      this.logger.debug(`Rule ${rule.id} reached daily execution limit`);
      return;
    }

    // Vyhodnotenie podmienok pravidla
    const conditions = rule.conditions as RuleCondition[];
    const triggered = await this.checkConditions(conditions, account);

    if (!triggered) return;

    // Vykonanie akcií pravidla
    const actions = rule.actions as RuleAction[];
    await this.executeActions(actions, account, rule);

    // Aktualizácia záznamu pravidla
    await this.prisma.automationRule.update({
      where: { id: rule.id },
      data: {
        lastTriggeredAt: new Date(),
        executionCount: { increment: 1 },
      },
    });
  }

  private async checkConditions(
    conditions: RuleCondition[],
    account: any,
  ): Promise<boolean> {
    const accountIdNum = parseInt(account.metaAccountId.replace('act_', ''), 10);

    // Získaj anomálie pre účet
    const anomalies = await this.anomalyQueries.detectAccountAnomalies(accountIdNum);

    // Všetky podmienky musia byť splnené (AND logika)
    for (const condition of conditions) {
      const anomaly = anomalies.find((a) => a.metric === condition.metric);

      if (!anomaly) {
        // Žiadna anomália pre danú metriku — podmienka nie je splnená
        if (condition.operator === 'lt' && condition.value < 0) {
          // Pravidlo čaká na pokles pod prahovú hodnotu
          continue;
        }
        return false;
      }

      const currentValue = anomaly.currentValue;
      const satisfied = this.evaluateOperator(currentValue, condition.operator, condition.value);

      if (!satisfied) return false;
    }

    return true;
  }

  private evaluateOperator(
    value: number,
    operator: string,
    threshold: number,
  ): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'lt': return value < threshold;
      case 'gte': return value >= threshold;
      case 'lte': return value <= threshold;
      case 'eq': return Math.abs(value - threshold) < 0.001;
      default: return false;
    }
  }

  private async executeActions(
    actions: RuleAction[],
    account: any,
    rule: any,
  ): Promise<void> {
    const actionsTaken: string[] = [];

    for (const action of actions) {
      this.logger.log(`Executing action ${action.action} for rule ${rule.id}`);

      switch (action.action) {
        case 'SEND_NOTIFICATION':
          await this.sendNotification(rule, account, action.params);
          actionsTaken.push('notification_sent');
          break;

        case 'PAUSE_CAMPAIGN':
          // V produkcii: volanie Meta API pre pause
          this.logger.warn(`[DRY RUN] Would pause campaigns for account ${account.metaAccountId}`);
          actionsTaken.push('campaign_paused');
          break;

        case 'INCREASE_BUDGET':
          const increaseBy = action.params?.['increasePercent'] || 15;
          this.logger.warn(`[DRY RUN] Would increase budget by ${increaseBy}% for account ${account.metaAccountId}`);
          actionsTaken.push(`budget_increased_${increaseBy}pct`);
          break;

        case 'DECREASE_BUDGET':
          const decreaseBy = action.params?.['decreasePercent'] || 20;
          this.logger.warn(`[DRY RUN] Would decrease budget by ${decreaseBy}% for account ${account.metaAccountId}`);
          actionsTaken.push(`budget_decreased_${decreaseBy}pct`);
          break;

        case 'MARK_CREATIVE_FATIGUED':
          actionsTaken.push('creative_marked_fatigued');
          break;
      }
    }

    // Záznam o vykonaní pravidla
    await this.prisma.ruleExecution.create({
      data: {
        ruleId: rule.id,
        result: 'success',
        details: {
          actionsTaken,
          triggeredAt: new Date().toISOString(),
          accountId: account.metaAccountId,
        },
      },
    });
  }

  private async sendNotification(
    rule: any,
    account: any,
    params?: Record<string, any>,
  ): Promise<void> {
    await this.prisma.notification.create({
      data: {
        channel: 'IN_APP',
        title: `Rule Triggered: ${rule.name}`,
        message: `Rule "${rule.name}" was triggered for account ${account.name}`,
        payload: { ruleId: rule.id, accountId: account.id, params },
      },
    });
  }
}
