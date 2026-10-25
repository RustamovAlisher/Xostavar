import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { businessRules, expenses, paymentMethods, salePayments, sales, shifts } from '../../../entities/index.js';
import type { PageQuery } from '../../../common/utils/pagination.js';

export type ShiftRow = typeof shifts.$inferSelect;

/**
 * Smenalar bo'yicha barcha SQL. Faqat ma'lumot oladi/yozadi — biznes qoidalari va xatolar servisda.
 * Har metod `tx` qabul qiladi: tranzaksiya ichida chaqirilsa shu `tx`, bo'lmasa umumiy `db`.
 */
@Injectable()
export class ShiftsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findOpen(branchId: string, tx: DbOrTx = this.db) {
    return tx.select().from(shifts).where(and(eq(shifts.branchId, branchId), isNull(shifts.closedAt))).limit(1).then((r) => r[0] ?? null);
  }

  findById(id: string, tx: DbOrTx = this.db) {
    return tx.select().from(shifts).where(eq(shifts.id, id)).limit(1).then((r) => r[0] ?? null);
  }

  async requireShiftRule(tx: DbOrTx = this.db): Promise<boolean> {
    const [rules] = await tx.select({ requireShift: businessRules.requireShift }).from(businessRules).limit(1);
    return !!rules?.requireShift;
  }

  insertOpen(tx: DbOrTx, v: { branchId: string; openedBy: string; openedByName: string; openingCash: number }) {
    return tx.insert(shifts).values(v).returning().then((r) => r[0]);
  }

  /** Faqat hali yopilmagan smenani yopadi; yopilgan bo'lsa null (poyga holati). */
  closeIfOpen(tx: DbOrTx, id: string, v: { closedBy: string; closedByName: string; totals: Record<string, unknown>; expectedCash: number; closingCashCounted: number | null }) {
    return tx.update(shifts).set({ closedAt: new Date(), ...v }).where(and(eq(shifts.id, id), isNull(shifts.closedAt))).returning().then((r) => r[0] ?? null);
  }

  updateFrozenTotals(tx: DbOrTx, id: string, totals: Record<string, unknown>, expectedCash: number) {
    return tx.update(shifts).set({ totals, expectedCash }).where(eq(shifts.id, id));
  }

  /** Jamlar uchun xom qatorlar — 3 ta GROUP BY so'rov, chek soniga bog'liq emas (TZ 7.7). */
  totalsRows(shiftId: string, tx: DbOrTx = this.db) {
    return Promise.all([
      tx
        .select({ code: salePayments.methodCode, kind: salePayments.kind, sum: sql<number>`coalesce(sum(${salePayments.amount}), 0)::bigint` })
        .from(salePayments)
        .innerJoin(sales, eq(sales.id, salePayments.saleId))
        .where(and(eq(sales.shiftId, shiftId), eq(sales.status, 'completed')))
        .groupBy(salePayments.methodCode, salePayments.kind),
      tx
        .select({
          type: sales.type,
          status: sales.status,
          n: sql<number>`count(*)::int`,
          paid: sql<number>`coalesce(sum(${sales.paidAmount}), 0)::bigint`,
          debt: sql<number>`coalesce(sum(${sales.remainingDebt}), 0)::bigint`,
        })
        .from(sales)
        .where(eq(sales.shiftId, shiftId))
        .groupBy(sales.type, sales.status),
      tx
        .select({ cashOut: sql<number>`coalesce(sum(${expenses.amount}), 0)::bigint` })
        .from(expenses)
        .where(and(eq(expenses.shiftId, shiftId), eq(expenses.source, 'cash_register'), isNull(expenses.voidedAt)))
        .then((r) => r[0]?.cashOut ?? 0),
    ]);
  }

  paymentMethodLabels(tx: DbOrTx = this.db) {
    return tx.select({ code: paymentMethods.code, label: paymentMethods.label }).from(paymentMethods);
  }

  /** Ro'yxat + jami (2 ta so'rov). */
  list(branchId: string, q: PageQuery & { from?: string; to?: string }, tx: DbOrTx = this.db) {
    const where = and(eq(shifts.branchId, branchId), q.from ? gte(shifts.openedAt, new Date(q.from)) : undefined, q.to ? lte(shifts.openedAt, new Date(q.to + 'T23:59:59.999Z')) : undefined);
    return Promise.all([
      tx.select().from(shifts).where(where).orderBy(desc(shifts.openedAt)).limit(q.pageSize).offset(q.offset),
      tx.select({ total: sql<number>`count(*)::int` }).from(shifts).where(where).then((r) => r[0].total),
    ]);
  }
}
