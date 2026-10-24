import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from './errors.js';
import { requestIdOf } from './auth-context.js';

/**
 * Barcha xatolar TZ 5.1 formatida:
 * { error: { code, message, details?, requestId } }
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = requestIdOf(req);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal';
    let message = 'Serverda xatolik yuz berdi';
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      // class-validator xatolari: { message: string[] }
      if (typeof body === 'object' && body && 'message' in body) {
        const m = (body as { message: string | string[] }).message;
        message = Array.isArray(m) ? m[0] : m;
        if (Array.isArray(m)) details = { errors: m };
      } else if (typeof body === 'string') message = body;
      code =
        status === 400 ? 'validation_failed'
        : status === 401 ? 'unauthorized'
        : status === 403 ? 'forbidden'
        : status === 404 ? 'not_found'
        : status === 429 ? 'rate_limited'
        : 'internal';
      if (status === 401 && message === 'Unauthorized') message = 'Tizimga kiring';
      if (status === 403 && message === 'Forbidden resource') message = "Bu amal uchun huquqingiz yo'q";
      if (status === 404 && /^Cannot (GET|POST|PUT|PATCH|DELETE)/.test(message)) message = 'Manzil topilmadi';
      if (status === 429) message = "Juda ko'p so'rov, birozdan keyin urinib ko'ring";
    } else {
      // Kutilmagan xato — to'liq log, mijozga faqat umumiy xabar
      this.logger.error(`${req.method} ${req.url} requestId=${requestId}`, exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({ error: { code, message, details, requestId } });
  }
}
