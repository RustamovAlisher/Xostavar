import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './config/env.js';

/** main.ts va testlar uchun bir xil sozlash: prefix, CORS, validatsiya, shutdown hooks. */
export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService<Env, true>);
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true, exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false, transformOptions: { enableImplicitConversion: false } }));
  app.enableShutdownHooks();
  return app;
}
