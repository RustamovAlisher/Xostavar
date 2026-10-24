import type { INestApplication } from '@nestjs/common';
import { createValidationPipe } from './common/validation.js';
import { ConfigService } from '@nestjs/config';
import type { Env } from './config/env.js';

/** main.ts va testlar uchun bir xil sozlash: prefix, CORS, validatsiya, shutdown hooks. */
export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService<Env, true>);
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true, exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'] });
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();
  return app;
}
