import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { branches, paymentMethods, saleLines, salePayments, sales, units } from '../../../entities/index.js';
import type { SalesListQuery } from '../dto/sales.dto.js';

export type SaleRow = typeof sales.$inferSelect;
export type SaleLineRow = typeof saleLines.$inferSelect;
export type SalePaymentRow = typeof salePayments.$inferSelect;
export type PaymentMethodRow = typeof paymentMethods.$inferSelect;
export type StockKey = { productId: string; variantId: string | null };

/**
 * Cheklar bo'yicha barcha SQL (sotuv, qarz to'lovi, storno, ro'yxat). Biznes qoidalari va xatolar servisda.
 * Qulf tartibi servisda saqlanadi: avval filial qatori, keyin qoldiq qatorlari (InventoryService.lockLevels).
 */
@Injectable()
export class SalesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /* ───────── Hisob uchun ma'lumotnomalar ───────── */

  units(tx: DbOrTx = this.db) {
    return tx.select().from(units);
  }

  /** Filial narxi (TZ 8.1): bo'lsa umumiy narx o'rniga. */
  branchPrices(tx: DbOrTx, branchId: string, productIds: string[]) {
    return tx.query.branchPrices.findMany({ where: (bp, { and, eq, inArray }) => and(eq(bp.branchId, branchId), inArray(bp.productId, productIds)) });
  }

  /** Qoldiqni qulfsiz o'qish (quote) — kalit `productId|variantId`. */
  async readLevels(tx: DbOrTx, branchId: string, keys: StockKey[]) {
    const rows = await tx.query.stockLevels.findMany({ where: (s, { and, eq, inArray }) => and(eq(s.branchId, branchId), inArray(s.productId, [...new Set(keys.map((k) => k.productId))])) });
    const out = new Map<string, { id: string; stock: number; costPrice: number | null; minStock: number | null }>();
    for (const r of rows) out.set(`${r.productId}|${r.variantId ?? ''}`, { id: r.id, stock: Number(r.stock), costPrice: r.costPrice != null ? Number(r.costPrice) : null, minStock: r.minStock != null ? Number(r.minStock) : null });
    return out;
  }

  paymentMethods(tx: DbOrTx = this.db) {
    return tx.select().from(paymentMethods);
  }

  findPaymentMethod(tx: DbOrTx, id: string) {
    return tx.select().from(paymentMethods).where(eq(paymentMethods.id, id)).limit(1).then((r) => r[0] ?? null);
  }

  /* ───────── Qulf va raqam ───────── */

  /** Filial qatorini FOR UPDATE bilan qulflaydi (chek raqami ketma-ketligi); filial kodini qaytaradi. */
  lockBranch(tx: DbOrTx, branchId: string) {
    return tx.select({ code: branches.code }).from(branches).where(eq(branches.id, branchId)).for('update').then((r) => r[0] ?? null);
  }

  /** Kun ichidagi oxirgi tartib raqami — chek raqamining oxirgi qismi (MAIN-20261024-0007 → 7). */
  maxSeq(tx: DbOrTx, branchId: string, prefix: string) {
    return tx
      .select({ max: sql<number>`coalesce(max(split_part(${sales.number}, '-', 3)::int), 0)::int` })
      .from(sales)
      .where(and(eq(sales.branchId, branchId), sql`${sales.number} like ${prefix + '%'}`))
      .then((r) => r[0].max);
  }

  /* ───────── Yozish ───────── */

  findIdByClientId(clientId: string, tx: DbOrTx = this.db) {
    return tx.select({ id: sales.id }).from(sales).where(eq(sales.clientId, clientId)).limit(1).then((r) => r[0]?.id ?? null);
  }

  insertSale(tx: DbOrTx, v: typeof sales.$inferInsert) {
    return tx.insert(sales).values(v).returning({ id: sales.id }).then((r) => r[0].id);
  }

  insertLines(tx: DbOrTx, v: (typeof saleLines.$inferInsert)[]) {
    return tx.insert(saleLines).values(v);
  }

  insertPayments(tx: DbOrTx, v: (typeof salePayments.$inferInsert)[]) {
    return tx.insert(salePayments).values(v);
  }

  updateSale(tx: DbOrTx, id: string, set: Partial<typeof sales.$inferInsert>) {
    return tx.update(sales).set(set).where(eq(sales.id, id));
  }

  /* ───────── O'qish ───────── */

  findById(id: string, tx: DbOrTx = this.db) {
    return tx.select().from(sales).where(eq(sales.id, id)).limit(1).then((r) => r[0] ?? null);
  }

  /** Storno uchun chek qatori FOR UPDATE bilan (ikki parallel storno bo'lmasin). */
  lockById(tx: DbOrTx, id: string) {
    return tx.select().from(sales).where(eq(sales.id, id)).limit(1).for('update').then((r) => r[0] ?? null);
  }

  lines(tx: DbOrTx, saleId: string) {
    return tx.select().from(saleLines).where(eq(saleLines.saleId, saleId));
  }

  /** Bitta chekning qatorlari (tartib bo'yicha) va to'lovlari. */
  details(saleId: string, tx: DbOrTx = this.db) {
    return Promise.all([tx.select().from(saleLines).where(eq(saleLines.saleId, saleId)).orderBy(saleLines.sortOrder), tx.select().from(salePayments).where(eq(salePayments.saleId, saleId))]);
  }

  /** Bir nechta chekning qatorlari va to'lovlari — 2 ta so'rov (N+1 emas). */
  detailsMany(saleIds: string[], tx: DbOrTx = this.db): Promise<[SaleLineRow[], SalePaymentRow[]]> {
    if (!saleIds.length) return Promise.resolve([[], []]);
    return Promise.all([tx.select().from(saleLines).where(inArray(saleLines.saleId, saleIds)).orderBy(saleLines.sortOrder), tx.select().from(salePayments).where(inArray(salePayments.saleId, saleIds))]);
  }

  /** Ro'yxat + jami (2 ta so'rov). `cashierId` servisda hal qilinadi: kassir uchun o'ziniki, aks holda filtr. */
  list(branchId: string, cashierId: string | undefined, q: SalesListQuery, tx: DbOrTx = this.db) {
    const where = and(
      eq(sales.branchId, branchId),
      cashierId ? eq(sales.cashierId, cashierId) : undefined,
      q.from ? gte(sales.createdAt, new Date(q.from)) : undefined,
      q.to ? lte(sales.createdAt, new Date(q.to + 'T23:59:59.999Z')) : undefined,
      q.customerId ? eq(sales.customerId, q.customerId) : undefined,
      q.shiftId ? eq(sales.shiftId, q.shiftId) : undefined,
      q.type === 'sale' || q.type === 'debt_payment' ? eq(sales.type, q.type) : undefined,
      q.status === 'voided' ? eq(sales.status, 'voided') : q.status === 'completed' ? eq(sales.status, 'completed') : undefined,
      q.q?.trim() ? or(ilike(sales.number, `%${q.q.trim()}%`), ilike(sales.customerName, `%${q.q.trim()}%`), sql`exists (select 1 from ${saleLines} where ${saleLines.saleId} = ${sales.id} and (${saleLines.name} ilike ${'%' + q.q.trim() + '%'} or ${saleLines.sku} ilike ${'%' + q.q.trim() + '%'}))`) : undefined,
    );
    return Promise.all([
      tx.select().from(sales).where(where).orderBy(desc(sales.createdAt)).limit(q.pageSize).offset(q.offset),
      tx.select({ total: sql<number>`count(*)::int` }).from(sales).where(where).then((r) => r[0].total),
    ]);
  }
}
