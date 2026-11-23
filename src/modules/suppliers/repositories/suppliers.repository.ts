import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, like, or, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { branches, paymentMethods, stockReceiptLines, stockReceipts, supplierLedger, suppliers } from '../../../entities/index.js';
import { textQuery } from '../../../common/search-sql.js';
import type { SupplierListQuery } from '../dto/suppliers.dto.js';

export type SupplierRow = typeof suppliers.$inferSelect;
export type SupplierLedgerRow = typeof supplierLedger.$inferSelect;
export type SupplierLedgerInsert = typeof supplierLedger.$inferInsert;
export type ReceiptRow = typeof stockReceipts.$inferSelect;
export type ReceiptLineRow = typeof stockReceiptLines.$inferSelect;

/** Yetkazib beruvchilar va ularning qarz jurnali bo'yicha barcha SQL. Biznes qoidalari, xatolar va audit — servisda. */
@Injectable()
export class SuppliersRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private textFilter(raw?: string) {
    const term = raw?.trim();
    if (!term) return undefined;
    const digits = term.replace(/\D/g, '');
    const byName = textQuery(term, (res) => and(...res.map((re) => sql`${suppliers.name} ~* ${re}`))) ?? sql`lower(${suppliers.name}) like ${`%${term.toLowerCase()}%`}`;
    return digits.length >= 2 ? or(byName, like(suppliers.phone, `%${digits}%`)) : byName;
  }

  /** Ro'yxat: har yetkazib beruvchi uchun kirimlar soni, oxirgi kirim va oxirgi to'lov sanasi (bitta so'rov). Tartib: qarz kamayishi, keyin nom. */
  list(q: SupplierListQuery, tx: DbOrTx = this.db) {
    return tx
      .select({
        s: suppliers,
        purchasesCount: sql<number>`(select count(*)::int from ${stockReceipts} where ${stockReceipts.supplierId} = "suppliers"."id")`,
        lastPurchaseDate: sql<string | null>`(select max(${stockReceipts.date})::text from ${stockReceipts} where ${stockReceipts.supplierId} = "suppliers"."id")`,
        lastPaymentDate: sql<string | null>`(select max(${supplierLedger.date})::text from ${supplierLedger} where ${supplierLedger.supplierId} = "suppliers"."id" and ${supplierLedger.type} = 'payment')`,
      })
      .from(suppliers)
      .where(and(q.debtOnly === 'true' ? gt(suppliers.totalDebt, 0) : undefined, this.textFilter(q.q)))
      .orderBy(desc(suppliers.totalDebt), asc(suppliers.name))
      .limit(1000);
  }

  find(id: string, tx: DbOrTx = this.db) {
    return tx.select().from(suppliers).where(eq(suppliers.id, id)).limit(1).then((r) => r[0] ?? null);
  }

  lock(tx: DbOrTx, id: string) {
    return tx.select().from(suppliers).where(eq(suppliers.id, id)).for('update').then((r) => r[0] ?? null);
  }

  findByName(tx: DbOrTx, name: string) {
    return tx.select().from(suppliers).where(sql`lower(${suppliers.name}) = lower(${name})`).limit(1).then((r) => r[0] ?? null);
  }

  insert(tx: DbOrTx, v: typeof suppliers.$inferInsert) {
    return tx.insert(suppliers).values(v).returning().then((r) => r[0]);
  }

  update(tx: DbOrTx, id: string, v: Partial<typeof suppliers.$inferInsert>) {
    return tx.update(suppliers).set(v).where(eq(suppliers.id, id));
  }

  /** Qarz atomar o'zgaradi (o'qib-yozish emas); yangi qoldiqni qaytaradi. */
  addDebt(tx: DbOrTx, id: string, amount: number): Promise<number | null> {
    return tx
      .update(suppliers)
      .set({ totalDebt: sql`${suppliers.totalDebt} + ${amount}` })
      .where(eq(suppliers.id, id))
      .returning({ totalDebt: suppliers.totalDebt })
      .then((r) => r[0]?.totalDebt ?? null);
  }

  insertLedger(tx: DbOrTx, v: SupplierLedgerInsert) {
    return tx.insert(supplierLedger).values(v);
  }

  /** Jurnal (yangisi birinchi). */
  ledger(supplierId: string, limit = 500, tx: DbOrTx = this.db) {
    return tx
      .select({ l: supplierLedger, method: paymentMethods.label })
      .from(supplierLedger)
      .leftJoin(paymentMethods, eq(paymentMethods.id, supplierLedger.methodId))
      .where(eq(supplierLedger.supplierId, supplierId))
      .orderBy(desc(supplierLedger.seq))
      .limit(limit);
  }

  /** To'lovlar va manfiy tuzatishlar yig'indisi (taqsimlash uchun): −amount. */
  async creditsTotal(supplierId: string, tx: DbOrTx = this.db): Promise<number> {
    const r = await tx
      .select({ v: sql<number>`coalesce(sum(-${supplierLedger.amount}), 0)::bigint` })
      .from(supplierLedger)
      .where(and(eq(supplierLedger.supplierId, supplierId), inArray(supplierLedger.type, ['payment', 'adjustment']), sql`${supplierLedger.amount} < 0`));
    return Number(r[0]?.v ?? 0);
  }

  /** Qo'lda qo'shilgan (musbat) qarzlar — "eski qarz" sifatida taqsimlanadi. */
  manualDebts(supplierId: string, tx: DbOrTx = this.db) {
    return tx.select().from(supplierLedger).where(and(eq(supplierLedger.supplierId, supplierId), eq(supplierLedger.type, 'adjustment'), sql`${supplierLedger.amount} > 0`)).orderBy(asc(supplierLedger.seq));
  }

  /** Yetkazib beruvchining kirimlari (yangisi birinchi) + filial nomi. */
  receipts(supplierId: string, limit = 300, tx: DbOrTx = this.db) {
    return tx
      .select({ r: stockReceipts, branchName: branches.name })
      .from(stockReceipts)
      .innerJoin(branches, eq(branches.id, stockReceipts.branchId))
      .where(eq(stockReceipts.supplierId, supplierId))
      .orderBy(desc(stockReceipts.date), desc(stockReceipts.number))
      .limit(limit);
  }

  /** Qarzi shu yetkazib beruvchida turgan barcha kirimlar (taqsimlash uchun, limitsiz). */
  debtReceipts(supplierId: string, tx: DbOrTx = this.db) {
    return tx
      .select({ id: stockReceipts.id, date: stockReceipts.date, number: stockReceipts.number, debt: stockReceipts.debtAmount })
      .from(stockReceipts)
      .where(and(eq(stockReceipts.debtSupplierId, supplierId), gt(stockReceipts.debtAmount, 0)))
      .orderBy(asc(stockReceipts.date), asc(stockReceipts.number));
  }

  receiptLinesOf(receiptIds: string[], tx: DbOrTx = this.db): Promise<ReceiptLineRow[]> {
    return receiptIds.length ? tx.select().from(stockReceiptLines).where(inArray(stockReceiptLines.receiptId, receiptIds)) : Promise.resolve([]);
  }

  lockReceipt(tx: DbOrTx, id: string) {
    return tx.select().from(stockReceipts).where(eq(stockReceipts.id, id)).for('update').then((r) => r[0] ?? null);
  }

  setReceiptDebt(tx: DbOrTx, id: string, v: { debtAmount: number; debtSupplierId: string | null }) {
    return tx.update(stockReceipts).set(v).where(eq(stockReceipts.id, id));
  }

  findPaymentMethod(tx: DbOrTx, id: string) {
    return tx.select().from(paymentMethods).where(eq(paymentMethods.id, id)).limit(1).then((r) => r[0] ?? null);
  }
}
