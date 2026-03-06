import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { validateProductionSecrets } from './config/secrets-validator';

// Validácia kritických secrets pred spustením (crash-fast v produkcii)
validateProductionSecrets();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
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

  const port = process.env['APP_PORT'] || 3000;
  await app.listen(port);

  Logger.log(`AdTech API running on: http://localhost:${port}/api/v1`);
}

bootstrap();
