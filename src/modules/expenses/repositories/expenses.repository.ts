import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { expenseCategories, expenses, paymentMethods } from '../../../entities/index.js';
import type { ExpenseListQuery } from '../dto/expenses.dto.js';

export type ExpenseRow = typeof expenses.$inferSelect;
export type ExpenseCategoryRow = typeof expenseCategories.$inferSelect;

/** Xarajatlar bo'yicha barcha SQL. Biznes qoidalari (smena, huquq, bekor qilish) servisda. */
@Injectable()
export class ExpensesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findCategory(id: string, tx: DbOrTx = this.db) {
    return tx.select().from(expenseCategories).where(eq(expenseCategories.id, id)).limit(1).then((r) => r[0] ?? null);
  }

  findPaymentMethod(tx: DbOrTx, id: string) {
    return tx.select().from(paymentMethods).where(eq(paymentMethods.id, id)).limit(1).then((r) => r[0] ?? null);
  }

  findById(id: string, tx: DbOrTx = this.db) {
    return tx.select().from(expenses).where(eq(expenses.id, id)).limit(1).then((r) => r[0] ?? null);
  }

  insert(tx: DbOrTx, v: typeof expenses.$inferInsert) {
    return tx.insert(expenses).values(v).returning({ id: expenses.id }).then((r) => r[0].id);
  }

  /** Faqat o'chirilmagan xarajatni tahrirlaydi; parallel o'chirilgan bo'lsa null. */
  updateIfActive(id: string, set: { date: string; categoryId: string; note: string | null }, tx: DbOrTx = this.db) {
    return tx.update(expenses).set(set).where(and(eq(expenses.id, id), isNull(expenses.voidedAt))).returning().then((r) => r[0] ?? null);
  }

  /** Faqat hali o'chirilmagan xarajatni o'chiradi; o'chirilgan bo'lsa null (poyga holati). */
  voidIfActive(tx: DbOrTx, id: string, voidedBy: string) {
    return tx.update(expenses).set({ voidedAt: new Date(), voidedBy }).where(and(eq(expenses.id, id), isNull(expenses.voidedAt))).returning().then((r) => r[0] ?? null);
  }

  /**
   * Ro'yxat (kategoriya va usul nomi bilan), jami son, kategoriya bo'yicha jamlar va umumiy summa — 4 ta so'rov.
   * `branchId=null` — barcha filiallar (egasi uchun). O'chirilganlar chiqmaydi.
   */
  list(branchId: string | null, q: ExpenseListQuery, tx: DbOrTx = this.db) {
    const where = and(
      branchId ? eq(expenses.branchId, branchId) : undefined,
      isNull(expenses.voidedAt),
      q.from ? gte(expenses.date, q.from) : undefined,
      q.to ? lte(expenses.date, q.to) : undefined,
      q.categoryId ? eq(expenses.categoryId, q.categoryId) : undefined,
      q.source ? eq(expenses.source, q.source) : undefined,
    );
    return Promise.all([
      tx.select({ e: expenses, category: expenseCategories.name, method: paymentMethods.label }).from(expenses).innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId)).innerJoin(paymentMethods, eq(paymentMethods.id, expenses.methodId)).where(where).orderBy(desc(expenses.date), desc(expenses.createdAt)).limit(q.pageSize).offset(q.offset),
      tx.select({ total: sql<number>`count(*)::int` }).from(expenses).where(where).then((r) => r[0].total),
      tx.select({ categoryId: expenses.categoryId, name: expenseCategories.name, sum: sql<number>`sum(${expenses.amount})::bigint` }).from(expenses).innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId)).where(where).groupBy(expenses.categoryId, expenseCategories.name).orderBy(desc(sql`sum(${expenses.amount})`)),
      tx.select({ sum: sql<number>`coalesce(sum(${expenses.amount}), 0)::bigint`, fromRegister: sql<number>`coalesce(sum(case when ${expenses.source} = 'cash_register' then ${expenses.amount} end), 0)::bigint` }).from(expenses).where(where).then((r) => r[0]),
    ]);
  }
}
