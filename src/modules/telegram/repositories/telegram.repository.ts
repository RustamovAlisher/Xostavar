import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import {
  branches, notificationOutbox, paymentMethods, salePayments, saleLines, sales, stockLevels, telegramChats, telegramLinkCodes, expenses, products, units,
} from '../../../entities/index.js';

export type TelegramChatRow = typeof telegramChats.$inferSelect;
export type TelegramChatInsert = typeof telegramChats.$inferInsert;
export type OutboxRow = typeof notificationOutbox.$inferSelect;
export type OutboxKind = OutboxRow['kind'];

const TZ = sql.raw(`'Asia/Tashkent'`);
/** Toshkent kuni bo'yicha filtr (`YYYY-MM-DD`). */
const onDay = (col: unknown, day: string) => sql`(${col} at time zone ${TZ})::date = ${day}::date`;
const inBranches = (col: Parameters<typeof eq>[0], ids: string[] | null) => (ids ? inArray(col, ids) : undefined);

@Injectable()
export class TelegramRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /* ───────── Chatlar va ulash kodlari ───────── */

  chats(onlyActive = false) {
    return this.db.select().from(telegramChats).where(onlyActive ? eq(telegramChats.active, true) : undefined).orderBy(asc(telegramChats.createdAt), asc(telegramChats.title));
  }

  chatById(id: string) {
    return this.db.select().from(telegramChats).where(eq(telegramChats.id, id)).then((r) => r[0]);
  }

  chatByChatId(chatId: string) {
    return this.db.select().from(telegramChats).where(eq(telegramChats.chatId, chatId)).then((r) => r[0]);
  }

  /** Bir chat qayta ulansa — sozlamalar saqlanadi, faqat qayta faollashadi. */
  upsertChat(v: TelegramChatInsert) {
    return this.db
      .insert(telegramChats)
      .values(v)
      .onConflictDoUpdate({ target: telegramChats.chatId, set: { title: v.title, type: v.type, active: true, linkedBy: v.linkedBy, linkedByName: v.linkedByName, updatedAt: new Date() } })
      .returning()
      .then((r) => r[0]);
  }

  updateChat(id: string, patch: Partial<TelegramChatInsert>) {
    return this.db.update(telegramChats).set({ ...patch, updatedAt: new Date() }).where(eq(telegramChats.id, id)).returning().then((r) => r[0]);
  }

  deactivateByChatId(chatId: string) {
    return this.db.update(telegramChats).set({ active: false, updatedAt: new Date() }).where(eq(telegramChats.chatId, chatId));
  }

  deleteChat(id: string) {
    return this.db.delete(telegramChats).where(eq(telegramChats.id, id));
  }

  insertLinkCode(v: typeof telegramLinkCodes.$inferInsert) {
    return this.db.insert(telegramLinkCodes).values(v);
  }

  /** Kodni bir martalik ishlatadi (muddati o'tmagan bo'lsa). */
  consumeLinkCode(code: string) {
    return this.db
      .update(telegramLinkCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(telegramLinkCodes.code, code), isNull(telegramLinkCodes.usedAt), sql`${telegramLinkCodes.expiresAt} > now()`))
      .returning()
      .then((r) => r[0]);
  }

  /* ───────── Navbat (outbox) ───────── */

  enqueue(tx: DbOrTx, v: { kind: OutboxKind; refId?: string | null; branchId?: string | null; payload?: Record<string, unknown>; dedupeKey: string }) {
    return tx.insert(notificationOutbox).values(v).onConflictDoNothing({ target: notificationOutbox.dedupeKey });
  }

  pending(limit = 20) {
    return this.db
      .select()
      .from(notificationOutbox)
      // Baza soati bilan (next_attempt_at default now() — ilova va baza soatlari farq qilsa ham yangi yozuv darhol olinadi)
      .where(and(eq(notificationOutbox.status, 'pending'), lte(notificationOutbox.nextAttemptAt, sql`now()`)))
      .orderBy(asc(notificationOutbox.createdAt))
      .limit(limit);
  }

  outboxByKey(dedupeKey: string) {
    return this.db.select().from(notificationOutbox).where(eq(notificationOutbox.dedupeKey, dedupeKey)).then((r) => r[0]);
  }

  updateOutbox(id: string, patch: Partial<typeof notificationOutbox.$inferInsert>) {
    return this.db.update(notificationOutbox).set(patch).where(eq(notificationOutbox.id, id));
  }

  /** Eski yuborilganlarni tozalash (jadval o'smasin). */
  purgeOutbox(olderThanDays = 30) {
    return this.db.delete(notificationOutbox).where(sql`${notificationOutbox.status} <> 'pending' and ${notificationOutbox.createdAt} < now() - make_interval(days => ${olderThanDays})`);
  }

  /* ───────── Chek ma'lumotlari ───────── */

  sale(id: string) {
    return this.db
      .select({ s: sales, branchName: branches.name })
      .from(sales)
      .innerJoin(branches, eq(branches.id, sales.branchId))
      .where(eq(sales.id, id))
      .then((r) => r[0]);
  }

  saleLines(saleId: string) {
    return this.db.select().from(saleLines).where(eq(saleLines.saleId, saleId)).orderBy(asc(saleLines.sortOrder));
  }

  salePayments(saleIds: string[]) {
    if (!saleIds.length) return Promise.resolve([]);
    return this.db
      .select({ saleId: salePayments.saleId, methodCode: salePayments.methodCode, kind: salePayments.kind, amount: salePayments.amount, amountUsd: salePayments.amountUsd, label: paymentMethods.label })
      .from(salePayments)
      .leftJoin(paymentMethods, eq(paymentMethods.id, salePayments.methodId))
      .where(inArray(salePayments.saleId, saleIds));
  }

  methods() {
    return this.db.select({ code: paymentMethods.code, label: paymentMethods.label, kind: paymentMethods.kind }).from(paymentMethods);
  }

  units() {
    return this.db.select({ id: units.id, short: units.short, precision: units.precision }).from(units);
  }

  branches() {
    return this.db.select({ id: branches.id, name: branches.name, code: branches.code }).from(branches).orderBy(asc(branches.name));
  }

  /* ───────── Kunlik hisobot ───────── */

  /** Kun cheklari (sotuv + qarz to'lovi, bekor qilinganlar ham) — ro'yxat va Excel uchun. */
  daySales(day: string, branchIds: string[] | null) {
    return this.db
      .select({ s: sales, branchName: branches.name })
      .from(sales)
      .innerJoin(branches, eq(branches.id, sales.branchId))
      .where(and(onDay(sales.createdAt, day), inBranches(sales.branchId, branchIds)))
      .orderBy(asc(sales.createdAt));
  }

  /** Kun sotuv qatorlari (faqat bajarilgan sotuvlar). */
  dayLines(day: string, branchIds: string[] | null) {
    return this.db
      .select({ l: saleLines, number: sales.number, createdAt: sales.createdAt, branchName: branches.name, cashierName: sales.cashierName })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .innerJoin(branches, eq(branches.id, sales.branchId))
      .where(and(onDay(sales.createdAt, day), eq(sales.type, 'sale'), eq(sales.status, 'completed'), inBranches(sales.branchId, branchIds)))
      .orderBy(asc(sales.createdAt), asc(saleLines.sortOrder));
  }

  /** Shu kuni bekor qilingan cheklar (chek boshqa kunniki bo'lishi mumkin). */
  dayVoids(day: string, branchIds: string[] | null) {
    return this.db
      .select({ count: sql<number>`count(*)::int`, sum: sql<number>`coalesce(sum(${sales.totalAmount}), 0)::bigint` })
      .from(sales)
      .where(and(eq(sales.status, 'voided'), sql`${sales.voidedAt} is not null`, onDay(sales.voidedAt, day), inBranches(sales.branchId, branchIds)))
      .then((r) => ({ count: Number(r[0]?.count ?? 0), sum: Number(r[0]?.sum ?? 0) }));
  }

  dayExpenses(day: string, branchIds: string[] | null) {
    return this.db
      .select({ sum: sql<number>`coalesce(sum(${expenses.amount}), 0)::bigint`, count: sql<number>`count(*)::int` })
      .from(expenses)
      .where(and(eq(expenses.date, day), isNull(expenses.voidedAt), inBranches(expenses.branchId, branchIds)))
      .then((r) => ({ sum: Number(r[0]?.sum ?? 0), count: Number(r[0]?.count ?? 0) }));
  }

  lowStockCount(branchIds: string[] | null) {
    return this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(stockLevels)
      .innerJoin(products, and(eq(products.id, stockLevels.productId), isNull(products.deletedAt)))
      .where(and(inBranches(stockLevels.branchId, branchIds), sql`${stockLevels.minStock} > 0 and ${stockLevels.stock} < ${stockLevels.minStock}`))
      .then((r) => Number(r[0]?.n ?? 0));
  }
}
