import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { QueueMonitorService } from './queue-monitor.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

// ============================================================
// AdminController — REST endpointy pre monitorovanie front
//
// Všetky endpointy sú chránené JWT Auth.
//
// Endpointy:
//   GET  /admin/queues/stats         — snapshot všetkých front
//   GET  /admin/queues/:name/failed  — posledné zlyhané joby
//   POST /admin/queues/:name/retry   — retry zlyhaných jobov
// ============================================================

@Controller('admin/queues')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private readonly queueMonitor: QueueMonitorService) {}

  // Snapshot stavu všetkých front
  @Get('stats')
  async getStats() {
    return this.queueMonitor.getSnapshot();
  }

  // Posledné zlyhané joby pre konkrétnu frontu
  @Get(':name/failed')
  async getFailedJobs(@Param('name') name: string) {
    const jobs = await this.queueMonitor.getFailedJobs(name, 25);
    return { queue: name, failedJobs: jobs, count: jobs.length };
  }

  // Retry všetkých zlyhaných jobov
  @Post(':name/retry')
  @HttpCode(HttpStatus.OK)
  async retryFailed(@Param('name') name: string) {
    const count = await this.queueMonitor.retryFailed(name);
    return { queue: name, retriedCount: count, message: `Spustený retry pre ${count} jobov` };
  }
}
