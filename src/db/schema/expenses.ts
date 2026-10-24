import { date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money } from './common.js';
import { branches } from './branches.js';
import { users } from './users.js';
import { expenseCategories, paymentMethods, suppliers } from './settings.js';
import { shifts } from './sales.js';

/** Operatsion xarajatlar (TZ 7.11). Tovar tannarxi bu yerda emas. */
export const expenses = pgTable(
  'expenses',
  {
    id: id(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    date: date('date').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => expenseCategories.id, { onDelete: 'restrict' }),
    amount: money('amount').notNull(),
    methodId: uuid('method_id')
      .notNull()
      .references(() => paymentMethods.id, { onDelete: 'restrict' }),
    /** cash_register — kassadan olingan pul (smenaning kutilgan naqdini kamaytiradi). */
    source: text('source', { enum: ['cash_register', 'other'] }).notNull(),
    shiftId: uuid('shift_id').references(() => shifts.id, { onDelete: 'set null' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    note: text('note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdByName: text('created_by_name').notNull(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('expenses_branch_date_idx').on(t.branchId, t.date), index('expenses_shift_idx').on(t.shiftId)],
);
