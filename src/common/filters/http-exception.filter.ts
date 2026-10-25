import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { AppError, type ErrorCode } from '../errors/app-error.js';
import { requestIdOf } from '../decorators/auth-context.js';
import { translatePgError } from '../errors/pg-errors.js';

interface Normalized {
  status: number;
  code: ErrorCode | string;
  message: string;
  details?: unknown;
}

/**
 * Barcha xatolar TZ 5.1 formatida: { error: { code, message, details?, requestId } }.
 * - AppError → o'z kodi va o'zbekcha xabari;
 * - Nest HttpException (validatsiya, 401/403/404/429, buzuq JSON) → o'zbekcha xabar;
 * - Postgres xatolari (unikal, FK, deadlock, overflow) → 409/422 va tushunarli xabar;
 * - boshqa hamma narsa → 500, mijozga umumiy xabar, logga to'liq stack.
 * Log: 5xx → error (stack bilan), 4xx → warn (kod, yo'l, foydalanuvchi, requestId).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { user?: { username?: string } }>();
    // body-parser xatosi logger middleware'dan oldin yuz beradi — id bo'lmasa shu yerda beramiz
    const requestId = requestIdOf(req) ?? (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    if (!res.getHeader('X-Request-Id')) res.setHeader('X-Request-Id', requestId);
    const n = this.normalize(exception);

    const where = `${req.method} ${req.originalUrl ?? req.url}`;
    const who = req.user?.username ? ` user=${req.user.username}` : '';
    if (n.status >= 500) {
      this.logger.error(`${n.status} ${n.code} ${where}${who} requestId=${requestId}: ${describe(exception)}`, exception instanceof Error ? exception.stack : undefined);
    } else {
      this.logger.warn(`${n.status} ${n.code} ${where}${who} requestId=${requestId}: ${n.message}`);
    }

    res.status(n.status).json({ error: { code: n.code, message: n.message, details: n.details, requestId } });
  }

  private normalize(e: unknown): Normalized {
    if (e instanceof AppError) return { status: e.getStatus(), code: e.code, message: e.message, details: e.details };

    if (e instanceof HttpException) {
      const status = e.getStatus();
      const body = e.getResponse();
      let message = typeof body === 'string' ? body : ((body as { message?: string | string[] }).message ?? e.message);
      let details: unknown;
      if (Array.isArray(message)) {
        // Validatsiya: createValidationPipe `errors` ({field, message}[]) beradi
        const errors = typeof body === 'object' && body && 'errors' in body ? (body as { errors: unknown }).errors : message;
        details = { errors };
        message = message[0];
      }
      const code = status === 400 ? 'validation_failed' : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : status === 429 ? 'rate_limited' : status === 413 ? 'validation_failed' : 'internal';
      return { status, code, message: translateHttp(status, message), details };
    }

    // body-parser: buzuq JSON yoki juda katta body
    const be = e as { type?: string; status?: number; expose?: boolean };
    if (be?.type === 'entity.parse.failed') return { status: 400, code: 'validation_failed', message: "So'rov tanasi noto'g'ri JSON formatida" };
    if (be?.type === 'entity.too.large') return { status: 413, code: 'validation_failed', message: "So'rov tanasi juda katta" };

    const pg = translatePgError(e);
    if (pg) return pg;

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: 'internal', message: 'Serverda xatolik yuz berdi. Qayta urinib ko\'ring; takrorlansa administratorga requestId ni ayting' };
  }
}

function describe(e: unknown): string {
  if (e instanceof Error) {
    const cause = (e as { cause?: unknown }).cause;
    return `${e.name}: ${e.message}${cause instanceof Error ? ` ← ${cause.name}: ${cause.message}` : ''}`;
  }
  return String(e);
}

/** Nest ning standart inglizcha xabarlari → o'zbekcha. */
function translateHttp(status: number, message: string): string {
  if (status === 401 && /^unauthorized$/i.test(message)) return 'Tizimga kiring';
  if (status === 403 && /^forbidden( resource)?$/i.test(message)) return "Bu amal uchun huquqingiz yo'q";
  if (status === 404 && /^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/.test(message)) return 'Manzil topilmadi';
  if (status === 429) return "Juda ko'p so'rov, birozdan keyin urinib ko'ring";
  if (message.startsWith('Validation failed (uuid is expected)')) return "Identifikator UUID formatida bo'lishi kerak";
  if (message.startsWith('Validation failed (numeric string is expected)')) return 'Son kutilgan edi';
  return message;
}
