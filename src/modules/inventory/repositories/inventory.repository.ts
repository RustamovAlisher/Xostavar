import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { auditLogs, branches, productVariants, products, stockLevels, stockMovements, stockReceiptLines, stockReceipts, suppliers, unitConversions, units } from '../../../entities/index.js';
import type { StockInListQuery } from '../dto/inventory.dto.js';

export type ProductRow = typeof products.$inferSelect;
export type VariantRow = typeof productVariants.$inferSelect;
export type ConversionRow = typeof unitConversions.$inferSelect;
export type UnitRow = typeof units.$inferSelect;
export type StockLevelRow = typeof stockLevels.$inferSelect;
export type StockReceiptRow = typeof stockReceipts.$inferSelect;
export type StockReceiptLineRow = typeof stockReceiptLines.$inferSelect;
export type StockMovementRow = typeof stockMovements.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type MovementType = (typeof stockMovements.$inferInsert)['type'];
export type LevelKey = { productId: string; variantId: string | null };
/** `FOR UPDATE` bilan olingan qoldiq qatori (xom, numeric string bo'lishi mumkin — mapper songa o'giradi). */
export type LockedLevelRow = { id: string; stock: number; costPrice: number | null; minStock: number | null };

/**
 * Ombor bo'yicha barcha SQL (qoldiq, jurnal, kirim hujjatlari). Biznes qoidalari, qulflash tartibi va xatolar servisda.
 * Tranzaksiya ichidagina ishlaydigan metodlar `tx` ni birinchi, qolganlari oxirgi (`= this.db`) parametr sifatida oladi.
 */
@Injectable()
export class InventoryRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private levelWhere(branchId: string, k: LevelKey) {
    return and(eq(stockLevels.branchId, branchId), eq(stockLevels.productId, k.productId), k.variantId ? eq(stockLevels.variantId, k.variantId) : isNull(stockLevels.variantId));
  }

  /* ───────── Qoldiq ───────── */

  /** Bitta qoldiq qatorini `FOR UPDATE` bilan oladi; yo'q bo'lsa null. */
  lockLevel(tx: DbOrTx, branchId: string, k: LevelKey): Promise<LockedLevelRow | null> {
    return tx.select({ id: stockLevels.id, stock: stockLevels.stock, costPrice: stockLevels.costPrice, minStock: stockLevels.minStock }).from(stockLevels).where(this.levelWhere(branchId, k)).for('update').then((r) => r[0] ?? null);
  }

  /**
   * Bir nechta qoldiq qatorini BITTA so'rov bilan `FOR UPDATE` qulflaydi (har mahsulot uchun alohida so'rov — N+1 edi).
   * Qulflar `id` tartibida olinadi — hamma tranzaksiyalarda bir xil tartib, deadlock bo'lmaydi.
   */
  lockLevelsMany(tx: DbOrTx, branchId: string, keys: LevelKey[]): Promise<(LockedLevelRow & { productId: string; variantId: string | null })[]> {
    if (!keys.length) return Promise.resolve([]);
    return tx
      .select({ id: stockLevels.id, productId: stockLevels.productId, variantId: stockLevels.variantId, stock: stockLevels.stock, costPrice: stockLevels.costPrice, minStock: stockLevels.minStock })
      .from(stockLevels)
      .where(or(...keys.map((k) => this.levelWhere(branchId, k))))
      .orderBy(asc(stockLevels.id))
      .for('update');
  }

  /** Yo'q qoldiq qatorlarini bitta INSERT bilan 0 qilib yaratadi (parallel yaratilgan bo'lsa — jim o'tadi). */
  insertLevelsIfMissing(tx: DbOrTx, branchId: string, keys: LevelKey[]) {
    if (!keys.length) return Promise.resolve();
    return tx.insert(stockLevels).values(keys.map((k) => ({ branchId, productId: k.productId, variantId: k.variantId, stock: 0 }))).onConflictDoNothing().then(() => undefined);
  }

  /** Bir nechta qatorni bitta UPDATE bilan: stock = round(stock + delta, 4), version + 1. Qaytaradi: id → yangi qoldiq. */
  async incrementStocks(tx: DbOrTx, items: { id: string; delta: number }[]): Promise<Map<string, number>> {
    if (!items.length) return new Map();
    const values = sql.join(items.map((i) => sql`(${i.id}::uuid, ${i.delta}::numeric)`), sql`, `);
    const res = await tx.execute<{ id: string; stock: string }>(sql`
      update ${stockLevels} as s
         set stock = round(s.stock + v.delta, 4), version = s.version + 1, updated_at = now()
        from (values ${values}) as v(id, delta)
       where s.id = v.id
   returning s.id, s.stock`);
    return new Map(res.rows.map((r) => [r.id, Number(r.stock)]));
  }

  insertMovements(tx: DbOrTx, rows: (typeof stockMovements.$inferInsert)[]) {
    if (!rows.length) return Promise.resolve();
    return tx.insert(stockMovements).values(rows).then(() => undefined);
  }

  /** Qoldiq qatorini 0 bilan yaratadi (parallel yaratilgan bo'lsa — jim o'tadi). */
  insertLevelIfMissing(tx: DbOrTx, branchId: string, k: LevelKey) {
    return tx.insert(stockLevels).values({ branchId, productId: k.productId, variantId: k.variantId, stock: 0 }).onConflictDoNothing();
  }

  /** Atomar: stock = round(stock + delta, 4), ixtiyoriy yangi tannarx, version + 1. Qaytaradi: yangi qoldiq. */
  incrementStock(tx: DbOrTx, id: string, delta: number, newCost: number | null | undefined): Promise<number> {
    return tx
      .update(stockLevels)
      .set({ stock: sql`round(${stockLevels.stock} + ${delta}, 4)`, ...(newCost !== undefined ? { costPrice: newCost } : {}), version: sql`${stockLevels.version} + 1` })
      .where(eq(stockLevels.id, id))
      .returning({ stock: stockLevels.stock })
      .then((r) => r[0].stock);
  }

  insertMovement(tx: DbOrTx, v: typeof stockMovements.$inferInsert) {
    return tx.insert(stockMovements).values(v);
  }

  findLevel(id: string, branchId: string, tx: DbOrTx = this.db) {
    return tx.select().from(stockLevels).where(and(eq(stockLevels.id, id), eq(stockLevels.branchId, branchId))).limit(1).then((r) => r[0] ?? null);
  }

  updateLevel(id: string, set: Partial<Pick<typeof stockLevels.$inferInsert, 'minStock' | 'costPrice'>>, tx: DbOrTx = this.db) {
    return tx.update(stockLevels).set({ ...set, version: sql`${stockLevels.version} + 1` }).where(eq(stockLevels.id, id)).returning().then((r) => r[0]);
  }

  /** Bir mahsulotning qoldiqlari filiallar bo'yicha; `branchIds=null` — hammasi. */
  levelsOfProduct(productId: string, branchIds: string[] | null, tx: DbOrTx = this.db) {
    return tx
      .select({ branchId: stockLevels.branchId, branch: branches.name, variantId: stockLevels.variantId, stock: stockLevels.stock, minStock: stockLevels.minStock, costPrice: stockLevels.costPrice, id: stockLevels.id })
      .from(stockLevels)
      .innerJoin(branches, eq(branches.id, stockLevels.branchId))
      .where(and(eq(stockLevels.productId, productId), branchIds ? inArray(stockLevels.branchId, branchIds.length ? branchIds : ['00000000-0000-0000-0000-000000000000']) : undefined))
      .orderBy(asc(branches.createdAt));
  }

  /* ───────── Mahsulot / birlik ma'lumotlari ───────── */

  /** Narx/birlik hisobi uchun mahsulotlar, variantlar va konversiyalar — 3 ta batch so'rov. */
  targetRows(tx: DbOrTx, pids: string[]): Promise<[ProductRow[], VariantRow[], ConversionRow[]]> {
    return Promise.all([
      tx.select().from(products).where(and(inArray(products.id, pids), isNull(products.deletedAt))),
      tx.select().from(productVariants).where(and(inArray(productVariants.productId, pids), isNull(productVariants.deletedAt))),
      tx.select().from(unitConversions).where(inArray(unitConversions.productId, pids)),
    ]);
  }

  allUnits(tx: DbOrTx = this.db): Promise<UnitRow[]> {
    return tx.select().from(units);
  }

  productName(productId: string, tx: DbOrTx = this.db) {
    return tx.select({ name: products.name }).from(products).where(eq(products.id, productId)).limit(1).then((r) => r[0]?.name ?? null);
  }

  setProductRetailPrice(tx: DbOrTx, productId: string, retailPrice: number) {
    return tx.update(products).set({ retailPrice }).where(eq(products.id, productId));
  }

  setVariantRetailPrice(tx: DbOrTx, variantId: string, retailPrice: number) {
    return tx.update(productVariants).set({ retailPrice }).where(eq(productVariants.id, variantId));
  }

  /* ───────── Filial / yetkazib beruvchi ───────── */

  /** Filial qatori qulfi (kirim raqami ketma-ket bo'lsin); yo'q bo'lsa null. */
  lockBranch(tx: DbOrTx, branchId: string) {
    return tx.select({ id: branches.id, name: branches.name, active: branches.active }).from(branches).where(eq(branches.id, branchId)).for('update').then((r) => r[0] ?? null);
  }

  /** Nom bo'yicha yetkazib beruvchini topadi (katta-kichik harfga e'tiborsiz), yo'q bo'lsa yaratadi. */
  async ensureSupplier(tx: DbOrTx, name: string): Promise<{ id: string; name: string }> {
    const found = await tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(sql`lower(${suppliers.name}) = lower(${name})`).limit(1);
    if (found[0]) return found[0];
    const ins = await tx.insert(suppliers).values({ name }).onConflictDoNothing().returning({ id: suppliers.id, name: suppliers.name });
    if (ins[0]) return ins[0];
    const again = await tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(sql`lower(${suppliers.name}) = lower(${name})`).limit(1);
    return again[0]!;
  }

  supplierName(id: string, tx: DbOrTx = this.db) {
    return tx.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, id)).limit(1).then((r) => r[0]?.name ?? null);
  }

  /* ───────── Kirim hujjatlari ───────── */

  nextReceiptNumber(tx: DbOrTx, branchId: string): Promise<number> {
    return tx.select({ next: sql<number>`coalesce(max(${stockReceipts.number}), 0)::int + 1` }).from(stockReceipts).where(eq(stockReceipts.branchId, branchId)).then((r) => r[0].next);
  }

  insertReceipt(tx: DbOrTx, v: typeof stockReceipts.$inferInsert) {
    return tx.insert(stockReceipts).values(v).returning({ id: stockReceipts.id, number: stockReceipts.number }).then((r) => r[0]);
  }

  insertReceiptLine(tx: DbOrTx, v: typeof stockReceiptLines.$inferInsert) {
    return tx.insert(stockReceiptLines).values(v);
  }

  findReceipt(id: string, tx: DbOrTx = this.db) {
    return tx.select().from(stockReceipts).where(eq(stockReceipts.id, id)).limit(1).then((r) => r[0] ?? null);
  }

  /** Kirim qatori + hujjati, qator qulflanadi (tahrir). */
  lockReceiptLine(tx: DbOrTx, lineId: string) {
    return tx
      .select({ line: stockReceiptLines, receipt: stockReceipts })
      .from(stockReceiptLines)
      .innerJoin(stockReceipts, eq(stockReceipts.id, stockReceiptLines.receiptId))
      .where(eq(stockReceiptLines.id, lineId))
      .for('update', { of: stockReceiptLines })
      .then((r) => r[0] ?? null);
  }

  /** Hujjatni o'chiradi (qatorlari `cascade` bilan ketadi). */
  deleteReceipt(tx: DbOrTx, id: string) {
    return tx.delete(stockReceipts).where(eq(stockReceipts.id, id));
  }

  deleteReceiptLine(tx: DbOrTx, id: string) {
    return tx.delete(stockReceiptLines).where(eq(stockReceiptLines.id, id));
  }

  findReceiptLine(id: string, tx: DbOrTx = this.db) {
    return tx.select({ receiptId: stockReceiptLines.receiptId }).from(stockReceiptLines).where(eq(stockReceiptLines.id, id)).limit(1).then((r) => r[0] ?? null);
  }

  updateReceiptLine(tx: DbOrTx, id: string, v: Partial<typeof stockReceiptLines.$inferInsert>) {
    return tx.update(stockReceiptLines).set(v).where(eq(stockReceiptLines.id, id));
  }

  /** Hujjat jami qatorlardan qayta hisoblanadi; yetkazib beruvchi / hujjat raqami ixtiyoriy yangilanadi. */
  updateReceiptHead(tx: DbOrTx, receiptId: string, v: { supplierName?: string | null; supplierId?: string | null; invoice?: string | null }) {
    const set: Record<string, unknown> = {
      totalCost: sql`(select coalesce(sum(${stockReceiptLines.totalCost}), 0) from ${stockReceiptLines} where ${stockReceiptLines.receiptId} = ${receiptId})`,
    };
    if (v.supplierName !== undefined) { set.supplierName = v.supplierName; set.supplierId = v.supplierId ?? null; }
    if (v.invoice !== undefined) set.invoice = v.invoice;
    return tx.update(stockReceipts).set(set).where(eq(stockReceipts.id, receiptId));
  }

  receiptLines(receiptId: string, tx: DbOrTx = this.db) {
    return tx.select().from(stockReceiptLines).where(eq(stockReceiptLines.receiptId, receiptId));
  }

  /** Bir nechta hujjat qatorlari bitta `inArray` so'rov bilan (N+1 emas). */
  receiptLinesOf(receiptIds: string[], tx: DbOrTx = this.db) {
    return receiptIds.length ? tx.select().from(stockReceiptLines).where(inArray(stockReceiptLines.receiptId, receiptIds)) : Promise.resolve([] as StockReceiptLineRow[]);
  }

  /** Hujjatlar ro'yxati + jami (2 ta so'rov); mahsulot filtri `exists` bilan. */
  listReceipts(branchId: string, q: StockInListQuery, tx: DbOrTx = this.db) {
    const where = and(
      eq(stockReceipts.branchId, branchId),
      q.from ? gte(stockReceipts.date, q.from) : undefined,
      q.to ? lte(stockReceipts.date, q.to) : undefined,
      q.productId ? sql`exists (select 1 from ${stockReceiptLines} where ${stockReceiptLines.receiptId} = ${stockReceipts.id} and ${stockReceiptLines.productId} = ${q.productId})` : undefined,
    );
    return Promise.all([
      tx.select().from(stockReceipts).where(where).orderBy(desc(stockReceipts.createdAt)).limit(q.pageSize).offset(q.offset),
      tx.select({ total: sql<number>`count(*)::int` }).from(stockReceipts).where(where).then((r) => r[0].total),
    ]);
  }

  /* ───────── Jurnal / tarix ───────── */

  /** Harakatlar `seq` bo'yicha teskari (eng yangisi birinchi) + jami. */
  listMovements(branchId: string, productId: string, variantId: string | undefined, q: { pageSize: number; offset: number }, tx: DbOrTx = this.db) {
    const where = and(eq(stockMovements.branchId, branchId), eq(stockMovements.productId, productId), variantId ? eq(stockMovements.variantId, variantId) : undefined);
    return Promise.all([
      tx.select().from(stockMovements).where(where).orderBy(desc(stockMovements.seq)).limit(q.pageSize).offset(q.offset),
      tx.select({ total: sql<number>`count(*)::int` }).from(stockMovements).where(where).then((r) => r[0].total),
    ]);
  }

  /** Mahsulot tarixi: kirim qatorlari (hujjati bilan) va audit yozuvlari, har biri 200 tagacha; `scope` — filial yoki null (hammasi). */
  historyRows(productId: string, scope: string | null, tx: DbOrTx = this.db) {
    return Promise.all([
      tx
        .select({ line: stockReceiptLines, receipt: stockReceipts })
        .from(stockReceiptLines)
        .innerJoin(stockReceipts, eq(stockReceipts.id, stockReceiptLines.receiptId))
        .where(and(eq(stockReceiptLines.productId, productId), scope ? eq(stockReceipts.branchId, scope) : undefined))
        .orderBy(desc(stockReceipts.createdAt))
        .limit(200),
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.targetId, productId), scope ? eq(auditLogs.branchId, scope) : undefined))
        .orderBy(desc(auditLogs.ts))
        .limit(200),
    ]);
  }
}
