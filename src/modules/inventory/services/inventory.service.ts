import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { conflict, forbidden, notFound, unprocessable } from '../../../common/errors/app-error.js';
import { qty4, todayISO } from '../../../common/utils/numbers.js';
import { page } from '../../../common/utils/pagination.js';
import { averageCost, factorOf } from '../../../common/utils/pricing.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { StockAdjustDto, StockInDto, StockInListQuery, StockLevelPatchDto } from '../dto/inventory.dto.js';
import { displayName, levelKey, toLevelView, toLevelsAcrossBranches, toLockedLevel, toProductHistory, toReceiptList, toReceiptView, toTargets, type LockedLevel, type Target } from '../mappers/inventory.mapper.js';
import { InventoryRepository, type LevelKey, type MovementType } from '../repositories/inventory.repository.js';

export type { LockedLevel, Target } from '../mappers/inventory.mapper.js';

/**
 * Ombor: qoldiq filial bo'yicha, har o'zgarish `stock_movements` ga (TZ 7.4, 8.5, 8.6).
 * Qoldiq qatorlari tranzaksiya ichida `FOR UPDATE` bilan qulflanadi — tartiblangan kalitlar bo'yicha, deadlock bo'lmasin.
 */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: InventoryRepository,
    private readonly audit: AuditService,
  ) {}

  /* ───────── Qulflash ───────── */

  /**
   * (product, variant) kalitlari bo'yicha qoldiq qatorlarini qulflaydi; yo'q bo'lsa `create=true` da yaratadi
   * (kirim), aks holda null (sotuvda omborda bo'lmagan mahsulot → not_in_branch).
   */
  async lockLevels(tx: DbOrTx, branchId: string, keys: LevelKey[], create: boolean): Promise<Map<string, LockedLevel | null>> {
    const sorted = [...new Map(keys.map((k) => [levelKey(k), k])).values()].sort((a, b) => levelKey(a).localeCompare(levelKey(b)));
    const out = new Map<string, LockedLevel | null>();
    for (const k of sorted) {
      let row = await this.repo.lockLevel(tx, branchId, k);
      if (!row && create) {
        await this.repo.insertLevelIfMissing(tx, branchId, k);
        row = await this.repo.lockLevel(tx, branchId, k);
      }
      out.set(levelKey(k), row ? toLockedLevel(row) : null);
    }
    return out;
  }

  /** Qoldiqni o'zgartirib, jurnalga yozadi. Qaytaradi: yangi qoldiq. */
  async applyMovement(
    tx: DbOrTx,
    lvl: LockedLevel,
    m: { branchId: string; productId: string; variantId: string | null; type: MovementType; qtyBase: number; unit: string; qtyUnit: number; costPerBase?: number | null; refType?: string; refId?: string; userId: string; newCost?: number | null },
  ) {
    // Qoldiq atomar yangilanadi (stock = stock + delta); qulf bilan birga ikki qavat himoya
    const delta = qty4(m.qtyBase);
    const after = await this.repo.incrementStock(tx, lvl.id, delta, m.newCost);
    await this.repo.insertMovement(tx, { branchId: m.branchId, productId: m.productId, variantId: m.variantId, type: m.type, qtyBase: delta, unit: m.unit, qtyUnit: m.qtyUnit, costPerBase: m.costPerBase ?? null, refType: m.refType ?? null, refId: m.refId ?? null, balanceAfter: after, userId: m.userId });
    lvl.stock = after;
    if (m.newCost !== undefined) lvl.costPrice = m.newCost ?? null;
    return after;
  }

  /** Narx/birlik hisobi uchun mahsulot va variantni (konversiyalari bilan) oladi — batch. */
  async loadTargets(tx: DbOrTx, keys: LevelKey[]): Promise<Map<string, Target>> {
    const pids = [...new Set(keys.map((k) => k.productId))];
    if (!pids.length) return new Map<string, Target>();
    const [ps, vs, cs] = await this.repo.targetRows(tx, pids);
    return toTargets(keys, ps, vs, cs);
  }

  /* ───────── Kirim (TZ 8.6, 9.5) ───────── */

  async stockIn(user: AuthUser, branchId: string, dto: StockInDto, requestId?: string) {
    const canPrice = user.permissions.includes('edit_product');
    const receiptId = await runTx(this.db, async (tx) => {
      // Filial qatori qulfi: kirim raqami filial bo'yicha ketma-ket
      const b = await this.repo.lockBranch(tx, branchId);
      if (!b?.active) throw forbidden('Filial nofaol', 'branch_inactive');
      const keys = dto.lines.map((l) => ({ productId: l.productId, variantId: l.variantId ?? null }));
      const targets = await this.loadTargets(tx, keys);
      const unitRows = await this.repo.allUnits(tx);
      const unitById = new Map(unitRows.map((u) => [u.id, u]));
      // Qatorlarni hisoblash (qulfdan oldin — yaroqsiz so'rov qulf ushlab turmasin)
      const calc = dto.lines.map((l) => {
        const t = targets.get(levelKey(l));
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
      const next = await this.repo.nextReceiptNumber(tx, branchId);
      let supplierName = dto.supplierName?.trim() || null;
      if (dto.supplierId) {
        const name = await this.repo.supplierName(dto.supplierId, tx);
        if (!name) throw notFound('Yetkazib beruvchi');
        supplierName = name;
      }
      const r = await this.repo.insertReceipt(tx, { branchId, number: next, supplierId: dto.supplierId ?? null, supplierName, invoice: dto.invoice?.trim() || null, date: dto.date ?? todayISO(), userId: user.id, userName: user.name, note: dto.note?.trim() || null, totalCost: calc.reduce((a, c) => a + c.totalCost, 0) });
      for (const c of calc) {
        const lvl = levels.get(levelKey(c.l))!;
        const newCost = averageCost(lvl.stock, lvl.costPrice, c.qtyBase, c.costPerBase);
        await this.applyMovement(tx, lvl, { branchId, productId: c.l.productId, variantId: c.l.variantId ?? null, type: 'stock_in', qtyBase: c.qtyBase, unit: c.l.unit, qtyUnit: c.qty, costPerBase: c.costPerBase, refType: 'stock_receipt', refId: r.id, userId: user.id, newCost });
        const name = displayName(c.t.product, c.t.variant);
        await this.repo.insertReceiptLine(tx, { receiptId: r.id, productId: c.l.productId, variantId: c.l.variantId ?? null, productName: name, sku: c.t.variant?.sku ?? c.t.product.sku, unit: c.l.unit, qty: c.qty, qtyBase: c.qtyBase, costPerUnit: c.costPerUnit, costPerBase: qty4(c.costPerBase), totalCost: c.totalCost });
        if (c.l.newRetailPrice != null && canPrice && c.l.newRetailPrice > 0) {
          if (c.t.variant) await this.repo.setVariantRetailPrice(tx, c.t.variant.id, c.l.newRetailPrice);
          else await this.repo.setProductRetailPrice(tx, c.t.product.id, c.l.newRetailPrice);
        }
        const short = unitById.get(c.l.unit)?.short ?? c.l.unit;
        await this.audit.log(user, {
          action: 'stock_in', module: 'Mahsulotlar', targetId: c.l.productId, targetName: name, branchId, requestId,
          details: `Kirim №${r.number} (${b.name}): +${c.qty} ${short}, tannarx ${c.costPerUnit.toLocaleString('ru-RU')} so'm/${short}${supplierName ? ` (${supplierName})` : ''}${dto.invoice ? `, hujjat ${dto.invoice}` : ''}`,
        }, tx);
      }
      return r.id;
    });
    return this.getReceipt(receiptId);
  }

  async getReceipt(id: string, user?: AuthUser) {
    const r = await this.repo.findReceipt(id);
    if (!r) throw notFound('Kirim hujjati');
    // Filialga biriktirilgan xodim faqat o'z filiali hujjatini ko'radi (id bilan ham)
    if (user && !user.allBranches && !user.branchIds.includes(r.branchId)) throw forbidden("Bu filialga kirish huquqingiz yo'q", 'branch_forbidden');
    return toReceiptView(r, await this.repo.receiptLines(id));
  }

  /** Kirimlar ro'yxati qatorlari bilan — 3 ta so'rov (hujjatlar, jami, barcha qatorlar inArray). */
  async listReceipts(branchId: string, q: StockInListQuery) {
    const [items, total] = await this.repo.listReceipts(branchId, q);
    const lines = await this.repo.receiptLinesOf(items.map((i) => i.id));
    return page(toReceiptList(items, lines), total, q);
  }

  async movements(branchId: string, productId: string, variantId: string | undefined, q: { page: number; pageSize: number; offset: number }) {
    const [items, total] = await this.repo.listMovements(branchId, productId, variantId, q);
    return page(items, total, q);
  }

  /** Bir mahsulotning barcha filiallardagi qoldig'i (TZ 9.5 `branchId=all`). */
  async levelsAcrossBranches(user: AuthUser, productId: string) {
    const rows = await this.repo.levelsOfProduct(productId, user.allBranches ? null : user.branchIds);
    return toLevelsAcrossBranches(rows, user.permissions.includes('view_cost_price'));
  }

  /** Inventarizatsiya / qo'lda tuzatish (TZ 9.5). */
  async adjust(user: AuthUser, branchId: string, dto: StockAdjustDto, requestId?: string) {
    return runTx(this.db, async (tx) => {
      const b = await this.repo.lockBranch(tx, branchId);
      if (!b?.active) throw forbidden('Filial nofaol', 'branch_inactive');
      const key: LevelKey = { productId: dto.productId, variantId: dto.variantId ?? null };
      const t = (await this.loadTargets(tx, [key])).get(levelKey(key));
      if (!t) throw notFound('Mahsulot');
      if (t.product.isVariable && !t.variant) throw unprocessable('validation_failed', 'Variantni tanlang');
      const lvl = (await this.lockLevels(tx, branchId, [key], true)).get(levelKey(key))!;
      const target = dto.newStock != null ? qty4(dto.newStock) : qty4(lvl.stock + (dto.delta ?? 0));
      if (target < 0) throw unprocessable('insufficient_stock', "Qoldiq manfiy bo'lmasin");
      const delta = qty4(target - lvl.stock);
      const before = lvl.stock;
      const after = delta !== 0 ? await this.applyMovement(tx, lvl, { branchId, productId: dto.productId, variantId: dto.variantId ?? null, type: 'adjustment', qtyBase: delta, unit: t.product.baseUnit, qtyUnit: delta, refType: 'adjustment', userId: user.id }) : lvl.stock;
      const name = displayName(t.product, t.variant);
      await this.audit.log(user, { action: 'stock_adjust', module: 'Mahsulotlar', targetId: dto.productId, targetName: name, branchId, requestId, details: `Qoldiq tuzatildi: ${before} → ${after} ${t.product.baseUnit}. Sabab: ${dto.reason.trim()}`, diff: { before: { qoldiq: before }, after: { qoldiq: after } } }, tx);
      return { stock: after, delta };
    });
  }

  /** Joriy filialda min. qoldiq / tannarx (TZ 9.5 PATCH /stock-levels/:id). */
  async patchLevel(user: AuthUser, branchId: string, id: string, dto: StockLevelPatchDto) {
    const lvl = await this.repo.findLevel(id, branchId);
    if (!lvl) throw notFound('Ombor qatori');
    if (dto.costPrice !== undefined && !user.permissions.includes('view_cost_price')) throw forbidden("Tannarxni o'zgartirish huquqi yo'q");
    const set: { minStock?: number | null; costPrice?: number | null } = {};
    if (dto.minStock !== undefined) set.minStock = dto.minStock != null && dto.minStock > 0 ? dto.minStock : null;
    if (dto.costPrice !== undefined) set.costPrice = dto.costPrice != null && dto.costPrice > 0 ? dto.costPrice : null;
    if (!Object.keys(set).length) throw conflict('validation_failed', "O'zgartiriladigan maydon yo'q");
    const row = await this.repo.updateLevel(id, set);
    const pName = await this.repo.productName(lvl.productId);
    await this.audit.log(user, { action: 'edit', module: 'Mahsulotlar', targetId: lvl.productId, targetName: pName ?? lvl.productId, branchId, details: `Ombor sozlamasi: ${dto.minStock !== undefined ? `min. qoldiq ${dto.minStock ?? '—'}` : ''}${dto.costPrice !== undefined ? ` tannarx ${dto.costPrice ?? '—'}` : ''}`.trim() });
    return toLevelView(row);
  }

  /** Mahsulot tarixi: kirim qatorlari + audit (TZ 9.4). Filial admini faqat o'z filialini ko'radi. */
  async productHistory(user: AuthUser, branchId: string | null, productId: string) {
    const scope = user.allBranches ? null : branchId;
    const [receipts, logs] = await this.repo.historyRows(productId, scope);
    return toProductHistory(receipts, logs, user.permissions.includes('view_cost_price'));
  }
}
