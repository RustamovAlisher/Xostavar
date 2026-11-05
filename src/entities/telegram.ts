import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money, updatedAt } from './common.js';
import { users } from './users.js';

/**
 * Savdo xabarlari keladigan Telegram chatlar (shaxsiy yoki guruh). Admin Sozlamalarda bir martalik kod oladi,
 * chatdan botga `/start <kod>` yuboradi — shundan keyin bot faqat shu chatlarga yozadi va ularning buyruqlariga javob beradi.
 */
export const telegramChats = pgTable(
  'telegram_chats',
  {
    id: id(),
    /** Telegram chat id (guruhda manfiy, 64-bit) — matn ko'rinishida. */
    chatId: text('chat_id').notNull(),
    type: text('type', { enum: ['private', 'group', 'supergroup', 'channel'] }).notNull(),
    title: text('title').notNull(),
    /** Qaysi filiallar xabari keladi; null — hammasi. */
    branchIds: uuid('branch_ids').array(),
    notifySales: boolean('notify_sales').notNull().default(true),
    /** Har sotuv xabari faqat shu summadan katta cheklar uchun (0 — hammasi). */
    minAmount: money('min_amount').notNull().default(0),
    notifyVoids: boolean('notify_voids').notNull().default(true),
    /** Nasiyaga sotuv va qarz to'lovlari. */
    notifyDebts: boolean('notify_debts').notNull().default(true),
    dailyReport: boolean('daily_report').notNull().default(true),
    /** Foyda / tannarx ko'rsatilsinmi (kun yakunida). */
    showProfit: boolean('show_profit').notNull().default(true),
    active: boolean('active').notNull().default(true),
    linkedBy: uuid('linked_by').references(() => users.id, { onDelete: 'set null' }),
    linkedByName: text('linked_by_name'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('telegram_chats_chat_id_uq').on(t.chatId)],
);

/** Bir martalik ulash kodi (15 daqiqa). */
export const telegramLinkCodes = pgTable('telegram_link_codes', {
  code: text('code').primaryKey(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'cascade' }),
  createdByName: text('created_by_name').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * Xabarlar navbati (outbox): sotuv tranzaksiyasi ichida yoziladi, alohida ishchi Telegram'ga yuboradi.
 * Telegram ishlamasa ham kassa to'xtamaydi; server qayta yonsa davom etadi; `dedupe_key` takrorni to'xtatadi.
 */
export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: id(),
    kind: text('kind', { enum: ['sale', 'void', 'debt_payment', 'daily', 'test'] }).notNull(),
    refId: uuid('ref_id'),
    branchId: uuid('branch_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    dedupeKey: text('dedupe_key').notNull(),
    status: text('status', { enum: ['pending', 'sent', 'failed'] }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    /** Qaysi chatlarga allaqachon yuborilgan (qisman xatoda qayta urinishda takrorlanmasin). */
    sentChatIds: text('sent_chat_ids').array().notNull().default(sql`'{}'::text[]`),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('notification_outbox_dedupe_uq').on(t.dedupeKey), index('notification_outbox_pending_idx').on(t.status, t.nextAttemptAt)],
);
