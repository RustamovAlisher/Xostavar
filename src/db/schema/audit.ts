import { index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id } from './common.js';
import { branches } from './branches.js';
import { users } from './users.js';

/** Audit jurnali (TZ 7.8): faqat qo'shiladi. branch_id bo'sh = umumiy amal (sozlamalar, katalog). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    userName: text('user_name').notNull(),
    userRole: text('user_role').notNull().default(''),
    action: text('action').notNull(),
    module: text('module').notNull(),
    targetId: text('target_id'),
    targetName: text('target_name').notNull(),
    details: text('details').notNull().default(''),
    diff: jsonb('diff').$type<{ before?: Record<string, unknown>; after?: Record<string, unknown> }>(),
    ip: inet('ip'),
    requestId: text('request_id'),
  },
  (t) => [index('audit_logs_ts_idx').on(t.ts), index('audit_logs_module_ts_idx').on(t.module, t.ts), index('audit_logs_target_idx').on(t.targetId), index('audit_logs_branch_ts_idx').on(t.branchId, t.ts)],
);

/** Idempotentlik (TZ 5): bir xil kalit bilan takror so'rovga birinchi javob qaytariladi (24 soat). */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(),
    userId: uuid('user_id').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    statusCode: text('status_code').notNull(),
    response: jsonb('response').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idempotency_keys_created_idx').on(t.createdAt)],
);
