import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app/app.module';
import { validateProductionSecrets } from './config/secrets-validator';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { QueueMonitorService } from './modules/admin/queue-monitor.service';

// Validácia kritických secrets pred spustením (crash-fast v produkcii)
validateProductionSecrets();

// BullBoard route — chránené HTTP Basic Auth (USER:PASS cez env)
const BULL_BOARD_PATH = '/admin/bull';

function createBasicAuthMiddleware() {
  const user = process.env['BULL_BOARD_USER'] || 'admin';
  const pass = process.env['BULL_BOARD_PASS'] || 'adtech-admin';
  return (req: any, res: any, next: any) => {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="BullBoard"');
      return res.status(401).send('Unauthorized');
    }
    const [u, p] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
    if (u !== user || p !== pass) {
      return res.status(403).send('Forbidden');
    }
    next();
  };
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // Globálny prefix pre všetky API endpointy
  app.setGlobalPrefix('api/v1');

  // Globálna validácia vstupov
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // Odstraní polia, ktoré nie sú v DTO
      forbidNonWhitelisted: true, // Vráti chybu pri neznámych poliach
      transform: true,            // Automatická konverzia typov
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // CORS konfigurácia
  app.enableCors({
    origin: process.env['FRONTEND_URL'] || 'http://localhost:4200',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // ── BullBoard UI ───────────────────────────────────────────────────────────
  // Pripojíme sa na BullMQ fronty cez QueueMonitorService (zdieľa Redis spojenie)
  const queueMonitor = app.get(QueueMonitorService);
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);

  createBullBoard({
    queues: queueMonitor.queues.map((q) => new BullMQAdapter(q)),
    serverAdapter,
    options: {
      uiConfig: {
        boardTitle: 'AdTech Queue Monitor',
      },
    },
  });

  // HTTP Basic Auth ochrana + mount BullBoard
  app.use(BULL_BOARD_PATH, createBasicAuthMiddleware(), serverAdapter.getRouter());
  // ──────────────────────────────────────────────────────────────────────────

  const port = process.env['APP_PORT'] || 3000;
  await app.listen(port);

  Logger.log(`AdTech API running on: http://localhost:${port}/api/v1`);
  Logger.log(`BullBoard UI:          http://localhost:${port}${BULL_BOARD_PATH}`);
}

bootstrap();
