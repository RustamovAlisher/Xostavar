import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BranchesModule } from './modules/branches/branches.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { SalesModule } from './modules/sales/sales.module.js';
import { ExpensesModule } from './modules/expenses/expenses.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { ShiftsModule } from './modules/shifts/shifts.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        // Har so'rovga id: mijoz X-Request-Id yuborsa o'sha, bo'lmasa uuid; javob sarlavhasida qaytariladi
        genReqId: (req, res) => {
          const id = (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) || randomUUID();
          res.setHeader('X-Request-Id', id);
          return id;
        },
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } },
        // Parol va tokenlar loglarga tushmaydi (TZ 6.3)
        redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.currentPassword', 'req.body.newPassword', 'req.body.refreshToken'],
        customProps: (req) => ({ requestId: (req as { id?: string }).id }),
        autoLogging: { ignore: (req) => req.url === '/health' },
      },
    }),
    // Umumiy rate limit (TZ 6.3): 300 so'rov / daqiqa
    // Test muhitida o'chiriladi (hamma so'rov bitta IP dan keladi)
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }], skipIf: () => process.env.NODE_ENV === 'test' }),
    DbModule,
    AuditModule,
    SettingsModule,
    AuthModule,
    BranchesModule,
    UsersModule,
    ShiftsModule,
    CatalogModule,
    InventoryModule,
    CustomersModule,
    SalesModule,
    ExpensesModule,
    ReportsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
