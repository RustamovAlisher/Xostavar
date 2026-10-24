import { sql, type SQL } from 'drizzle-orm';
import { boolean, pgTable, text, uniqueIndex, type PgColumn } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt, version } from './common.js';

/** Katta-kichik harfga sezgir bo'lmagan unikal indeks uchun. */
export function sqlLower(col: PgColumn): SQL {
  return sql`lower(${col})`;
}

/** Filiallar (TZ 7.0). O'chirilmaydi, faqat nofaol qilinadi. Kod chek raqamida: MAIN-20261024-0001. */
export const branches = pgTable(
  'branches',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    phone: text('phone'),
    receiptFooter: text('receipt_footer'),
    timezone: text('timezone').notNull().default('Asia/Tashkent'),
    active: boolean('active').notNull().default(true),
    isMain: boolean('is_main').notNull().default(false),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('branches_code_uq').on(t.code), uniqueIndex('branches_name_lower_uq').on(sqlLower(t.name))],
);
