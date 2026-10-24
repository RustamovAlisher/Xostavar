import { sql } from 'drizzle-orm';
import { bigint, integer, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Barcha jadvallar uchun umumiy ustunlar (TZ 7): uuid id, created_at, updated_at. */
export const id = () => uuid('id').primaryKey().defaultRandom();
export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
export const deletedAt = () => timestamp('deleted_at', { withTimezone: true });
/** Optimistik bloklash (TZ 5): PUT/PATCH da `If-Match` / body.version bilan solishtiriladi. */
export const version = () => integer('version').notNull().default(1);

/** Pul: butun so'm, hech qachon float (TZ 5). */
export const money = (name: string) => bigint(name, { mode: 'number' });
/** Miqdor: asosiy birlikda 4 xona (TZ 5), JS da number. */
export const qty = (name: string) => numeric(name, { precision: 18, scale: 4, mode: 'number' });
/** Koeffitsient: 1 birlik = factor × asosiy birlik, 6 xona (TZ 7.3). */
export const factor = (name: string) => numeric(name, { precision: 18, scale: 6, mode: 'number' });

export const nowSql = sql`now()`;
