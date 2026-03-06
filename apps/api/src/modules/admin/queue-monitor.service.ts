import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

// ============================================================
// QueueMonitorService
//
// Monitoruje stav BullMQ front pripojením sa na Redis (read-only).
// Poskytuje štatistiky pre REST endpoint (/admin/queues/stats)
// aj pre BullBoard UI middleware.
//
// Fronty:
//   - account-discovery  : objavy nových Ad Accounts
//   - insights-sync      : ETL synchronizácia insights z Meta
//   - creative-sync      : synchronizácia kreatív + backfill
// ============================================================

export interface QueueStat {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  isPaused: boolean;
}

export interface QueueMonitorSnapshot {
  queues: QueueStat[];
  fetchedAt: string;
  redisConnected: boolean;
}

const QUEUE_NAMES = ['account-discovery', 'insights-sync', 'creative-sync'] as const;

@Injectable()
export class QueueMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueMonitorService.name);
  readonly queues: Queue[] = [];

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const connection = {
      host: this.config.get<string>('redis.host', 'localhost'),
      port: this.config.get<number>('redis.port', 6379),
      password: this.config.get<string>('redis.password') || undefined,
    };

    for (const name of QUEUE_NAMES) {
      // Readonly=true: nepridávame nové joby, len čítame stav
      const q = new Queue(name, {
        connection,
        // BullMQ prefix musí byť rovnaký ako v workeri (default: 'bull')
        prefix: '{bull}',
      });
      this.queues.push(q);
      this.logger.log(`[QueueMonitor] Prihlásený na frontu: ${name}`);
    }
  }

  async onModuleDestroy() {
    await Promise.all(this.queues.map((q) => q.close()));
  }

  // Získa snapshot stavu všetkých front
  async getSnapshot(): Promise<QueueMonitorSnapshot> {
    try {
      const stats = await Promise.all(
        this.queues.map(async (q): Promise<QueueStat> => {
          const [counts, paused] = await Promise.all([
            q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused'),
            q.isPaused(),
          ]);
          return {
            name: q.name,
            waiting:   counts['waiting']   ?? 0,
            active:    counts['active']    ?? 0,
            completed: counts['completed'] ?? 0,
            failed:    counts['failed']    ?? 0,
            delayed:   counts['delayed']   ?? 0,
            paused:    counts['paused']    ?? 0,
            isPaused:  paused,
          };
        }),
      );

      return {
        queues: stats,
        fetchedAt: new Date().toISOString(),
        redisConnected: true,
      };
    } catch (err: any) {
      this.logger.error(`[QueueMonitor] Chyba pri čítaní stavu front: ${err.message}`);
      return {
        queues: QUEUE_NAMES.map((name) => ({
          name,
          waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: 0,
          isPaused: false,
        })),
        fetchedAt: new Date().toISOString(),
        redisConnected: false,
      };
    }
  }

  // Získa posledné zlyhané joby pre konkrétnu frontu
  async getFailedJobs(queueName: string, limit = 20) {
    const queue = this.queues.find((q) => q.name === queueName);
    if (!queue) return [];

    const failed = await queue.getFailed(0, limit - 1);
    return failed.map((job) => ({
      id: job.id,
      name: job.name,
      data: job.data,
      failedReason: job.failedReason,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      attemptsMade: job.attemptsMade,
    }));
  }

  // Retry všetkých zlyhaných jobov pre frontu
  async retryFailed(queueName: string): Promise<number> {
    const queue = this.queues.find((q) => q.name === queueName);
    if (!queue) return 0;

    const failed = await queue.getFailed(0, 99);
    await Promise.all(failed.map((j) => j.retry()));
    this.logger.log(`[QueueMonitor] Retry ${failed.length} jobov v '${queueName}'`);
    return failed.length;
  }
}
