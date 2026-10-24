import { HttpException, HttpStatus } from '@nestjs/common';

/** TZ 5.2 — mashina uchun xato kodlari. `message` foydalanuvchiga o'zbekcha. */
export type ErrorCode =
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'version_conflict'
  | 'duplicate_code'
  | 'insufficient_stock'
  | 'shift_required'
  | 'shift_owned_by_other'
  | 'credit_limit_exceeded'
  | 'debtor_required'
  | 'payment_method_disabled'
  | 'price_missing'
  | 'unit_not_allowed'
  | 'in_use'
  | 'last_admin'
  | 'self_action_forbidden'
  | 'branch_forbidden'
  | 'branch_inactive'
  | 'not_in_branch'
  | 'discount_too_large'
  | 'already_voided'
  | 'rate_limited'
  | 'internal';

export class AppError extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    public readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, status);
  }
}

/* Qisqa yordamchilar — servislarda o'qilishi oson bo'lsin */
export const notFound = (what = 'Yozuv', details?: Record<string, unknown>) =>
  new AppError('not_found', `${what} topilmadi`, HttpStatus.NOT_FOUND, details);
export const forbidden = (message = "Bu amal uchun huquqingiz yo'q", code: ErrorCode = 'forbidden') =>
  new AppError(code, message, HttpStatus.FORBIDDEN);
export const unauthorized = (message = 'Tizimga kiring') => new AppError('unauthorized', message, HttpStatus.UNAUTHORIZED);
export const conflict = (code: ErrorCode, message: string, details?: Record<string, unknown>) =>
  new AppError(code, message, HttpStatus.CONFLICT, details);
export const unprocessable = (code: ErrorCode, message: string, details?: Record<string, unknown>) =>
  new AppError(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError('validation_failed', message, HttpStatus.BAD_REQUEST, details);
