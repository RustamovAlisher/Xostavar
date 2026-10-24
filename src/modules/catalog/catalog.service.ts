import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, exists, gt, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DB, type Db, type DbOrTx } from '../../db/db.module.js';
import {
  branchPrices, branches, categories, productBarcodes, productVariants, products, saleLines, stockLevels, stockReceiptLines, unitConversions, units,
} from '../../db/schema/index.js';
import type { AuthUser } from '../../common/auth-context.js';
import { conflict, notFound, unprocessable } from '../../common/errors.js';
import { slug } from '../../common/numbers.js';
import { page, type Page } from '../../common/pagination.js';
import { assertVersion } from '../../common/version.js';
import { AuditService } from '../audit/audit.service.js';
import type { ProductDto, ProductListQuery, VariantDto } from './catalog.dto.js';

/** Frontend `Product` bilan bir xil shakl (TZ 9.4, 14.3). */
export interface ProductView {
  id: string;
  name: string;
  categoryId: string;
  sku: string;
  barcodes: string[];
  description?: string;
  baseUnit: string;
  isDivisible: boolean;
  conversions: { unit: string; factor: number; price?: number; barcode?: string }[];
  retailPrice: number;
  wholesalePrice?: number;
  costPrice?: number;
  stock: number;
  minStock?: number;
  isVariable: boolean;
  variants?: VariantView[];
  /** Joriy filial omborida bormi (stock_levels qatori). */
  inBranch: boolean;
  version: number;
  createdAt: Date;
}
export interface VariantView {
  id: string;
  name: string;
  sku: string;
  barcodes: string[];
  retailPrice: number;
  wholesalePrice?: number;
  costPrice?: number;
  stock: number;
  minStock?: number;
  conversions?: { unit: string; factor: number; price?: number; barcode?: string }[];
}

const NIL = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /* ───────── O'qish (N+1 siz: 6 ta batch so'rov) ───────── */

  /**
   * Berilgan mahsulotlarni to'liq yig'adi: variantlar, konversiyalar, shtrix-kodlar, filial qoldig'i va narxi.
   * Mahsulot soniga bog'liq bo'lmagan doimiy sonli so'rov.
   */
  async assemble(rows: (typeof products.$inferSelect)[], branchId: string | null, withCost: boolean, db: DbOrTx = this.db): Promise<ProductView[]> {
    if (!rows.length) return [];
    const ids = rows.map((p) => p.id);
    const [variants, convs, codes, levels, prices] = await Promise.all([
      db.select().from(productVariants).where(and(inArray(productVariants.productId, ids), isNull(productVariants.deletedAt))).orderBy(asc(productVariants.sortOrder), asc(productVariants.createdAt)),
      db.select().from(unitConversions).where(inArray(unitConversions.productId, ids)),
      db.select().from(productBarcodes).where(inArray(productBarcodes.productId, ids)),
      branchId ? db.select().from(stockLevels).where(and(eq(stockLevels.branchId, branchId), inArray(stockLevels.productId, ids))) : Promise.resolve([]),
      branchId ? db.select().from(branchPrices).where(and(eq(branchPrices.branchId, branchId), inArray(branchPrices.productId, ids))) : Promise.resolve([]),
    ]);
    const key = (p: string, v: string | null) => `${p}|${v ?? ''}`;
    const group = <T extends { productId: string }>(list: T[]) => {
      const m = new Map<string, T[]>();
      for (const x of list) m.set(x.productId, [...(m.get(x.productId) ?? []), x]);
      return m;
    };
    const vByP = group(variants);
    const cByP = group(convs);
    const bByP = group(codes);
    const lvl = new Map(levels.map((l) => [key(l.productId, l.variantId), l]));
    const prc = new Map(prices.map((p) => [key(p.productId, p.variantId), p]));

    const convView = (list: (typeof unitConversions.$inferSelect)[], codesFor: (typeof productBarcodes.$inferSelect)[]) =>
      list.map((c) => {
        const bc = codesFor.find((b) => b.unit === c.unit)?.barcode;
        return { unit: c.unit, factor: c.factor, ...(c.price != null ? { price: c.price } : {}), ...(bc ? { barcode: bc } : {}) };
      });

    return rows.map((p) => {
      const pConvs = (cByP.get(p.id) ?? []).filter((c) => !c.variantId);
      const pCodes = (bByP.get(p.id) ?? []).filter((b) => !b.variantId);
      const l = lvl.get(key(p.id, null));
      const bp = prc.get(key(p.id, null));
      const vs = (vByP.get(p.id) ?? []).map((v): VariantView => {
        const vl = lvl.get(key(p.id, v.id));
        const vp = prc.get(key(p.id, v.id));
        const vConvs = (cByP.get(p.id) ?? []).filter((c) => c.variantId === v.id);
        const vCodes = (bByP.get(p.id) ?? []).filter((b) => b.variantId === v.id);
        return {
          id: v.id, name: v.name, sku: v.sku, barcodes: vCodes.filter((b) => !b.unit).map((b) => b.barcode),
          retailPrice: vp?.retailPrice ?? v.retailPrice,
          ...(withCost ? { wholesalePrice: vp?.wholesalePrice ?? v.wholesalePrice ?? undefined, costPrice: vl?.costPrice != null ? Number(vl.costPrice) : undefined } : {}),
          stock: vl ? Number(vl.stock) : 0, minStock: vl?.minStock != null ? Number(vl.minStock) : undefined,
          conversions: vConvs.length ? convView(vConvs, vCodes) : undefined,
        };
      });
      const inBranch = !!l || vs.some((v) => lvl.has(key(p.id, v.id)));
      return {
        id: p.id, name: p.name, categoryId: p.categoryId, sku: p.sku, barcodes: pCodes.filter((b) => !b.unit).map((b) => b.barcode),
        description: p.description ?? undefined, baseUnit: p.baseUnit, isDivisible: p.isDivisible,
        conversions: convView(pConvs, pCodes), retailPrice: bp?.retailPrice ?? p.retailPrice,
        ...(withCost ? { wholesalePrice: bp?.wholesalePrice ?? p.wholesalePrice ?? undefined, costPrice: l?.costPrice != null ? Number(l.costPrice) : undefined } : {}),
        stock: p.isVariable ? vs.reduce((a, v) => a + v.stock, 0) : l ? Number(l.stock) : 0,
        minStock: l?.minStock != null ? Number(l.minStock) : undefined,
        isVariable: p.isVariable, variants: p.isVariable ? vs : undefined, inBranch, version: p.version, createdAt: p.createdAt,
      };
    });
  }

  async list(user: AuthUser, branchId: string | null, q: ProductListQuery): Promise<Page<ProductView> & { facets: { byCategory: Record<string, number> } }> {
    const where: SQL[] = [isNull(products.deletedAt)];
    if (q.categoryId) where.push(eq(products.categoryId, q.categoryId));
    const inBranch = q.inBranch === 'true' || q.inBranch === '1';
    if (inBranch && branchId) {
      where.push(exists(this.db.select({ x: sql`1` }).from(stockLevels).where(and(eq(stockLevels.branchId, branchId), eq(stockLevels.productId, products.id)))));
    }
    if ((q.lowStock === 'true' || q.lowStock === '1') && branchId) {
      where.push(exists(this.db.select({ x: sql`1` }).from(stockLevels).where(and(eq(stockLevels.branchId, branchId), eq(stockLevels.productId, products.id), gt(stockLevels.minStock, 0), sql`${stockLevels.stock} < ${stockLevels.minStock}`))));
    }
    if (q.q?.trim()) {
      const term = q.q.trim();
      const like = `%${term}%`;
      where.push(
        or(
          ilike(products.name, like),
          ilike(products.sku, like),
          exists(this.db.select({ x: sql`1` }).from(productBarcodes).where(and(eq(productBarcodes.productId, products.id), ilike(productBarcodes.barcode, like)))),
          exists(this.db.select({ x: sql`1` }).from(productVariants).where(and(eq(productVariants.productId, products.id), isNull(productVariants.deletedAt), or(ilike(productVariants.name, like), ilike(productVariants.sku, like))))),
        )!,
      );
    }
    const cond = and(...where);
    const [rows, [{ total }], facets] = await Promise.all([
      this.db.select().from(products).where(cond).orderBy(q.sort === 'name' ? asc(products.name) : desc(products.createdAt)).limit(q.pageSize).offset(q.offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(products).where(cond),
      this.db.select({ categoryId: products.categoryId, n: sql<number>`count(*)::int` }).from(products).where(cond).groupBy(products.categoryId),
    ]);
    const items = await this.assemble(rows, branchId, user.permissions.includes('view_cost_price'));
    return { ...page(items, total, q), facets: { byCategory: Object.fromEntries(facets.map((f) => [f.categoryId, f.n])) } };
  }

  async get(user: AuthUser, branchId: string | null, id: string): Promise<ProductView> {
    const [row] = await this.db.select().from(products).where(and(eq(products.id, id), isNull(products.deletedAt))).limit(1);
    if (!row) throw notFound('Mahsulot');
    const [v] = await this.assemble([row], branchId, user.permissions.includes('view_cost_price'));
    return v;
  }

  /** SKU/shtrix-kod bo'yicha aniq moslik (skaner). Qadoq shtrix-kodi bo'lsa `unit` ham qaytadi (TZ 9.4). */
  async lookup(user: AuthUser, branchId: string | null, code: string) {
    const c = code.trim().toLowerCase();
    if (!c) throw notFound('Mahsulot');
    const [bc] = await this.db.select().from(productBarcodes).where(eq(sql`lower(${productBarcodes.barcode})`, c)).limit(1);
    let productId = bc?.productId;
    let variantId = bc?.variantId ?? null;
    const unit = bc?.unit ?? null;
    if (!productId) {
      const [v] = await this.db.select({ productId: productVariants.productId, id: productVariants.id }).from(productVariants).where(and(eq(sql`lower(${productVariants.sku})`, c), isNull(productVariants.deletedAt))).limit(1);
      if (v) {
        productId = v.productId;
        variantId = v.id;
      } else {
        const [p] = await this.db.select({ id: products.id }).from(products).where(and(eq(sql`lower(${products.sku})`, c), isNull(products.deletedAt))).limit(1);
        productId = p?.id;
      }
    }
    if (!productId) throw notFound('Mahsulot', { code });
    const product = await this.get(user, branchId, productId);
    return { product, variantId, unit };
  }

  /* ───────── Yozish ───────── */

  /** Kodlarning (SKU, shtrix-kod) butun tizimda unikalligi — katta-kichik harfga sezgir emas (TZ 7.3). */
  private async assertCodesFree(tx: DbOrTx, codes: string[], exceptProductId?: string) {
    const list = [...new Set(codes.map((c) => c.trim().toLowerCase()).filter(Boolean))];
    if (list.length !== codes.filter((c) => c.trim()).length) {
      const seen = new Set<string>();
      const dup = codes.map((c) => c.trim().toLowerCase()).find((c) => c && (seen.has(c) ? true : (seen.add(c), false)));
      throw conflict('duplicate_code', `"${dup}" kodi takrorlangan`);
    }
    if (!list.length) return;
    const not = (col: PgColumn) => (exceptProductId ? ne(col, exceptProductId) : undefined);
    const [p, v, b] = await Promise.all([
      tx.select({ code: products.sku, name: products.name }).from(products).where(and(inArray(sql`lower(${products.sku})`, list), not(products.id), isNull(products.deletedAt))),
      tx.select({ code: productVariants.sku, name: productVariants.name }).from(productVariants).where(and(inArray(sql`lower(${productVariants.sku})`, list), not(productVariants.productId), isNull(productVariants.deletedAt))),
      tx.select({ code: productBarcodes.barcode, name: products.name }).from(productBarcodes).innerJoin(products, eq(products.id, productBarcodes.productId)).where(and(inArray(sql`lower(${productBarcodes.barcode})`, list), not(productBarcodes.productId))),
    ]);
    const hit = p[0] ?? v[0] ?? b[0];
    if (hit) throw conflict('duplicate_code', `"${hit.code}" kodi "${hit.name}" mahsulotida bor`, { code: hit.code });
  }

  private async validate(tx: DbOrTx, dto: ProductDto) {
    const err = (m: string) => unprocessable('validation_failed', m);
    const unitIds = new Set((await tx.select({ id: units.id }).from(units)).map((u) => u.id));
    if (!unitIds.has(dto.baseUnit)) throw err(`"${dto.baseUnit}" birligi mavjud emas`);
    const [cat] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, dto.categoryId)).limit(1);
    if (!cat) throw err('Kategoriya topilmadi');
    const checkConvs = (list: { unit: string; factor: number }[] | undefined, who: string) => {
      const seen = new Set<string>();
      for (const c of list ?? []) {
        if (!unitIds.has(c.unit)) throw err(`${who}: "${c.unit}" birligi mavjud emas`);
        if (c.unit === dto.baseUnit) throw err(`${who}: qo'shimcha birlik asosiy birlik bilan bir xil bo'lmasin`);
        if (seen.has(c.unit)) throw err(`${who}: "${c.unit}" birligi ikki marta kiritilgan`);
        if (!(c.factor > 0)) throw err(`${who}: koeffitsient 0 dan katta bo'lsin`);
        seen.add(c.unit);
      }
    };
    checkConvs(dto.conversions, dto.name);
    if (dto.isVariable) {
      if (!dto.variants?.length) throw err("Kamida bitta variant qo'shing");
      for (const v of dto.variants) {
        if (!v.name.trim()) throw err('Variant nomini kiriting');
        checkConvs(v.conversions, v.name);
      }
    }
  }

  /** Bo'sh SKU larga avtomatik, unikal qiymat (TZ 7.3). */
  private async finalizeSkus(tx: DbOrTx, dto: ProductDto, exceptProductId?: string) {
    const taken = new Set<string>();
    const [p, v] = await Promise.all([
      tx.select({ s: products.sku }).from(products).where(exceptProductId ? ne(products.id, exceptProductId) : undefined),
      tx.select({ s: productVariants.sku }).from(productVariants).where(exceptProductId ? ne(productVariants.productId, exceptProductId) : undefined),
    ]);
    for (const r of [...p, ...v]) taken.add(r.s.toLowerCase());
    const claim = (base: string) => {
      let s = base;
      let n = 2;
      while (taken.has(s.toLowerCase())) s = `${base}-${n++}`;
      taken.add(s.toLowerCase());
      return s;
    };
    if (dto.sku?.trim()) taken.add(dto.sku.trim().toLowerCase());
    for (const x of dto.variants ?? []) if (x.sku?.trim()) taken.add(x.sku.trim().toLowerCase());
    const [cat] = await tx.select({ name: categories.name }).from(categories).where(eq(categories.id, dto.categoryId)).limit(1);
    const sku = dto.sku?.trim() || claim(slug(dto.name).split('-').filter(Boolean).slice(0, 2).join('-').slice(0, 12) || slug(cat?.name ?? '') || 'SKU');
    const variants = (dto.variants ?? []).map((x, i) => ({ ...x, sku: x.sku?.trim() || claim(`${sku}-${slug(x.name) || i + 1}`) }));
    return { sku, variants };
  }

  private allCodes(sku: string, dto: ProductDto, variants: VariantDto[]) {
    return [sku, ...(dto.barcodes ?? []), ...dto.conversions.map((c) => c.barcode ?? ''), ...variants.flatMap((v) => [v.sku!, ...(v.barcodes ?? []), ...(v.conversions ?? []).map((c) => c.barcode ?? '')])].filter(Boolean);
  }

  private async writeChildren(tx: DbOrTx, productId: string, dto: ProductDto, variants: VariantDto[], keepVariantIds: Map<number, string>) {
    await Promise.all([tx.delete(unitConversions).where(eq(unitConversions.productId, productId)), tx.delete(productBarcodes).where(eq(productBarcodes.productId, productId))]);
    const convRows: (typeof unitConversions.$inferInsert)[] = dto.conversions.map((c) => ({ productId, variantId: null, unit: c.unit, factor: c.factor, price: c.price ?? null }));
    const codeRows: (typeof productBarcodes.$inferInsert)[] = [
      ...(dto.barcodes ?? []).map((b) => ({ productId, barcode: b.trim() })),
      ...dto.conversions.filter((c) => c.barcode?.trim()).map((c) => ({ productId, unit: c.unit, barcode: c.barcode!.trim() })),
    ];
    for (const [i, v] of variants.entries()) {
      const variantId = keepVariantIds.get(i)!;
      for (const c of v.conversions ?? []) convRows.push({ productId, variantId, unit: c.unit, factor: c.factor, price: c.price ?? null });
      for (const b of v.barcodes ?? []) codeRows.push({ productId, variantId, barcode: b.trim() });
      for (const c of (v.conversions ?? []).filter((c) => c.barcode?.trim())) codeRows.push({ productId, variantId, unit: c.unit, barcode: c.barcode!.trim() });
    }
    if (convRows.length) await tx.insert(unitConversions).values(convRows);
    if (codeRows.length) await tx.insert(productBarcodes).values(codeRows);
  }

  /** Joriy filial uchun min. qoldiq / tannarx (TZ 7.3): faqat mavjud stock_levels qatoriga yoziladi. */
  private async writeLevelFields(tx: DbOrTx, user: AuthUser, branchId: string | null, productId: string, variantId: string | null, dto: { minStock?: number | null; costPrice?: number | null }) {
    if (!branchId || (dto.minStock === undefined && dto.costPrice === undefined)) return;
    const set: Partial<typeof stockLevels.$inferInsert> = {};
    if (dto.minStock !== undefined) set.minStock = dto.minStock != null && dto.minStock > 0 ? dto.minStock : null;
    if (dto.costPrice !== undefined && user.permissions.includes('view_cost_price')) set.costPrice = dto.costPrice != null && dto.costPrice > 0 ? dto.costPrice : null;
    if (!Object.keys(set).length) return;
    await tx.update(stockLevels).set(set).where(and(eq(stockLevels.branchId, branchId), eq(stockLevels.productId, productId), variantId ? eq(stockLevels.variantId, variantId) : isNull(stockLevels.variantId)));
  }

  async create(user: AuthUser, branchId: string | null, dto: ProductDto): Promise<ProductView> {
    const id = await this.db.transaction(async (tx) => {
      await this.validate(tx, dto);
      const { sku, variants } = await this.finalizeSkus(tx, dto);
      await this.assertCodesFree(tx, this.allCodes(sku, dto, variants));
      const [p] = await tx
        .insert(products)
        .values({ name: dto.name.trim(), categoryId: dto.categoryId, sku, description: dto.description?.trim() || null, baseUnit: dto.baseUnit, isDivisible: dto.isDivisible, retailPrice: dto.isVariable ? 0 : (dto.retailPrice ?? 0), wholesalePrice: dto.isVariable ? null : (dto.wholesalePrice ?? null), isVariable: dto.isVariable })
        .returning({ id: products.id });
      const ids = new Map<number, string>();
      if (dto.isVariable) {
        const rows = await tx.insert(productVariants).values(variants.map((v, i) => ({ productId: p.id, name: v.name.trim(), sku: v.sku!, retailPrice: v.retailPrice, wholesalePrice: v.wholesalePrice ?? null, sortOrder: i }))).returning({ id: productVariants.id });
        rows.forEach((r, i) => ids.set(i, r.id));
      }
      await this.writeChildren(tx, p.id, dto, dto.isVariable ? variants : [], ids);
      await this.audit.log(user, { action: 'add', module: 'Mahsulotlar', targetId: p.id, targetName: dto.name.trim(), details: `Yangi mahsulot (SKU: ${sku})`, diff: { after: this.summary(dto, sku) } }, tx);
      return p.id;
    });
    return this.get(user, branchId, id);
  }

  async update(user: AuthUser, branchId: string | null, id: string, dto: ProductDto): Promise<ProductView> {
    await this.db.transaction(async (tx) => {
      const [old] = await tx.select().from(products).where(and(eq(products.id, id), isNull(products.deletedAt))).limit(1).for('update');
      if (!old) throw notFound('Mahsulot');
      assertVersion(old.version, dto.version, 'Mahsulot');
      await this.validate(tx, dto);
      const { sku, variants } = await this.finalizeSkus(tx, dto, id);
      await this.assertCodesFree(tx, this.allCodes(sku, dto, variants), id);

      // Variantlar: id bo'yicha yangilash; olib tashlanganlari — biror filialda qoldig'i bo'lsa 409, aks holda yumshoq o'chirish
      const existing = await tx.select().from(productVariants).where(and(eq(productVariants.productId, id), isNull(productVariants.deletedAt)));
      const keep = new Set(dto.isVariable ? variants.map((v) => v.id).filter(Boolean) : []);
      const removed = existing.filter((v) => !keep.has(v.id));
      if (removed.length) {
        const stocked = await tx
          .select({ variantId: stockLevels.variantId, stock: stockLevels.stock, branch: branches.name })
          .from(stockLevels)
          .innerJoin(branches, eq(branches.id, stockLevels.branchId))
          .where(and(inArray(stockLevels.variantId, removed.map((v) => v.id)), gt(stockLevels.stock, 0)));
        if (stocked.length) {
          const v = removed.find((x) => x.id === stocked[0].variantId)!;
          throw conflict('in_use', `"${v.name}" variantining ${stocked[0].branch} omborida qoldig'i bor (${Number(stocked[0].stock)}) — avval qoldiqni 0 ga keltiring`, { variantId: v.id });
        }
        await tx.update(productVariants).set({ deletedAt: new Date(), sku: sql`${productVariants.sku} || '#del#' || extract(epoch from now())::bigint` }).where(inArray(productVariants.id, removed.map((v) => v.id)));
        await tx.delete(stockLevels).where(inArray(stockLevels.variantId, removed.map((v) => v.id)));
      }
      const ids = new Map<number, string>();
      if (dto.isVariable) {
        for (const [i, v] of variants.entries()) {
          if (v.id && existing.some((e) => e.id === v.id)) {
            await tx.update(productVariants).set({ name: v.name.trim(), sku: v.sku!, retailPrice: v.retailPrice, wholesalePrice: v.wholesalePrice ?? null, sortOrder: i }).where(eq(productVariants.id, v.id));
            ids.set(i, v.id);
          } else {
            const [r] = await tx.insert(productVariants).values({ productId: id, name: v.name.trim(), sku: v.sku!, retailPrice: v.retailPrice, wholesalePrice: v.wholesalePrice ?? null, sortOrder: i }).returning({ id: productVariants.id });
            ids.set(i, r.id);
          }
        }
      }
      await tx
        .update(products)
        .set({ name: dto.name.trim(), categoryId: dto.categoryId, sku, description: dto.description?.trim() || null, baseUnit: dto.baseUnit, isDivisible: dto.isDivisible, retailPrice: dto.isVariable ? 0 : (dto.retailPrice ?? 0), wholesalePrice: dto.isVariable ? null : (dto.wholesalePrice ?? null), isVariable: dto.isVariable, version: old.version + 1 })
        .where(eq(products.id, id));
      await this.writeChildren(tx, id, dto, dto.isVariable ? variants : [], ids);
      if (!dto.isVariable) await this.writeLevelFields(tx, user, branchId, id, null, dto);
      await this.audit.log(user, { action: 'edit', module: 'Mahsulotlar', targetId: id, targetName: dto.name.trim(), details: 'Mahsulot tahrirlandi', diff: { before: this.summary({ ...old, conversions: [], variants: [] } as unknown as ProductDto, old.sku), after: this.summary(dto, sku) } }, tx);
    });
    return this.get(user, branchId, id);
  }

  /** TZ 8.11: tarixi bor mahsulot yumshoq o'chiriladi; qoldig'i bo'lsa o'chirilmaydi. */
  async remove(user: AuthUser, id: string) {
    await this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(products).where(and(eq(products.id, id), isNull(products.deletedAt))).limit(1).for('update');
      if (!p) throw notFound('Mahsulot');
      const [stocked] = await tx.select({ branch: branches.name, stock: stockLevels.stock }).from(stockLevels).innerJoin(branches, eq(branches.id, stockLevels.branchId)).where(and(eq(stockLevels.productId, id), gt(stockLevels.stock, 0))).limit(1);
      if (stocked) throw conflict('in_use', `${stocked.branch} omborida qoldig'i bor (${Number(stocked.stock)}) — avval qoldiqni 0 ga keltiring`);
      const [sold] = await tx.select({ id: saleLines.id }).from(saleLines).where(eq(saleLines.productId, id)).limit(1);
      const [received] = sold ? [sold] : await tx.select({ id: stockReceiptLines.id }).from(stockReceiptLines).where(eq(stockReceiptLines.productId, id)).limit(1);
      if (sold || received) {
        // Kodlar bo'shatiladi, tarixiy cheklar nusxalar bilan saqlanadi
        const tag = sql`'#del#' || extract(epoch from now())::bigint`;
        await tx.update(products).set({ deletedAt: new Date(), sku: sql`${products.sku} || ${tag}` }).where(eq(products.id, id));
        await tx.update(productVariants).set({ deletedAt: new Date(), sku: sql`${productVariants.sku} || ${tag}` }).where(and(eq(productVariants.productId, id), isNull(productVariants.deletedAt)));
        await tx.delete(productBarcodes).where(eq(productBarcodes.productId, id));
        await tx.delete(stockLevels).where(eq(stockLevels.productId, id));
      } else {
        await tx.delete(products).where(eq(products.id, id)); // cascade: variantlar, konversiyalar, kodlar, qoldiq qatorlari
      }
      await this.audit.log(user, { action: 'delete', module: 'Mahsulotlar', targetId: id, targetName: p.name, details: `O'chirildi (SKU: ${p.sku})` }, tx);
    });
  }

  private summary(dto: ProductDto, sku: string) {
    return {
      nomi: dto.name, sku, kategoriya: dto.categoryId, asosiyBirlik: dto.baseUnit,
      narx: dto.isVariable ? undefined : dto.retailPrice,
      birliklar: (dto.conversions ?? []).map((c) => `${c.unit}=${c.factor}${c.price ? ` (${c.price})` : ''}`).join(', '),
      variantlar: dto.variants?.map((v) => `${v.name}: ${v.retailPrice}`).join('; '),
    };
  }
}

export { NIL };
