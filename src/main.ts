import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService<Env, true>);

  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.enableCors({ origin: config.get('CORS_ORIGINS', { infer: true }), credentials: true, exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false, transformOptions: { enableImplicitConversion: false } }));
  app.enableShutdownHooks();

  // OpenAPI: /api/docs (UI) va /api/docs-json (frontend tiplari generatsiyasi uchun)
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Temir Baza ERP/POS API')
      .setDescription("Ichki hisob tizimi: ombor, sotuv, nasiya, xarajatlar. Filialga tegishli endpointlar `X-Branch-Id` sarlavhasini oladi.")
      .setVersion('1.0')
      .addBearerAuth()
      .addGlobalParameters({ name: 'X-Branch-Id', in: 'header', required: false, schema: { type: 'string', format: 'uuid' } })
      .build(),
  );
  SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/docs-json' });

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  app.get(Logger).log(`API: http://localhost:${port}/api/v1 · Docs: http://localhost:${port}/api/docs`);
}
await bootstrap();
