import { date, index, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './common.js';
import { users } from './users.js';

/** Valyuta kursi: 1 birlik valyuta = `rate` so'm. 2 xona (Markaziy bank formati). */
export const rate = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });

/**
 * Valyuta kurslari tarixi (hozircha faqat USD). Eng oxirgi qator — joriy kurs.
 * Markaziy bank (cbu.uz) dan kuniga 2 marta (07:00, 12:00 Toshkent) avtomatik yoki admin qo'lda kiritadi.
 */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: id(),
    currency: text('currency').notNull().default('USD'),
    rate: rate('rate').notNull(),
    /** Markaziy bank e'lon qilgan sana (qo'lda kiritilganda — kiritilgan kun). */
    rateDate: date('rate_date', { mode: 'string' }).notNull(),
    source: text('source', { enum: ['cbu', 'manual'] }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdByName: text('created_by_name'),
    createdAt: createdAt(),
  },
  (t) => [index('exchange_rates_currency_created_idx').on(t.currency, t.createdAt)],
);
