import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, exists, gt, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import {
  branchPrices, branches, categories, productBarcodes, productVariants, products, saleLines, stockLevels, stockReceiptLines, unitConversions, units,
} from '../../../entities/index.js';
import type { ProductListQuery } from '../dto/catalog.dto.js';

export type ProductRow = typeof products.$inferSelect;
export type VariantRow = typeof productVariants.$inferSelect;
export type ConversionRow = typeof unitConversions.$inferSelect;
export type BarcodeRow = typeof productBarcodes.$inferSelect;
export type StockLevelRow = typeof stockLevels.$inferSelect;
export type BranchPriceRow = typeof branchPrices.$inferSelect;
export type ProductInsert = typeof products.$inferInsert;
export type VariantInsert = typeof productVariants.$inferInsert;
export type ConversionInsert = typeof unitConversions.$inferInsert;
export type BarcodeInsert = typeof productBarcodes.$inferInsert;
export type LevelFields = Pick<typeof stockLevels.$inferInsert, 'minStock' | 'costPrice'>;

/** Bir nechta mahsulotning bolalari — mapper `toProductViews` ga beriladi. */
export interface ProductChildren {
  variants: VariantRow[];
  convs: ConversionRow[];
  codes: BarcodeRow[];
  levels: StockLevelRow[];
  prices: BranchPriceRow[];
}

const NIL = '00000000-0000-0000-0000-000000000000';

/**
 * Katalog bo'yicha barcha SQL. Faqat ma'lumot oladi/yozadi — biznes qoidalari va xatolar servisda.
 * Har metod `tx` qabul qiladi: tranzaksiya ichida chaqirilsa shu `tx`, bo'lmasa umumiy `db`.
 */
@Injectable()
export class CatalogRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /* ───────── O'qish (N+1 siz) ───────── */

  /** Berilgan mahsulotlarning variantlari, konversiyalari, shtrix-kodlari, filial qoldig'i va narxi — 5 ta batch so'rov. */
  async loadChildren(ids: string[], branchId: string | null, tx: DbOrTx = this.db): Promise<ProductChildren> {
    const [variants, convs, codes, levels, prices] = await Promise.all([
      tx.select().from(productVariants).where(and(inArray(productVariants.productId, ids), isNull(productVariants.deletedAt))).orderBy(asc(productVariants.sortOrder), asc(productVariants.createdAt)),
      tx.select().from(unitConversions).where(inArray(unitConversions.productId, ids)),
      tx.select().from(productBarcodes).where(inArray(productBarcodes.productId, ids)),
      branchId ? tx.select().from(stockLevels).where(and(eq(stockLevels.branchId, branchId), inArray(stockLevels.productId, ids))) : Promise.resolve([]),
      branchId ? tx.select().from(branchPrices).where(and(eq(branchPrices.branchId, branchId), inArray(branchPrices.productId, ids))) : Promise.resolve([]),
    ]);
    return { variants, convs, codes, levels, prices };
  }

  /** Ro'yxat sahifasi + jami + kategoriya bo'yicha facet (3 ta so'rov, bitta WHERE). */
  list(branchId: string | null, q: ProductListQuery, tx: DbOrTx = this.db) {
    const where: SQL[] = [isNull(products.deletedAt)];
    if (q.categoryId) where.push(eq(products.categoryId, q.categoryId));
    const inBranch = q.inBranch === 'true' || q.inBranch === '1';
    if (inBranch && branchId) {
      where.push(exists(tx.select({ x: sql`1` }).from(stockLevels).where(and(eq(stockLevels.branchId, branchId), eq(stockLevels.productId, products.id)))));
    }
    if ((q.lowStock === 'true' || q.lowStock === '1') && branchId) {
      where.push(exists(tx.select({ x: sql`1` }).from(stockLevels).where(and(eq(stockLevels.branchId, branchId), eq(stockLevels.productId, products.id), gt(stockLevels.minStock, 0), sql`${stockLevels.stock} < ${stockLevels.minStock}`))));
    }
    if (q.q?.trim()) {
      const term = q.q.trim();
      // lower(col) like — `lower(...)` ustidagi trigram (gin) indekslar ishlaydi; ILIKE bu indekslarni ishlatmaydi
      const like = `%${term.toLowerCase()}%`;
      const lk = (col: PgColumn) => sql`lower(${col}) like ${like}`;
      where.push(
        or(
          lk(products.name),
          lk(products.sku),
          exists(tx.select({ x: sql`1` }).from(productBarcodes).where(and(eq(productBarcodes.productId, products.id), lk(productBarcodes.barcode)))),
          exists(tx.select({ x: sql`1` }).from(productVariants).where(and(eq(productVariants.productId, products.id), isNull(productVariants.deletedAt), or(lk(productVariants.name), lk(productVariants.sku))))),
        )!,
      );
    }
    const cond = and(...where);
    return Promise.all([
      tx.select().from(products).where(cond).orderBy(q.sort === 'name' ? asc(products.name) : desc(products.createdAt)).limit(q.pageSize).offset(q.offset),
      tx.select({ total: sql<number>`count(*)::int` }).from(products).where(cond).then((r) => r[0].total),
      tx.select({ categoryId: products.categoryId, n: sql<number>`count(*)::int` }).from(products).where(cond).groupBy(products.categoryId),
    ]);
  }

  /** O'chirilmagan mahsulot (null — yo'q yoki yumshoq o'chirilgan). */
  findById(id: string, tx: DbOrTx = this.db) {
    return tx.select().from(products).where(and(eq(products.id, id), isNull(products.deletedAt))).limit(1).then((r) => r[0] ?? null);
  }

  /** Tahrirlash/o'chirish uchun qulflangan qator (FOR UPDATE). */
  findByIdForUpdate(tx: DbOrTx, id: string) {
    return tx.select().from(products).where(and(eq(products.id, id), isNull(products.deletedAt))).limit(1).for('update').then((r) => r[0] ?? null);
  }

  /* ───────── Kod bo'yicha qidirish (skaner) ───────── */

  findBarcode(codeLower: string, tx: DbOrTx = this.db) {
    return tx.select().from(productBarcodes).where(eq(sql`lower(${productBarcodes.barcode})`, codeLower)).limit(1).then((r) => r[0] ?? null);
  }

  findVariantBySku(codeLower: string, tx: DbOrTx = this.db) {
    return tx.select({ productId: productVariants.productId, id: productVariants.id }).from(productVariants).where(and(eq(sql`lower(${productVariants.sku})`, codeLower), isNull(productVariants.deletedAt))).limit(1).then((r) => r[0] ?? null);
  }

  findProductBySku(codeLower: string, tx: DbOrTx = this.db) {
    return tx.select({ id: products.id }).from(products).where(and(eq(sql`lower(${products.sku})`, codeLower), isNull(products.deletedAt))).limit(1).then((r) => r[0] ?? null);
  }

  /* ───────── Tekshiruvlar uchun ma'lumot ───────── */

  /** Berilgan (kichik harfli) kodlar band bo'lsa — birinchi to'qnashuv `{ code, name }`, aks holda null. */
  async findCodeHit(tx: DbOrTx, list: string[], exceptProductId?: string) {
    const not = (col: PgColumn) => (exceptProductId ? ne(col, exceptProductId) : undefined);
    const [p, v, b] = await Promise.all([
      tx.select({ code: products.sku, name: products.name }).from(products).where(and(inArray(sql`lower(${products.sku})`, list), not(products.id), isNull(products.deletedAt))),
      tx.select({ code: productVariants.sku, name: productVariants.name }).from(productVariants).where(and(inArray(sql`lower(${productVariants.sku})`, list), not(productVariants.productId), isNull(productVariants.deletedAt))),
      tx.select({ code: productBarcodes.barcode, name: products.name }).from(productBarcodes).innerJoin(products, eq(products.id, productBarcodes.productId)).where(and(inArray(sql`lower(${productBarcodes.barcode})`, list), not(productBarcodes.productId))),
    ]);
    return p[0] ?? v[0] ?? b[0] ?? null;
  }

  unitIds(tx: DbOrTx = this.db) {
    return tx.select({ id: units.id }).from(units).then((r) => r.map((u) => u.id));
  }

  findCategory(id: string, tx: DbOrTx = this.db) {
    return tx.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.id, id)).limit(1).then((r) => r[0] ?? null);
  }

  /** Band SKU lar (mahsulot + variant), `exceptProductId` dan tashqari. */
  async takenSkus(tx: DbOrTx, exceptProductId?: string): Promise<string[]> {
    const [p, v] = await Promise.all([
      tx.select({ s: products.sku }).from(products).where(exceptProductId ? ne(products.id, exceptProductId) : undefined),
      tx.select({ s: productVariants.sku }).from(productVariants).where(exceptProductId ? ne(productVariants.productId, exceptProductId) : undefined),
    ]);
    return [...p, ...v].map((r) => r.s);
  }

  /* ───────── Yozish ───────── */

  insertProduct(tx: DbOrTx, v: ProductInsert) {
    return tx.insert(products).values(v).returning({ id: products.id }).then((r) => r[0].id);
  }

  updateProduct(tx: DbOrTx, id: string, v: Partial<ProductInsert>) {
    return tx.update(products).set(v).where(eq(products.id, id));
  }

  /** Kiritilgan tartibda id lar. */
  insertVariants(tx: DbOrTx, rows: VariantInsert[]) {
    return tx.insert(productVariants).values(rows).returning({ id: productVariants.id }).then((r) => r.map((x) => x.id));
  }

  updateVariant(tx: DbOrTx, id: string, v: Partial<VariantInsert>) {
    return tx.update(productVariants).set(v).where(eq(productVariants.id, id));
  }

  activeVariants(tx: DbOrTx, productId: string) {
    return tx.select().from(productVariants).where(and(eq(productVariants.productId, productId), isNull(productVariants.deletedAt)));
  }

  /** Qoldig'i bor variantlar (filial nomi bilan). */
  stockedVariants(tx: DbOrTx, variantIds: string[]) {
    return tx
      .select({ variantId: stockLevels.variantId, stock: stockLevels.stock, branch: branches.name })
      .from(stockLevels)
      .innerJoin(branches, eq(branches.id, stockLevels.branchId))
      .where(and(inArray(stockLevels.variantId, variantIds), gt(stockLevels.stock, 0)));
  }

  /** Olib tashlangan variantlar: yumshoq o'chirish (SKU bo'shatiladi) + qoldiq qatorlari o'chiriladi. */
  async softDeleteVariants(tx: DbOrTx, variantIds: string[]) {
    await tx.update(productVariants).set({ deletedAt: new Date(), sku: sql`${productVariants.sku} || '#del#' || extract(epoch from now())::bigint` }).where(inArray(productVariants.id, variantIds));
    await tx.delete(stockLevels).where(inArray(stockLevels.variantId, variantIds));
  }

  /** Konversiya va shtrix-kodlar to'liq qayta yoziladi. */
  async replaceChildren(tx: DbOrTx, productId: string, convRows: ConversionInsert[], codeRows: BarcodeInsert[]) {
    await Promise.all([tx.delete(unitConversions).where(eq(unitConversions.productId, productId)), tx.delete(productBarcodes).where(eq(productBarcodes.productId, productId))]);
    if (convRows.length) await tx.insert(unitConversions).values(convRows);
    if (codeRows.length) await tx.insert(productBarcodes).values(codeRows);
  }

  /** Faqat mavjud stock_levels qatoriga yoziladi (TZ 7.3). */
  updateLevelFields(tx: DbOrTx, branchId: string, productId: string, variantId: string | null, set: LevelFields) {
    return tx.update(stockLevels).set(set).where(and(eq(stockLevels.branchId, branchId), eq(stockLevels.productId, productId), variantId ? eq(stockLevels.variantId, variantId) : isNull(stockLevels.variantId)));
  }

  /* ───────── O'chirish (TZ 8.11) ───────── */

  /** Biror filialda qoldig'i bo'lsa — shu filial va miqdor. `baseOnly` — faqat variantsiz (asosiy) qator. */
  findStocked(tx: DbOrTx, productId: string, baseOnly = false) {
    return tx
      .select({ branch: branches.name, stock: stockLevels.stock })
      .from(stockLevels)
      .innerJoin(branches, eq(branches.id, stockLevels.branchId))
      .where(and(eq(stockLevels.productId, productId), gt(stockLevels.stock, 0), baseOnly ? isNull(stockLevels.variantId) : undefined))
      .limit(1)
      .then((r) => r[0] ?? null);
  }

  /** Sotuv yoki kirim tarixi bormi. */
  async hasHistory(tx: DbOrTx, productId: string): Promise<boolean> {
    const [sold] = await tx.select({ id: saleLines.id }).from(saleLines).where(eq(saleLines.productId, productId)).limit(1);
    if (sold) return true;
    const [received] = await tx.select({ id: stockReceiptLines.id }).from(stockReceiptLines).where(eq(stockReceiptLines.productId, productId)).limit(1);
    return !!received;
  }

  /** Yumshoq o'chirish: kodlar bo'shatiladi, tarixiy cheklar nusxalar bilan saqlanadi. */
  async softDeleteProduct(tx: DbOrTx, id: string) {
    const tag = sql`'#del#' || extract(epoch from now())::bigint`;
    await tx.update(products).set({ deletedAt: new Date(), sku: sql`${products.sku} || ${tag}` }).where(eq(products.id, id));
    await tx.update(productVariants).set({ deletedAt: new Date(), sku: sql`${productVariants.sku} || ${tag}` }).where(and(eq(productVariants.productId, id), isNull(productVariants.deletedAt)));
    await tx.delete(productBarcodes).where(eq(productBarcodes.productId, id));
    await tx.delete(stockLevels).where(eq(stockLevels.productId, id));
  }

  /** Qattiq o'chirish — cascade: variantlar, konversiyalar, kodlar, qoldiq qatorlari. */
  hardDeleteProduct(tx: DbOrTx, id: string) {
    return tx.delete(products).where(eq(products.id, id));
  }

  /* ───────── Filial narxi (TZ 7.3) ───────── */

  findBrief(id: string, tx: DbOrTx = this.db) {
    return tx.select({ id: products.id, name: products.name, isVariable: products.isVariable }).from(products).where(and(eq(products.id, id), isNull(products.deletedAt))).limit(1).then((r) => r[0] ?? null);
  }

  variantExists(productId: string, variantId: string, tx: DbOrTx = this.db) {
    return tx.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.id, variantId), eq(productVariants.productId, productId), isNull(productVariants.deletedAt))).limit(1).then((r) => !!r[0]);
  }

  /** Bitta so'rovda upsert (`branch_prices_target_uq` bo'yicha) — ikki parallel PUT ham 500 bermaydi. */
  upsertBranchPrice(tx: DbOrTx, branchId: string, productId: string, variantId: string | null, row: { retailPrice: number; wholesalePrice: number | null }) {
    // Indeks ifodali (coalesce) conflict target Drizzle builder'da yo'q — xom SQL
    return tx.execute(sql`
      insert into ${branchPrices} (branch_id, product_id, variant_id, retail_price, wholesale_price)
      values (${branchId}, ${productId}, ${variantId}, ${row.retailPrice}, ${row.wholesalePrice})
      on conflict (branch_id, product_id, coalesce(variant_id, ${sql.raw(`'${NIL}'::uuid`)}))
      do update set retail_price = excluded.retail_price, wholesale_price = excluded.wholesale_price`);
  }

  /** O'chirilgan qatorlar soni. */
  deleteBranchPrice(branchId: string, productId: string, variantId: string | null, tx: DbOrTx = this.db) {
    return tx.delete(branchPrices).where(and(eq(branchPrices.branchId, branchId), eq(branchPrices.productId, productId), variantId ? eq(branchPrices.variantId, variantId) : isNull(branchPrices.variantId))).returning({ id: branchPrices.id }).then((r) => r.length);
  }
}

export { NIL };
