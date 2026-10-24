import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../db/db.module.js';
import { runTx } from '../../db/tx.js';
import { branches, paymentMethods, saleLines, salePayments, sales, units } from '../../db/schema/index.js';
import type { AuthUser } from '../../common/auth-context.js';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors.js';
import { dayKey, qty4 } from '../../common/numbers.js';
import { page } from '../../common/pagination.js';
import { calcLine, factorOf, priceOf, vatIncluded, type LineCalc } from '../../common/pricing.js';
import { AuditService } from '../audit/audit.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ShiftsService } from '../shifts/shifts.service.js';
import type { DebtPaymentDto } from '../customers/customers.dto.js';
import type { SaleDto, SalesListQuery } from './sales.dto.js';

interface QuotedLine extends LineCalc {
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  sku: string;
  categoryId: string;
  available: number | null;
  costPerBase: number | null;
}

/**
 * Kassa (TZ 8, 20). Savat summasi, qoldiq, tannarx, foyda va qarz — faqat serverda, bitta tranzaksiyada.
 * Ilova A algoritmi: qulf (tartiblangan), hisob, to'lov, yozish, qoldiq, nasiya, audit.
 */
@Injectable()
export class SalesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    private readonly customers: CustomersService,
    private readonly settings: SettingsService,
    private readonly shifts: ShiftsService,
  ) {}

  /* ───────── Hisob (quote) ───────── */

  private async quoteLines(tx: DbOrTx, branchId: string, dto: SaleDto, lockStock: boolean) {
    const rules = await this.settings.getRules(tx);
    const unitRows = await tx.select().from(units);
    const unitById = new Map(unitRows.map((u) => [u.id, u]));
    const keys = dto.lines.map((l) => ({ productId: l.productId, variantId: l.variantId ?? null }));
    const targets = await this.inventory.loadTargets(tx, keys);
    // Filial narxi (TZ 8.1): bo'lsa umumiy narx o'rniga
    const prices = await tx.query.branchPrices.findMany({ where: (bp, { and, eq, inArray }) => and(eq(bp.branchId, branchId), inArray(bp.productId, [...new Set(keys.map((k) => k.productId))])) });
    const levels = lockStock ? await this.inventory.lockLevels(tx, branchId, keys, false) : await this.readLevels(tx, branchId, keys);

    const lines: QuotedLine[] = dto.lines.map((l) => {
      const key = `${l.productId}|${l.variantId ?? ''}`;
      const t = targets.get(key);
      if (!t) throw notFound('Mahsulot', { productId: l.productId, variantId: l.variantId });
      if (t.product.isVariable && !t.variant) throw unprocessable('validation_failed', `"${t.product.name}": variantni tanlang`);
      const lvl = levels.get(key);
      if (!lvl) throw unprocessable('not_in_branch', `"${t.product.name}" bu filial omborida yo'q`, { productId: l.productId });
      const bp = prices.find((p) => p.productId === l.productId && (p.variantId ?? null) === (l.variantId ?? null));
      const target = bp ? { ...t.target, retailPrice: bp.retailPrice } : t.target;
      if (factorOf(target, l.unit) == null || !unitById.has(l.unit)) throw unprocessable('unit_not_allowed', `"${l.unit}" birligi "${t.product.name}" uchun belgilanmagan`);
      if (priceOf(target, l.unit) <= 0) throw unprocessable('price_missing', `"${t.product.name}" uchun ${l.unit} narxi belgilanmagan`);
      const calc = calcLine(target, l.unit, l.qty, l.cuts, { cutDeductionMode: rules.cutDeductionMode, pieceLengthMeters: Number(rules.pieceLengthMeters) }, unitById.get(l.unit)!.precision);
      if (calc.qty <= 0 || calc.lineTotal <= 0) throw unprocessable('validation_failed', `"${t.product.name}": miqdor yoki summa 0`);
      return { ...calc, productId: l.productId, variantId: l.variantId ?? null, name: t.product.name, variantName: t.variant?.name ?? null, sku: t.variant?.sku ?? t.product.sku, categoryId: t.product.categoryId, available: lvl.stock, costPerBase: lvl.costPrice };
    });

    const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0);
    const discount = Math.min(Math.max(0, Math.round(dto.discountAmount ?? 0)), subtotal);
    const total = subtotal - discount;
    // Qoldiq: (mahsulot, variant) bo'yicha jami (TZ 8.5)
    const need = new Map<string, number>();
    for (const l of lines) need.set(`${l.productId}|${l.variantId ?? ''}`, qty4((need.get(`${l.productId}|${l.variantId ?? ''}`) ?? 0) + l.baseQty));
    const warnings: { code: string; message: string; productId: string }[] = [];
    for (const [key, q] of need) {
      const lvl = levels.get(key)!;
      if (q > lvl.stock + 1e-9) {
        const l = lines.find((x) => `${x.productId}|${x.variantId ?? ''}` === key)!;
        const msg = `${l.name}${l.variantName ? ` (${l.variantName})` : ''}: omborda ${lvl.stock}, kerak ${q}`;
        if (!rules.allowNegativeStock) throw unprocessable('insufficient_stock', msg, { productId: l.productId, variantId: l.variantId, available: lvl.stock, requested: q });
        warnings.push({ code: 'insufficient_stock', message: msg, productId: l.productId });
      }
    }
    // Tannarx va foyda (TZ 8.7): noma'lum bo'lsa taxminiy marja
    const margin = Number(rules.estimatedMarginPct) / 100;
    const costSum = lines.reduce((a, l) => a + (l.costPerBase != null ? l.baseQty * l.costPerBase : l.lineTotal * (1 - margin)), 0);
    const profit = Math.round(total - costSum);
    return { rules, lines, subtotal, discount, total, vat: vatIncluded(total, Number(rules.vatPct)), profit, need, levels, warnings };
  }

  private async readLevels(tx: DbOrTx, branchId: string, keys: { productId: string; variantId: string | null }[]) {
    const rows = await tx.query.stockLevels.findMany({ where: (s, { and, eq, inArray }) => and(eq(s.branchId, branchId), inArray(s.productId, [...new Set(keys.map((k) => k.productId))])) });
    const out = new Map<string, { id: string; stock: number; costPrice: number | null; minStock: number | null }>();
    for (const r of rows) out.set(`${r.productId}|${r.variantId ?? ''}`, { id: r.id, stock: Number(r.stock), costPrice: r.costPrice != null ? Number(r.costPrice) : null, minStock: r.minStock != null ? Number(r.minStock) : null });
    return out;
  }

  /** POST /sales/quote — saqlamaydi, frontend savatni shu bilan tekshiradi. */
  async quote(user: AuthUser, branchId: string, dto: SaleDto) {
    const q = await this.quoteLines(this.db, branchId, dto, false);
    const withCost = user.permissions.includes('view_cost_price');
    return {
      lines: q.lines.map(({ available, costPerBase, ...l }) => ({ ...l, available, ...(withCost ? { costPerBase } : {}) })),
      subtotal: q.subtotal, discountAmount: q.discount, totalAmount: q.total, vatIncluded: q.vat, ...(withCost ? { profit: q.profit } : {}), warnings: q.warnings,
    };
  }

  /* ───────── Sotuv (TZ 20, Ilova A) ───────── */

  async create(user: AuthUser, branchId: string, dto: SaleDto, requestId?: string) {
    if (dto.clientId) {
      const [dup] = await this.db.select({ id: sales.id }).from(sales).where(eq(sales.clientId, dto.clientId)).limit(1);
      if (dup) return this.get(user, dup.id);
    }
    const id = await runTx(this.db, async (tx) => {
      // Qulf tartibi hamma joyda bir xil: avval filial qatori (chek raqami), keyin qoldiq qatorlari — deadlock bo'lmasin
      const [b] = await tx.select({ code: branches.code }).from(branches).where(eq(branches.id, branchId)).for('update');
      const shiftId = await this.shifts.requireForSale(tx, user, branchId);
      const q = await this.quoteLines(tx, branchId, dto, true);
      const rules = q.rules;
      if (rules.cashierMaxDiscount > 0 && q.discount > rules.cashierMaxDiscount && !user.permissions.includes('manage_users')) {
        throw unprocessable('discount_too_large', `Kassir uchun chegirma ko'pi bilan ${rules.cashierMaxDiscount.toLocaleString('ru-RU')} so'm`);
      }

      // To'lovlar (TZ 8.8): har usul yoqilgan, qarz usuli emas; Σ + nasiya = total
      const methods = await tx.select().from(paymentMethods);
      const pays = (dto.payments ?? []).map((p) => {
        const m = methods.find((x) => x.id === p.methodId);
        if (!m) throw notFound("To'lov usuli", { methodId: p.methodId });
        if (!m.enabled) throw unprocessable('payment_method_disabled', `"${m.label}" usuli o'chirilgan`);
        if (m.kind === 'debt') throw unprocessable('validation_failed', "Nasiya to'lov qismi sifatida kiritilmaydi — onCredit=true yuboring");
        return { m, amount: Math.round(p.amount), ref: p.ref?.trim() || null };
      });
      if (new Set(pays.map((p) => p.m.id)).size !== pays.length) throw unprocessable('validation_failed', 'Bitta usul ikki marta kiritilgan');
      const paid = pays.reduce((a, p) => a + p.amount, 0);
      if (paid > q.total) throw unprocessable('validation_failed', `To'lovlar yig'indisi (${paid.toLocaleString('ru-RU')}) chek summasidan katta`);
      const remaining = q.total - paid;
      let customer = dto.customerId ? await this.customers.get(dto.customerId, tx) : null;
      if (remaining > 0) {
        if (!dto.onCredit) throw unprocessable('validation_failed', `${remaining.toLocaleString('ru-RU')} so'm yetmayapti`);
        if (!user.permissions.includes('give_debt')) throw forbidden("Nasiyaga sotish huquqi yo'q");
        if (!customer) throw unprocessable('debtor_required', 'Nasiya uchun mijozni tanlang');
        if (customer.totalDebtUZS + remaining > customer.creditLimitUZS) throw unprocessable('credit_limit_exceeded', `Kredit limiti oshadi (${customer.creditLimitUZS.toLocaleString('ru-RU')} so'm)`, { limit: customer.creditLimitUZS, debt: customer.totalDebtUZS, requested: remaining });
      }
      const debtMethod = methods.find((m) => m.kind === 'debt');
      const paymentSummary = remaining > 0 && pays.length === 0 ? (debtMethod?.code ?? 'debt') : pays.length === 1 ? pays[0].m.code : pays.length > 1 ? 'mixed' : (methods.find((m) => m.kind === 'cash')?.code ?? 'cash');

      // Chek raqami: filial kodi + kun + tartib (filial qulfi ostida)
      const number = await this.nextNumber(tx, branchId, b.code);
      const [s] = await tx
        .insert(sales)
        .values({
          branchId, number, type: 'sale', shiftId, cashierId: user.id, cashierName: user.name, customerId: customer?.id ?? null, customerName: customer?.name ?? 'Oddiy mijoz',
          paymentSummary, subtotal: q.subtotal, discountAmount: q.discount, totalAmount: q.total, paidAmount: paid, remainingDebt: remaining, profit: q.profit, vatIncluded: q.vat, clientId: dto.clientId ?? null,
        })
        .returning({ id: sales.id });
      await tx.insert(saleLines).values(q.lines.map((l, i) => ({ saleId: s.id, productId: l.productId, variantId: l.variantId, name: l.name, variantName: l.variantName, sku: l.sku, categoryId: l.categoryId, unit: l.unit, qty: l.qty, baseQty: l.baseQty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, costPerBase: l.costPerBase, cuts: l.cuts ?? null, sortOrder: i })));
      if (pays.length) await tx.insert(salePayments).values(pays.map((p) => ({ saleId: s.id, methodId: p.m.id, methodCode: p.m.code, kind: p.m.kind, amount: p.amount, ref: p.ref })));
      // Qoldiqni ayirish (qulflangan qatorlar)
      for (const [key, need] of q.need) {
        const lvl = q.levels.get(key)!;
        const l = q.lines.find((x) => `${x.productId}|${x.variantId ?? ''}` === key)!;
        await this.inventory.applyMovement(tx, lvl, { branchId, productId: l.productId, variantId: l.variantId, type: 'sale', qtyBase: -need, unit: l.unit, qtyUnit: -need, costPerBase: lvl.costPrice, refType: 'sale', refId: s.id, userId: user.id });
      }
      // Nasiya
      if (remaining > 0 && customer) {
        const r = await this.customers.applyDebt(tx, { customerId: customer.id, branchId, type: 'sale_debt', amount: remaining, refType: 'sale', refId: s.id, userId: user.id, dueDays: rules.defaultCreditDays });
        await tx.update(sales).set({ customerDebtAfter: r.after }).where(eq(sales.id, s.id));
      }
      await this.audit.log(user, {
        action: 'sale', module: 'Kassa', targetId: s.id, targetName: `Chek ${number} · ${customer?.name ?? 'Oddiy mijoz'}`, branchId, requestId,
        details: remaining > 0 ? `Nasiya: jami ${q.total.toLocaleString('ru-RU')} so'm (${paid.toLocaleString('ru-RU')} to'landi + ${remaining.toLocaleString('ru-RU')} qarz)` : `Sotuv: ${q.total.toLocaleString('ru-RU')} so'm${q.discount ? `, chegirma ${q.discount.toLocaleString('ru-RU')}` : ''}${pays.length > 1 ? " (aralash to'lov)" : ''}`,
      }, tx);
      return s.id;
    });
    return this.get(user, id);
  }

  private async nextNumber(tx: DbOrTx, branchId: string, code: string) {
    const day = dayKey(new Date()).replace(/-/g, '');
    const prefix = `${code}-${day}-`;
    // Tartib raqami — chek raqamining oxirgi qismi (MAIN-20261024-0007 → 7)
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(split_part(${sales.number}, '-', 3)::int), 0)::int` }).from(sales).where(and(eq(sales.branchId, branchId), sql`${sales.number} like ${prefix + '%'}`));
    return `${prefix}${String(max + 1).padStart(4, '0')}`;
  }

  /* ───────── Qarz to'lovi (TZ 8.8) ───────── */

  async debtPayment(user: AuthUser, branchId: string, customerId: string, dto: DebtPaymentDto, requestId?: string) {
    const id = await runTx(this.db, async (tx) => {
      const shiftId = await this.shifts.requireForSale(tx, user, branchId, true);
      const [m] = await tx.select().from(paymentMethods).where(eq(paymentMethods.id, dto.methodId)).limit(1);
      if (!m || !m.enabled || m.kind === 'debt') throw unprocessable('payment_method_disabled', "To'lov usuli noto'g'ri yoki o'chirilgan");
      const [b] = await tx.select({ code: branches.code }).from(branches).where(eq(branches.id, branchId)).for('update');
      const number = await this.nextNumber(tx, branchId, b.code);
      const amount = Math.round(dto.amount);
      const [s] = await tx
        .insert(sales)
        .values({ branchId, number, type: 'debt_payment', shiftId, cashierId: user.id, cashierName: user.name, customerId, customerName: '', paymentSummary: m.code, subtotal: amount, totalAmount: amount, paidAmount: amount })
        .returning({ id: sales.id });
      const r = await this.customers.applyDebt(tx, { customerId, branchId, type: 'payment', amount: -amount, refType: 'debt_payment', refId: s.id, userId: user.id, markPaid: true });
      await tx.update(sales).set({ customerName: r.customer.name, customerDebtAfter: r.after }).where(eq(sales.id, s.id));
      await tx.insert(salePayments).values({ saleId: s.id, methodId: m.id, methodCode: m.code, kind: m.kind, amount });
      await this.audit.log(user, { action: 'debt_payment', module: 'Nasiya / Qarz', targetId: customerId, targetName: r.customer.name, branchId, requestId, details: `To'lov: ${amount.toLocaleString('ru-RU')} so'm (${m.label.toLowerCase()}), qoldiq ${r.after.toLocaleString('ru-RU')} so'm` }, tx);
      return s.id;
    });
    return this.get(user, id);
  }

  /* ───────── Storno (TZ 7.9) ───────── */

  async void(user: AuthUser, branchId: string, id: string, reason: string, requestId?: string) {
    await runTx(this.db, async (tx) => {
      await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, branchId)).for('update');
      const [s] = await tx.select().from(sales).where(eq(sales.id, id)).limit(1).for('update');
      if (!s) throw notFound('Chek');
      if (s.branchId !== branchId) throw forbidden("Boshqa filial chekini bekor qila olmaysiz", 'branch_forbidden');
      if (s.type !== 'sale') throw unprocessable('validation_failed', 'Faqat sotuv cheki bekor qilinadi');
      if (s.status === 'voided') throw conflict('already_voided', 'Bu chek allaqachon bekor qilingan');
      const lines = await tx.select().from(saleLines).where(eq(saleLines.saleId, id));
      // Qoldiqni qaytarish
      const back = new Map<string, number>();
      for (const l of lines) back.set(`${l.productId}|${l.variantId ?? ''}`, qty4((back.get(`${l.productId}|${l.variantId ?? ''}`) ?? 0) + Number(l.baseQty)));
      const levels = await this.inventory.lockLevels(tx, branchId, lines.map((l) => ({ productId: l.productId, variantId: l.variantId })), true);
      for (const [key, q] of back) {
        const l = lines.find((x) => `${x.productId}|${x.variantId ?? ''}` === key)!;
        await this.inventory.applyMovement(tx, levels.get(key)!, { branchId, productId: l.productId, variantId: l.variantId, type: 'sale_void', qtyBase: q, unit: l.unit, qtyUnit: q, refType: 'sale', refId: id, userId: user.id });
      }
      let debtNote = '';
      if (s.remainingDebt > 0 && s.customerId) {
        const r = await this.customers.applyDebt(tx, { customerId: s.customerId, branchId, type: 'sale_void', amount: -s.remainingDebt, refType: 'sale', refId: id, userId: user.id, capAtZero: true });
        const refund = s.remainingDebt + r.applied; // mijoz allaqachon to'lagan qismi
        debtNote = `, ${(-r.applied).toLocaleString('ru-RU')} so'm qarz qaytarildi${refund > 0 ? `; mijoz ${refund.toLocaleString('ru-RU')} so'mni avval to'lagan — naqd qaytariladi` : ''}`;
      }
      await tx.update(sales).set({ status: 'voided', voidedAt: new Date(), voidedBy: user.id, voidedByName: user.name, voidReason: reason.trim() }).where(eq(sales.id, id));
      await this.audit.log(user, { action: 'sale_void', module: 'Kassa', targetId: id, targetName: `Chek ${s.number} · ${s.customerName}`, branchId, requestId, details: `Bekor qilindi: ${s.totalAmount.toLocaleString('ru-RU')} so'm${debtNote}. Sabab: ${reason.trim()}` }, tx);
    });
    return this.get(user, id);
  }

  /* ───────── O'qish ───────── */

  async get(user: AuthUser, id: string) {
    const [s] = await this.db.select().from(sales).where(eq(sales.id, id)).limit(1);
    if (!s) throw notFound('Chek');
    const [lines, pays] = await Promise.all([this.db.select().from(saleLines).where(eq(saleLines.saleId, id)).orderBy(saleLines.sortOrder), this.db.select().from(salePayments).where(eq(salePayments.saleId, id))]);
    return this.view(user, s, lines, pays);
  }

  private view(user: AuthUser, s: typeof sales.$inferSelect, lines: (typeof saleLines.$inferSelect)[], pays: (typeof salePayments.$inferSelect)[]) {
    const withCost = user.permissions.includes('view_cost_price');
    return {
      ...s, vatIncluded: Number(s.vatIncluded), ...(withCost ? {} : { profit: undefined }),
      lines: lines.map((l) => ({ ...l, qty: Number(l.qty), baseQty: Number(l.baseQty), costPerBase: withCost && l.costPerBase != null ? Number(l.costPerBase) : undefined })),
      payments: pays.map((p) => ({ method: p.methodCode, methodId: p.methodId, kind: p.kind, amount: p.amount, ref: p.ref })),
    };
  }

  /** Ro'yxat: kassir faqat o'zinikini, view_analytics/manage_users hammasini (TZ 9.6). 4 ta so'rov. */
  async list(user: AuthUser, branchId: string, q: SalesListQuery) {
    const seeAll = user.permissions.includes('view_analytics') || user.permissions.includes('manage_users');
    const where = and(
      eq(sales.branchId, branchId),
      seeAll ? (q.cashierId ? eq(sales.cashierId, q.cashierId) : undefined) : eq(sales.cashierId, user.id),
      q.from ? gte(sales.createdAt, new Date(q.from)) : undefined,
      q.to ? lte(sales.createdAt, new Date(q.to + 'T23:59:59.999Z')) : undefined,
      q.customerId ? eq(sales.customerId, q.customerId) : undefined,
      q.shiftId ? eq(sales.shiftId, q.shiftId) : undefined,
      q.type === 'sale' || q.type === 'debt_payment' ? eq(sales.type, q.type) : undefined,
      q.status === 'voided' ? eq(sales.status, 'voided') : q.status === 'completed' ? eq(sales.status, 'completed') : undefined,
      q.q?.trim() ? or(ilike(sales.number, `%${q.q.trim()}%`), ilike(sales.customerName, `%${q.q.trim()}%`), sql`exists (select 1 from ${saleLines} where ${saleLines.saleId} = ${sales.id} and (${saleLines.name} ilike ${'%' + q.q.trim() + '%'} or ${saleLines.sku} ilike ${'%' + q.q.trim() + '%'}))`) : undefined,
    );
    const [items, [{ total }]] = await Promise.all([
      this.db.select().from(sales).where(where).orderBy(desc(sales.createdAt)).limit(q.pageSize).offset(q.offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(sales).where(where),
    ]);
    const ids = items.map((s) => s.id);
    const [lines, pays] = ids.length ? await Promise.all([this.db.select().from(saleLines).where(inArray(saleLines.saleId, ids)).orderBy(saleLines.sortOrder), this.db.select().from(salePayments).where(inArray(salePayments.saleId, ids))]) : [[], []];
    return page(items.map((s) => this.view(user, s, lines.filter((l) => l.saleId === s.id), pays.filter((p) => p.saleId === s.id))), total, q);
  }
}
