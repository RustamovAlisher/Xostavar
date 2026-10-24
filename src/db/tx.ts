import { Logger } from '@nestjs/common';
import type { Db, DbOrTx } from './db.module.js';
import { isRetryable } from '../common/pg-errors.js';

const logger = new Logger('Tx');
const RETRIES = 3;

/**
 * Tranzaksiya: deadlock (40P01) yoki serialization (40001) bo'lsa to'liq qayta uriniladi.
 * Tranzaksiya ichidagi hamma narsa orqaga qaytgani uchun qayta urinish xavfsiz; faqat tx ichida tashqi
 * ta'sir (email, fayl) bo'lmasligi kerak — bizda yo'q, audit ham tx ichida.
 */
export async function runTx<T>(db: Db, fn: (tx: DbOrTx) => Promise<T>, retries = RETRIES): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(fn);
    } catch (e) {
      if (attempt <= retries && isRetryable(e)) {
        logger.warn(`Tranzaksiya qayta uriniladi (${attempt}/${retries}): ${(e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code}`);
        await new Promise((r) => setTimeout(r, 20 * attempt + Math.random() * 30));
        continue;
      }
      throw e;
    }
  }
}
