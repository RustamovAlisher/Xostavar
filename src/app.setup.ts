import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { resolve } from 'node:path';
import { UPLOADS_URL_PREFIX } from './common/utils/images.js';
import { createValidationPipe } from './common/pipes/validation.pipe.js';
import { ConfigService } from '@nestjs/config';
import type { Env } from './config/env.js';

/** main.ts va testlar uchun bir xil sozlash: prefix, CORS, validatsiya, shutdown hooks. */
export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService<Env, true>);
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true, exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'] });
  app.useGlobalPipes(createValidationPipe());
  // Yuklangan rasmlar (UPLOAD_DIR) — fayl nomida vaqt tamg'asi bor, shuning uchun uzoq kesh xavfsiz
  const express = app as Partial<NestExpressApplication>;
  if (typeof express.useStaticAssets === 'function') {
    express.useStaticAssets(resolve(config.get('UPLOAD_DIR', { infer: true })), { prefix: `${UPLOADS_URL_PREFIX}/`, index: false, dotfiles: 'deny', maxAge: '30d', immutable: true });
  }
  app.enableShutdownHooks();
  return app;
}
