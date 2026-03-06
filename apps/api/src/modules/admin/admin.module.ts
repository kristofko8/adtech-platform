import { Module } from '@nestjs/common';
import { QueueMonitorService } from './queue-monitor.service';
import { AdminController } from './admin.controller';

// ============================================================
// AdminModule
//
// Registruje:
//   - QueueMonitorService: čítanie stavu BullMQ front z Redis
//   - AdminController:     REST endpointy pre monitoring
//
// BullBoard UI je nastavené priamo v main.ts cez Express
// middleware (createBullBoard + ExpressAdapter), nie cez NestJS modul.
// Tým sa vyhýbame závislosti na @nestjs/bullmq v API projekte.
// ============================================================

@Module({
  controllers: [AdminController],
  providers: [QueueMonitorService],
  exports: [QueueMonitorService], // Exportujeme pre BullBoard setup v main.ts
})
export class AdminModule {}
