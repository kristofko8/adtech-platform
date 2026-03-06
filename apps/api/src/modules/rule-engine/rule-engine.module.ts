import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RuleEngineService } from './rule-engine.service';
import { RuleEngineController } from './rule-engine.controller';
import { RuleSchedulerService } from './rule-scheduler.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [RuleEngineController],
  providers: [RuleEngineService, RuleSchedulerService],
  exports: [RuleEngineService],
})
export class RuleEngineModule {}
