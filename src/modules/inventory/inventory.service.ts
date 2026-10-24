import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../db/db.module.js';
import { runTx } from '../../db/tx.js';
import { auditLogs, branches, productVariants, products, stockLevels, stockMovements, stockReceiptLines, stockReceipts, suppliers, unitConversions, units } from '../../db/schema/index.js';
import type { AuthUser } from '../../common/auth-context.js';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors.js';
import { qty4, todayISO } from '../../common/numbers.js';
import { page } from '../../common/pagination.js';
import { averageCost, factorOf, type PriceTarget } from '../../common/pricing.js';
import { AuditService } from '../audit/audit.service.js';
import type { StockAdjustDto, StockInDto, StockInListQuery, StockLevelPatchDto } from './inventory.dto.js';

export interface LockedLevel {
  id: string;
  stock: number;
  costPrice: number | null;
  minStock: number | null;
}

/**
 * Ombor: qoldiq filial bo'yicha, har o'zgarish `stock_movements` ga (TZ 7.4, 8.5, 8.6).
 * Qoldiq qatorlari tranzaksiya ichida `FOR UPDATE` bilan qulflanadi — tartiblangan kalitlar bo'yicha, deadlock bo'lmasin.
 */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /* ───────── Qulflash ───────── */

  /**
   * (product, variant) kalitlari bo'yicha qoldiq qatorlarini qulflaydi; yo'q bo'lsa `create=true` da yaratadi
   * (kirim), aks holda null (sotuvda omborda bo'lmagan mahsulot → not_in_branch).
   */
  async lockLevels(tx: DbOrTx, branchId: string, keys: { productId: string; variantId: string | null }[], create: boolean): Promise<Map<string, LockedLevel | null>> {
    const sorted = [...new Map(keys.map((k) => [`${k.productId}|${k.variantId ?? ''}`, k])).values()].sort((a, b) => `${a.productId}|${a.variantId ?? ''}`.localeCompare(`${b.productId}|${b.variantId ?? ''}`));
    const out = new Map<string, LockedLevel | null>();
    for (const k of sorted) {
      const key = `${k.productId}|${k.variantId ?? ''}`;
      const where = and(eq(stockLevels.branchId, branchId), eq(stockLevels.productId, k.productId), k.variantId ? eq(stockLevels.variantId, k.variantId) : isNull(stockLevels.variantId));
      let [row] = await tx.select({ id: stockLevels.id, stock: stockLevels.stock, costPrice: stockLevels.costPrice, minStock: stockLevels.minStock }).from(stockLevels).where(where).for('update');
      if (!row && create) {
        await tx.insert(stockLevels).values({ branchId, productId: k.productId, variantId: k.variantId, stock: 0 }).onConflictDoNothing();
        [row] = await tx.select({ id: stockLevels.id, stock: stockLevels.stock, costPrice: stockLevels.costPrice, minStock: stockLevels.minStock }).from(stockLevels).where(where).for('update');
      }
      out.set(key, row ? { id: row.id, stock: Number(row.stock), costPrice: row.costPrice != null ? Number(row.costPrice) : null, minStock: row.minStock != null ? Number(row.minStock) : null } : null);
    }
    return out;
  }

  /** Qoldiqni o'zgartirib, jurnalga yozadi. Qaytaradi: yangi qoldiq. */
  async applyMovement(
    tx: DbOrTx,
    lvl: LockedLevel,
    m: { branchId: string; productId: string; variantId: string | null; type: typeof stockMovements.$inferInsert.type; qtyBase: number; unit: string; qtyUnit: number; costPerBase?: number | null; refType?: string; refId?: string; userId: string; newCost?: number | null },
  ) {
    // Qoldiq atomar yangilanadi (stock = stock + delta); qulf bilan birga ikki qavat himoya
    const delta = qty4(m.qtyBase);
    const [upd] = await tx
      .update(stockLevels)
      .set({ stock: sql`round(${stockLevels.stock} + ${delta}, 4)`, ...(m.newCost !== undefined ? { costPrice: m.newCost } : {}), version: sql`${stockLevels.version} + 1` })
      .where(eq(stockLevels.id, lvl.id))
      .returning({ stock: stockLevels.stock });
    const after = upd.stock;
    await tx.insert(stockMovements).values({ branchId: m.branchId, productId: m.productId, variantId: m.variantId, type: m.type, qtyBase: delta, unit: m.unit, qtyUnit: m.qtyUnit, costPerBase: m.costPerBase ?? null, refType: m.refType ?? null, refId: m.refId ?? null, balanceAfter: after, userId: m.userId });
    lvl.stock = after;
    if (m.newCost !== undefined) lvl.costPrice = m.newCost ?? null;
    return after;
  }

  /** Narx/birlik hisobi uchun mahsulot va variantni (konversiyalari bilan) oladi — batch. */
  async loadTargets(tx: DbOrTx, keys: { productId: string; variantId: string | null }[]) {
    const pids = [...new Set(keys.map((k) => k.productId))];
    if (!pids.length) return new Map<string, { product: typeof products.$inferSelect; variant: typeof productVariants.$inferSelect | null; target: PriceTarget }>();
    const [ps, vs, cs] = await Promise.all([
      tx.select().from(products).where(and(inArray(products.id, pids), isNull(products.deletedAt))),
      tx.select().from(productVariants).where(and(inArray(productVariants.productId, pids), isNull(productVariants.deletedAt))),
      tx.select().from(unitConversions).where(inArray(unitConversions.productId, pids)),
    ]);
    const out = new Map<string, { product: typeof products.$inferSelect; variant: typeof productVariants.$inferSelect | null; target: PriceTarget }>();
    for (const k of keys) {
      const product = ps.find((p) => p.id === k.productId);
      if (!product) continue;
      const variant = k.variantId ? (vs.find((v) => v.id === k.variantId && v.productId === product.id) ?? null) : null;
      if (k.variantId && !variant) continue;
      const conv = (vid: string | null) => cs.filter((c) => c.productId === product.id && (vid ? c.variantId === vid : !c.variantId)).map((c) => ({ unit: c.unit, factor: c.factor, price: c.price }));
      out.set(`${k.productId}|${k.variantId ?? ''}`, {
        product, variant,
        target: { baseUnit: product.baseUnit, isDivisible: product.isDivisible, retailPrice: variant ? variant.retailPrice : product.retailPrice, conversions: conv(null), variantConversions: variant ? conv(variant.id) : undefined },
      });
    }
    return out;
  }

  /* ───────── Kirim (TZ 8.6, 9.5) ───────── */

  async stockIn(user: AuthUser, branchId: string, dto: StockInDto, requestId?: string) {
    const canPrice = user.permissions.includes('edit_product');
    const receiptId = await runTx(this.db, async (tx) => {
      // Filial qatori qulfi: kirim raqami filial bo'yicha ketma-ket
      const [b] = await tx.select({ id: branches.id, name: branches.name, active: branches.active }).from(branches).where(eq(branches.id, branchId)).for('update');
      if (!b?.active) throw forbidden('Filial nofaol', 'branch_inactive');
      const keys = dto.lines.map((l) => ({ productId: l.productId, variantId: l.variantId ?? null }));
      const targets = await this.loadTargets(tx, keys);
      const unitRows = await tx.select().from(units);
      const unitById = new Map(unitRows.map((u) => [u.id, u]));
      // Qatorlarni hisoblash (qulfdan oldin — yaroqsiz so'rov qulf ushlab turmasin)
      const calc = dto.lines.map((l) => {
        const t = targets.get(`${l.productId}|${l.variantId ?? ''}`);
        if (!t) throw notFound('Mahsulot', { productId: l.productId, variantId: l.variantId });
        if (t.product.isVariable && !t.variant) throw unprocessable('validation_failed', `"${t.product.name}": variantni tanlang`);
        const factor = factorOf(t.target, l.unit);
        if (!factor || !unitById.has(l.unit)) throw unprocessable('unit_not_allowed', `"${l.unit}" birligi "${t.product.name}" uchun belgilanmagan`);
        const qty = qty4(l.qty);
        const qtyBase = qty4(qty * factor);
        const costPerUnit = Math.max(0, Math.round(l.costPerUnit ?? 0));
        const costPerBase = costPerUnit / factor;
        return { l, t, factor, qty, qtyBase, costPerUnit, costPerBase, totalCost: Math.round(qty * costPerUnit) };
      });
      const levels = await this.lockLevels(tx, branchId, keys, true);
      const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${stockReceipts.number}), 0)::int + 1` }).from(stockReceipts).where(eq(stockReceipts.branchId, branchId));
      let supplierName = dto.supplierName?.trim() || null;
      if (dto.supplierId) {
        const [s] = await tx.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, dto.supplierId)).limit(1);
        if (!s) throw notFound('Yetkazib beruvchi');
        supplierName = s.name;
      }
      const [r] = await tx
        .insert(stockReceipts)
        .values({ branchId, number: next, supplierId: dto.supplierId ?? null, supplierName, invoice: dto.invoice?.trim() || null, date: dto.date ?? todayISO(), userId: user.id, userName: user.name, note: dto.note?.trim() || null, totalCost: calc.reduce((a, c) => a + c.totalCost, 0) })
        .returning({ id: stockReceipts.id, number: stockReceipts.number });
      const names: string[] = [];
      for (const c of calc) {
        const key = `${c.l.productId}|${c.l.variantId ?? ''}`;
        const lvl = levels.get(key)!;
        const newCost = averageCost(lvl.stock, lvl.costPrice, c.qtyBase, c.costPerBase);
        await this.applyMovement(tx, lvl, { branchId, productId: c.l.productId, variantId: c.l.variantId ?? null, type: 'stock_in', qtyBase: c.qtyBase, unit: c.l.unit, qtyUnit: c.qty, costPerBase: c.costPerBase, refType: 'stock_receipt', refId: r.id, userId: user.id, newCost });
        const name = c.t.variant ? `${c.t.product.name} — ${c.t.variant.name}` : c.t.product.name;
        names.push(name);
        await tx.insert(stockReceiptLines).values({ receiptId: r.id, productId: c.l.productId, variantId: c.l.variantId ?? null, productName: name, sku: c.t.variant?.sku ?? c.t.product.sku, unit: c.l.unit, qty: c.qty, qtyBase: c.qtyBase, costPerUnit: c.costPerUnit, costPerBase: qty4(c.costPerBase), totalCost: c.totalCost });
        if (c.l.newRetailPrice != null && canPrice && c.l.newRetailPrice > 0) {
          if (c.t.variant) await tx.update(productVariants).set({ retailPrice: c.l.newRetailPrice }).where(eq(productVariants.id, c.t.variant.id));
          else await tx.update(products).set({ retailPrice: c.l.newRetailPrice }).where(eq(products.id, c.t.product.id));
        }
        await this.audit.log(user, {
          action: 'stock_in', module: 'Mahsulotlar', targetId: c.l.productId, targetName: name, branchId, requestId,
          details: `Kirim №${r.number} (${b.name}): +${c.qty} ${unitById.get(c.l.unit)?.short ?? c.l.unit}, tannarx ${c.costPerUnit.toLocaleString('ru-RU')} so'm/${unitById.get(c.l.unit)?.short ?? c.l.unit}${supplierName ? ` (${supplierName})` : ''}${dto.invoice ? `, hujjat ${dto.invoice}` : ''}`,
        }, tx);
      }
      return r.id;
    });
    return this.getReceipt(receiptId);
  }

  async getReceipt(id: string) {
    const [r] = await this.db.select().from(stockReceipts).where(eq(stockReceipts.id, id)).limit(1);
    if (!r) throw notFound('Kirim hujjati');
    const lines = await this.db.select().from(stockReceiptLines).where(eq(stockReceiptLines.receiptId, id));
    return { ...r, lines };
  }

  /** Kirimlar ro'yxati qatorlari bilan — 3 ta so'rov (hujjatlar, jami, barcha qatorlar inArray). */
  async listReceipts(branchId: string, q: StockInListQuery) {
    const where = and(
      eq(stockReceipts.branchId, branchId),
      q.from ? gte(stockReceipts.date, q.from) : undefined,
      q.to ? lte(stockReceipts.date, q.to) : undefined,
      q.productId ? sql`exists (select 1 from ${stockReceiptLines} where ${stockReceiptLines.receiptId} = ${stockReceipts.id} and ${stockReceiptLines.productId} = ${q.productId})` : undefined,
    );
    const [items, [{ total }]] = await Promise.all([
      this.db.select().from(stockReceipts).where(where).orderBy(desc(stockReceipts.createdAt)).limit(q.pageSize).offset(q.offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(stockReceipts).where(where),
    ]);
    const lines = items.length ? await this.db.select().from(stockReceiptLines).where(inArray(stockReceiptLines.receiptId, items.map((i) => i.id))) : [];
    return page(items.map((r) => ({ ...r, lines: lines.filter((l) => l.receiptId === r.id) })), total, q);
  }

  async movements(branchId: string, productId: string, variantId: string | undefined, q: { page: number; pageSize: number; offset: number }) {
    const where = and(eq(stockMovements.branchId, branchId), eq(stockMovements.productId, productId), variantId ? eq(stockMovements.variantId, variantId) : undefined);
    const [items, [{ total }]] = await Promise.all([
      this.db.select().from(stockMovements).where(where).orderBy(desc(stockMovements.seq)).limit(q.pageSize).offset(q.offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(stockMovements).where(where),
    ]);
    return page(items, total, q);
  }

  /** Bir mahsulotning barcha filiallardagi qoldig'i (TZ 9.5 `branchId=all`). */
  async levelsAcrossBranches(user: AuthUser, productId: string) {
    const rows = await this.db
      .select({ branchId: stockLevels.branchId, branch: branches.name, variantId: stockLevels.variantId, stock: stockLevels.stock, minStock: stockLevels.minStock, costPrice: stockLevels.costPrice, id: stockLevels.id })
      .from(stockLevels)
      .innerJoin(branches, eq(branches.id, stockLevels.branchId))
      .where(and(eq(stockLevels.productId, productId), user.allBranches ? undefined : inArray(stockLevels.branchId, user.branchIds.length ? user.branchIds : ['00000000-0000-0000-0000-000000000000'])))
      .orderBy(asc(branches.createdAt));
    const withCost = user.permissions.includes('view_cost_price');
    return rows.map((r) => ({ ...r, stock: Number(r.stock), minStock: r.minStock != null ? Number(r.minStock) : null, costPrice: withCost && r.costPrice != null ? Number(r.costPrice) : undefined }));
  }

  /** Inventarizatsiya / qo'lda tuzatish (TZ 9.5). */
  async adjust(user: AuthUser, branchId: string, dto: StockAdjustDto, requestId?: string) {
    return runTx(this.db, async (tx) => {
      await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, branchId)).for('update');
      const t = (await this.loadTargets(tx, [{ productId: dto.productId, variantId: dto.variantId ?? null }])).get(`${dto.productId}|${dto.variantId ?? ''}`);
      if (!t) throw notFound('Mahsulot');
      if (t.product.isVariable && !t.variant) throw unprocessable('validation_failed', 'Variantni tanlang');
      const lvl = (await this.lockLevels(tx, branchId, [{ productId: dto.productId, variantId: dto.variantId ?? null }], true)).get(`${dto.productId}|${dto.variantId ?? ''}`)!;
      const target = dto.newStock != null ? qty4(dto.newStock) : qty4(lvl.stock + (dto.delta ?? 0));
      if (target < 0) throw unprocessable('insufficient_stock', "Qoldiq manfiy bo'lmasin");
      const delta = qty4(target - lvl.stock);
      const before = lvl.stock;
      const after = delta !== 0 ? await this.applyMovement(tx, lvl, { branchId, productId: dto.productId, variantId: dto.variantId ?? null, type: 'adjustment', qtyBase: delta, unit: t.product.baseUnit, qtyUnit: delta, refType: 'adjustment', userId: user.id }) : lvl.stock;
      const name = t.variant ? `${t.product.name} — ${t.variant.name}` : t.product.name;
      await this.audit.log(user, { action: 'stock_adjust', module: 'Mahsulotlar', targetId: dto.productId, targetName: name, branchId, requestId, details: `Qoldiq tuzatildi: ${before} → ${after} ${t.product.baseUnit}. Sabab: ${dto.reason.trim()}`, diff: { before: { qoldiq: before }, after: { qoldiq: after } } }, tx);
      return { stock: after, delta };
    });
  }

  /** Joriy filialda min. qoldiq / tannarx (TZ 9.5 PATCH /stock-levels/:id). */
  async patchLevel(user: AuthUser, branchId: string, id: string, dto: StockLevelPatchDto) {
    const [lvl] = await this.db.select().from(stockLevels).where(and(eq(stockLevels.id, id), eq(stockLevels.branchId, branchId))).limit(1);
    if (!lvl) throw notFound('Ombor qatori');
    if (dto.costPrice !== undefined && !user.permissions.includes('view_cost_price')) throw forbidden("Tannarxni o'zgartirish huquqi yo'q");
    const set: Partial<typeof stockLevels.$inferInsert> = {};
    if (dto.minStock !== undefined) set.minStock = dto.minStock != null && dto.minStock > 0 ? dto.minStock : null;
    if (dto.costPrice !== undefined) set.costPrice = dto.costPrice != null && dto.costPrice > 0 ? dto.costPrice : null;
    if (!Object.keys(set).length) throw conflict('validation_failed', "O'zgartiriladigan maydon yo'q");
    const [row] = await this.db.update(stockLevels).set({ ...set, version: sql`${stockLevels.version} + 1` }).where(eq(stockLevels.id, id)).returning();
    const [p] = await this.db.select({ name: products.name }).from(products).where(eq(products.id, lvl.productId)).limit(1);
    await this.audit.log(user, { action: 'edit', module: 'Mahsulotlar', targetId: lvl.productId, targetName: p?.name ?? lvl.productId, branchId, details: `Ombor sozlamasi: ${dto.minStock !== undefined ? `min. qoldiq ${dto.minStock ?? '—'}` : ''}${dto.costPrice !== undefined ? ` tannarx ${dto.costPrice ?? '—'}` : ''}`.trim() });
    return { ...row, stock: Number(row.stock), minStock: row.minStock != null ? Number(row.minStock) : null, costPrice: row.costPrice != null ? Number(row.costPrice) : null };
  }

  /** Mahsulot tarixi: kirim qatorlari + audit (TZ 9.4). Filial admini faqat o'z filialini ko'radi. */
  async productHistory(user: AuthUser, branchId: string | null, productId: string) {
    const scope = user.allBranches ? null : branchId;
    const [receipts, logs] = await Promise.all([
      this.db
        .select({ line: stockReceiptLines, receipt: stockReceipts })
        .from(stockReceiptLines)
        .innerJoin(stockReceipts, eq(stockReceipts.id, stockReceiptLines.receiptId))
        .where(and(eq(stockReceiptLines.productId, productId), scope ? eq(stockReceipts.branchId, scope) : undefined))
        .orderBy(desc(stockReceipts.createdAt))
        .limit(200),
      this.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.targetId, productId), scope ? eq(auditLogs.branchId, scope) : undefined))
        .orderBy(desc(auditLogs.ts))
        .limit(200),
    ]);
    const withCost = user.permissions.includes('view_cost_price');
    return {
      receipts: receipts.map(({ line, receipt }) => ({
        id: line.id, receiptId: receipt.id, number: receipt.number, branchId: receipt.branchId, date: receipt.date, createdAt: receipt.createdAt,
        productName: line.productName, sku: line.sku, variantId: line.variantId, unit: line.unit, qty: Number(line.qty), qtyBase: Number(line.qtyBase),
        costPerUnit: withCost ? Number(line.costPerUnit) : undefined, totalCost: withCost ? Number(line.totalCost) : undefined,
        supplier: receipt.supplierName, invoice: receipt.invoice, userName: receipt.userName,
      })),
      logs,
    };
  }
}
