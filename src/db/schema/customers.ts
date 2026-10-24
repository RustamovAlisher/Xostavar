import { bigserial, date, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, money, updatedAt, version } from './common.js';
import { customerGroups } from './settings.js';
import { branches } from './branches.js';
import { users } from './users.js';

/** Mijozlar — UMUMIY (istalgan filialdan xarid qiladi), qarz va limit umumiy (TZ 7.5). */
export const customers = pgTable(
  'customers',
  {
    id: id(),
    name: text('name').notNull(),
    /** Faqat raqamlar, 998XXXXXXXXX. */
    phone: text('phone').notNull(),
    groupId: uuid('group_id').references(() => customerGroups.id, { onDelete: 'set null' }),
    creditLimit: money('credit_limit').notNull().default(0),
    dueDate: date('due_date'),
    lastPaidDate: date('last_paid_date'),
    /** Hosila: har doim oxirgi debt_ledger.balance_after ga teng (tranzaksiya ichida yangilanadi). */
    totalDebt: money('total_debt').notNull().default(0),
    deletedAt: deletedAt(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('customers_phone_uq').on(t.phone), index('customers_name_idx').on(t.name)],
);

/** Mijoz qarzi harakati (TZ 7.5): + qarz oshishi, − kamayishi. */
export const debtLedger = pgTable(
  'debt_ledger',
  {
    id: id(),
    /** Haqiqiy ketma-ketlik: created_at tranzaksiya boshlanish vaqti, parallel yozuvlarda tartib bermaydi. */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    type: text('type', { enum: ['sale_debt', 'payment', 'adjustment', 'sale_void'] }).notNull(),
    amount: money('amount').notNull(),
    balanceAfter: money('balance_after').notNull(),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('debt_ledger_customer_seq_idx').on(t.customerId, t.seq), uniqueIndex('debt_ledger_seq_uq').on(t.seq)],
);
