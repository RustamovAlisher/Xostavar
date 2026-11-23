import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, like, lt, ne, or, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { customerGroups, customers, debtLedger, saleLines, salePayments, sales } from '../../../entities/index.js';
import type { CustomerListQuery } from '../dto/customers.dto.js';
import { textQuery } from '../../../common/search-sql.js';

export type CustomerRow = typeof customers.$inferSelect;
export type CustomerInsert = typeof customers.$inferInsert;
export type DebtLedgerRow = typeof debtLedger.$inferSelect;
export type DebtLedgerInsert = typeof debtLedger.$inferInsert;
/** Mijoz + guruh nomi (leftJoin). */
export type CustomerWithGroup = { c: CustomerRow; g: string | null };

/**
 * Mijozlar va qarz jurnali bo'yicha barcha SQL. Biznes qoidalari, xatolar va audit — servisda.
 * Har metod `tx` qabul qiladi: tranzaksiya ichida chaqirilsa shu `tx`, bo'lmasa umumiy `db`.
 */
@Injectable()
export class CustomersRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Ism so'zlari alohida (tartib, kirill/lotin, imlo variantlari ahamiyatsiz) yoki telefon raqami (kamida 2 raqam). */
  private textFilter(raw?: string) {
    const term = raw?.trim();
    if (!term) return undefined;
    const digits = term.replace(/\D/g, '');
    const byName = textQuery(term, (res) => and(...res.map((re) => sql`${customers.name} ~* ${re}`))) ?? sql`lower(${customers.name}) like ${`%${term.toLowerCase()}%`}`;
    return digits.length >= 2 ? or(byName, like(customers.phone, `%${digits}%`)) : byName;
  }

  /** Ro'yxat: 2 ta so'rov (mijozlar + guruh join, jami). Tartib: muddati o'tganlar, keyin qarz kamayishi bo'yicha. */
  list(q: CustomerListQuery, today: string, tx: DbOrTx = this.db): Promise<[CustomerWithGroup[], number]> {
    const where = and(
      isNull(customers.deletedAt),
      q.hasDebt === 'true' ? gt(customers.totalDebt, 0) : undefined,
      q.overdue === 'true' ? and(gt(customers.totalDebt, 0), lt(customers.dueDate, today)) : undefined,
      this.textFilter(q.q),
    );
    const overdueExpr = sql`(${customers.totalDebt} > 0 and ${customers.dueDate} < ${today}::date)`;
    return Promise.all([
      tx.select({ c: customers, g: customerGroups.name }).from(customers).leftJoin(customerGroups, eq(customerGroups.id, customers.groupId)).where(where).orderBy(desc(overdueExpr), desc(customers.totalDebt), asc(customers.name)).limit(q.pageSize).offset(q.offset),
      tx.select({ total: sql<number>`count(*)::int` }).from(customers).where(where).then((r) => r[0].total),
    ]);
  }

  findWithGroup(id: string, tx: DbOrTx = this.db): Promise<CustomerWithGroup | null> {
    return tx.select({ c: customers, g: customerGroups.name }).from(customers).leftJoin(customerGroups, eq(customerGroups.id, customers.groupId)).where(and(eq(customers.id, id), isNull(customers.deletedAt))).limit(1).then((r) => r[0] ?? null);
  }

  /** Shu telefon raqamli (o'chirilmagan) boshqa mijoz — nomi yoki null. */
  findByPhone(phone: string, exceptId?: string, tx: DbOrTx = this.db) {
    return tx.select({ name: customers.name }).from(customers).where(and(eq(customers.phone, phone), isNull(customers.deletedAt), exceptId ? ne(customers.id, exceptId) : undefined)).limit(1).then((r) => r[0] ?? null);
  }

  /** Tartibda birinchi guruh (yangi mijoz uchun standart). */
  firstGroupId(tx: DbOrTx = this.db): Promise<string | null> {
    return tx.select({ id: customerGroups.id }).from(customerGroups).orderBy(asc(customerGroups.sortOrder)).limit(1).then((r) => r[0]?.id ?? null);
  }

  /** Qatorni `FOR UPDATE` bilan qulflab oladi (o'chirilmagan); yo'q bo'lsa null. */
  lockById(tx: DbOrTx, id: string): Promise<CustomerRow | null> {
    return tx.select().from(customers).where(and(eq(customers.id, id), isNull(customers.deletedAt))).limit(1).for('update').then((r) => r[0] ?? null);
  }

  insert(tx: DbOrTx, v: Pick<CustomerInsert, 'name' | 'phone' | 'groupId' | 'creditLimit' | 'dueDate'>) {
    return tx.insert(customers).values(v).returning({ id: customers.id, name: customers.name, creditLimit: customers.creditLimit }).then((r) => r[0]);
  }

  update(tx: DbOrTx, id: string, set: Pick<CustomerInsert, 'name' | 'phone' | 'groupId' | 'creditLimit' | 'dueDate' | 'version'>) {
    return tx.update(customers).set(set).where(eq(customers.id, id));
  }

  /** Yumshoq o'chirish: telefon band bo'lib qolmasligi uchun unikal qiymat bilan belgilanadi. */
  softDelete(tx: DbOrTx, id: string, phone: string | null) {
    return tx.update(customers).set({ deletedAt: new Date(), phone: phone ? `${phone}#del#${Date.now()}` : null }).where(eq(customers.id, id));
  }

  /**
   * Balans atomar yangilanadi (o'qib-yozish emas): `total_debt = total_debt + amount` faqat natija >= 0 bo'lsa.
   * Qaytaradi: yangi qarz; shart bajarilmasa null.
   */
  addDebt(tx: DbOrTx, id: string, amount: number, set: Partial<Pick<CustomerInsert, 'dueDate' | 'lastPaidDate'>>): Promise<number | null> {
    return tx
      .update(customers)
      .set({ ...set, totalDebt: sql`${customers.totalDebt} + ${amount}` })
      .where(and(eq(customers.id, id), sql`${customers.totalDebt} + ${amount} >= 0`))
      .returning({ totalDebt: customers.totalDebt })
      .then((r) => r[0]?.totalDebt ?? null);
  }

  insertLedger(tx: DbOrTx, v: DebtLedgerInsert) {
    return tx.insert(debtLedger).values(v);
  }

  /** Qarz jurnali: ro'yxat (seq kamayishi) + jami. */
  ledger(customerId: string, q: { pageSize: number; offset: number }, tx: DbOrTx = this.db): Promise<[DebtLedgerRow[], number]> {
    return Promise.all([
      tx.select().from(debtLedger).where(eq(debtLedger.customerId, customerId)).orderBy(desc(debtLedger.seq)).limit(q.pageSize).offset(q.offset),
      tx.select({ total: sql<number>`count(*)::int` }).from(debtLedger).where(eq(debtLedger.customerId, customerId)).then((r) => r[0].total),
    ]);
  }

  /* ───────── Mijoz profili ───────── */

  /** Butun qarz jurnali (seq o'sishi) — savdolar bo'yicha taqsimlash uchun. */
  ledgerAll(customerId: string, tx: DbOrTx = this.db) {
    return tx.select({ id: debtLedger.id, seq: debtLedger.seq, type: debtLedger.type, amount: debtLedger.amount, refId: debtLedger.refId, createdAt: debtLedger.createdAt, note: debtLedger.note })
      .from(debtLedger).where(eq(debtLedger.customerId, customerId)).orderBy(asc(debtLedger.seq));
  }

  /** Muddatni aniq sanaga qo'yadi (qo'lda qarz kiritishda). */
  setDueDate(tx: DbOrTx, id: string, dueDate: string) {
    return tx.update(customers).set({ dueDate }).where(eq(customers.id, id));
  }

  /** Mijozning qarz to'lovi cheklari (eng yangisi birinchi). */
  debtPayments(customerId: string, tx: DbOrTx = this.db) {
    return tx.select({
      id: sales.id, number: sales.number, createdAt: sales.createdAt, branchId: sales.branchId, cashierName: sales.cashierName,
      amount: sales.paidAmount, paymentSummary: sales.paymentSummary, status: sales.status, debtSaleId: sales.debtSaleId, debtAfter: sales.customerDebtAfter,
    }).from(sales).where(and(eq(sales.customerId, customerId), eq(sales.type, 'debt_payment'))).orderBy(desc(sales.createdAt));
  }

  /** Mijozning savdolari (eng yangisi birinchi, eng ko'pi `limit`). */
  customerSales(customerId: string, limit: number, tx: DbOrTx = this.db) {
    return tx.select().from(sales).where(and(eq(sales.customerId, customerId), eq(sales.type, 'sale'))).orderBy(desc(sales.createdAt)).limit(limit);
  }

  saleStats(customerId: string, tx: DbOrTx = this.db) {
    return tx.select({
      count: sql<number>`count(*) filter (where ${sales.status} = 'completed')::int`,
      voided: sql<number>`count(*) filter (where ${sales.status} = 'voided')::int`,
      spent: sql<number>`coalesce(sum(${sales.totalAmount}) filter (where ${sales.status} = 'completed'), 0)::bigint`,
      first: sql<string | null>`min(${sales.createdAt})`,
      last: sql<string | null>`max(${sales.createdAt})`,
    }).from(sales).where(and(eq(sales.customerId, customerId), eq(sales.type, 'sale'))).then((r) => r[0]);
  }

  saleLinesFor(saleIds: string[], tx: DbOrTx = this.db) {
    if (!saleIds.length) return Promise.resolve([]);
    return tx.select({
      saleId: saleLines.saleId, id: saleLines.id, name: saleLines.name, variantName: saleLines.variantName, sku: saleLines.sku, unit: saleLines.unit,
      qty: saleLines.qty, unitPrice: saleLines.unitPrice, lineTotal: saleLines.lineTotal,
      // Kesib berilgan qator — profilda tahrirlash o'chiq (faqat olib tashlash)
      hasCuts: sql<boolean>`coalesce(jsonb_array_length(${saleLines.cuts}), 0) > 0`,
    }).from(saleLines).where(inArray(saleLines.saleId, saleIds)).orderBy(asc(saleLines.sortOrder));
  }

  salePaymentsFor(saleIds: string[], tx: DbOrTx = this.db) {
    if (!saleIds.length) return Promise.resolve([]);
    return tx.select({ saleId: salePayments.saleId, methodId: salePayments.methodId, methodCode: salePayments.methodCode, kind: salePayments.kind, amount: salePayments.amount, amountUsd: salePayments.amountUsd })
      .from(salePayments).where(inArray(salePayments.saleId, saleIds));
  }

  /** Savdo (qarz to'lovini bog'lash uchun tekshiruv). */
  findSaleHead(saleId: string, tx: DbOrTx = this.db) {
    return tx.select({ id: sales.id, customerId: sales.customerId, type: sales.type, status: sales.status, number: sales.number, remainingDebt: sales.remainingDebt })
      .from(sales).where(eq(sales.id, saleId)).limit(1).then((r) => r[0] ?? null);
  }
}
