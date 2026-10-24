import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { configureApp } from './app.setup.js';

// Ushlanmagan xatolar jarayonni jimgina o'ldirmasin: logga, keyin (uncaught bo'lsa) toza to'xtash
process.on('unhandledRejection', (reason) => {
  console.error(JSON.stringify({ level: 'error', msg: 'unhandledRejection', reason: reason instanceof Error ? { name: reason.name, message: reason.message, stack: reason.stack } : String(reason) }));
});
process.on('uncaughtException', (err) => {
  console.error(JSON.stringify({ level: 'fatal', msg: 'uncaughtException', name: err.name, message: err.message, stack: err.stack }));
  process.exit(1);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService<Env, true>);
  configureApp(app);

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
