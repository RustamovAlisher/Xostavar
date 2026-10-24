import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq, lt } from 'drizzle-orm';
import type { Response } from 'express';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import { DB, type Db } from '../db/db.module.js';
import { idempotencyKeys } from '../db/schema/index.js';
import type { AuthRequest } from './auth-context.js';
import { badRequest } from './errors.js';

export const IDEMPOTENT_KEY = 'idempotent';
/** Pul/qoldiqni o'zgartiruvchi POST: `Idempotency-Key` majburiy (TZ 5). */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);

const KEEP_HOURS = 24;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Db,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const required = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required) return next.handle();

    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = (req.headers['idempotency-key'] as string | undefined)?.trim();
    if (!key || key.length > 128) throw badRequest("Idempotency-Key sarlavhasi kerak (uuid)");
    // Kalit foydalanuvchi va yo'lga bog'lanadi — boshqa foydalanuvchi bir xil kalit bilan boshqa natija olmasin
    const scoped = `${req.user!.id}:${req.method}:${req.path}:${key}`;

    return from(this.db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, scoped)).limit(1)).pipe(
      switchMap(([hit]) => {
        if (hit) {
          res.status(Number(hit.statusCode));
          res.setHeader('Idempotent-Replayed', 'true');
          return of(hit.response);
        }
        return next.handle().pipe(
          tap((body) => {
            // Javobni saqlaymiz; eski kalitlarni vaqti-vaqti bilan tozalaymiz
            void this.db
              .insert(idempotencyKeys)
              .values({ key: scoped, userId: req.user!.id, method: req.method, path: req.path, statusCode: String(res.statusCode || 200), response: body ?? null })
              .onConflictDoNothing()
              .then(() => {
                if (Math.random() < 0.01) {
                  const cutoff = new Date(Date.now() - KEEP_HOURS * 3600_000);
                  return this.db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, cutoff));
                }
              })
              .catch(() => undefined);
          }),
        );
      }),
    );
  }
}
