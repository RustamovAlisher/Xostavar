import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../../config/env.js';
import { ShiftsModule } from '../shifts/shifts.module.js';
import { AuthController } from './controllers/auth.controller.js';
import { AuthGuard } from './guards/auth.guard.js';
import { AuthService } from './services/auth.service.js';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService<Env, true>) => ({
        secret: c.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { expiresIn: c.get('JWT_ACCESS_TTL', { infer: true }) as `${number}${'s' | 'm' | 'h' | 'd'}` },
      }),
    }),
    ShiftsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
