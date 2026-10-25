import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, isNull, like, lt, ne, or, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { customerGroups, customers, debtLedger } from '../../../entities/index.js';
import type { CustomerListQuery } from '../dto/customers.dto.js';

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

  /** Ro'yxat: 2 ta so'rov (mijozlar + guruh join, jami). Tartib: muddati o'tganlar, keyin qarz kamayishi bo'yicha. */
  list(q: CustomerListQuery, today: string, tx: DbOrTx = this.db): Promise<[CustomerWithGroup[], number]> {
    const where = and(
      isNull(customers.deletedAt),
      q.hasDebt === 'true' ? gt(customers.totalDebt, 0) : undefined,
      q.overdue === 'true' ? and(gt(customers.totalDebt, 0), lt(customers.dueDate, today)) : undefined,
      q.q?.trim() ? or(sql`lower(${customers.name}) like ${`%${q.q.trim().toLowerCase()}%`}`, like(customers.phone, `%${q.q.replace(/\D/g, '')}%`).if(q.q.replace(/\D/g, '').length >= 2)) : undefined,
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
  softDelete(tx: DbOrTx, id: string, phone: string) {
    return tx.update(customers).set({ deletedAt: new Date(), phone: `${phone}#del#${Date.now()}` }).where(eq(customers.id, id));
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
}
