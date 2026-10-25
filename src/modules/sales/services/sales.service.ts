import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { conflict, forbidden, isUniqueViolation, notFound, unprocessable } from '../../../common/errors/app-error.js';
import { dayKey, qty4 } from '../../../common/utils/numbers.js';
import { page } from '../../../common/utils/pagination.js';
import { calcLine, factorOf, priceOf, vatIncluded } from '../../../common/utils/pricing.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { CustomersService } from '../../customers/services/customers.service.js';
import { InventoryService } from '../../inventory/services/inventory.service.js';
import { SettingsService } from '../../settings/services/settings.service.js';
import { ShiftsService } from '../../shifts/services/shifts.service.js';
import type { DebtPaymentDto } from '../../customers/dto/customers.dto.js';
import type { SaleDto, SalesListQuery } from '../dto/sales.dto.js';
import { toQuoteView, toSaleList, toSaleView, type QuotedLine, type QuoteWarning } from '../mappers/sales.mapper.js';
import { SalesRepository } from '../repositories/sales.repository.js';

export type { QuotedLine, SaleView } from '../mappers/sales.mapper.js';

/**
 * Kassa (TZ 8, 20). Savat summasi, qoldiq, tannarx, foyda va qarz — faqat serverda, bitta tranzaksiyada.
 * Ilova A algoritmi: qulf (tartiblangan), hisob, to'lov, yozish, qoldiq, nasiya, audit.
 */
@Injectable()
export class SalesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: SalesRepository,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    private readonly customers: CustomersService,
    private readonly settings: SettingsService,
    private readonly shifts: ShiftsService,
  ) {}

  /** Hammasini yoki faqat o'z cheklarini ko'rish (TZ 9.6). */
  private seeAll = (user: AuthUser) => user.permissions.includes('view_analytics') || user.permissions.includes('manage_users');
  private withCost = (user: AuthUser) => user.permissions.includes('view_cost_price');

  /* ───────── Hisob (quote) ───────── */

  private async quoteLines(tx: DbOrTx, branchId: string, dto: SaleDto, lockStock: boolean) {
    const rules = await this.settings.getRules(tx);
    const unitRows = await this.repo.units(tx);
    const unitById = new Map(unitRows.map((u) => [u.id, u]));
    const keys = dto.lines.map((l) => ({ productId: l.productId, variantId: l.variantId ?? null }));
    const targets = await this.inventory.loadTargets(tx, keys);
    // Filial narxi (TZ 8.1): bo'lsa umumiy narx o'rniga
    const prices = await this.repo.branchPrices(tx, branchId, [...new Set(keys.map((k) => k.productId))]);
    const levels = lockStock ? await this.inventory.lockLevels(tx, branchId, keys, false) : await this.repo.readLevels(tx, branchId, keys);

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
    const warnings: QuoteWarning[] = [];
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

  /** POST /sales/quote — saqlamaydi, frontend savatni shu bilan tekshiradi. */
  async quote(user: AuthUser, branchId: string, dto: SaleDto) {
    const q = await this.quoteLines(this.db, branchId, dto, false);
    const warnings = [...q.warnings];
    if (dto.customerId) {
      const cu = await this.customers.get(dto.customerId);
      if (cu.overdue) warnings.push({ code: 'customer_overdue', message: `${cu.name}: qarz muddati o'tgan (${cu.dueDate}), qarzi ${cu.totalDebtUZS.toLocaleString('ru-RU')} so'm`, productId: '' });
      const paid = (dto.payments ?? []).reduce((a, p) => a + Math.round(p.amount), 0);
      if (dto.onCredit && q.total - paid > 0 && cu.totalDebtUZS + (q.total - paid) > cu.creditLimitUZS) {
        warnings.push({ code: 'credit_limit_exceeded', message: `Kredit limiti ${(cu.totalDebtUZS + q.total - paid - cu.creditLimitUZS).toLocaleString('ru-RU')} so'mga oshadi`, productId: '' });
      }
    }
    return toQuoteView(q, this.withCost(user), warnings);
  }

  /* ───────── Sotuv (TZ 20, Ilova A) ───────── */

  async create(user: AuthUser, branchId: string, dto: SaleDto, requestId?: string) {
    if (dto.clientId) {
      const dup = await this.repo.findIdByClientId(dto.clientId);
      if (dup) return this.get(user, dup);
    }
    let id: string;
    try {
      id = await this.createTx(user, branchId, dto, requestId);
    } catch (e) {
      // Bir xil clientId bilan ikki parallel so'rov: `sales_client_id_uq` ikkinchisini to'xtatadi — avvalgi chek qaytariladi (idempotentlik, TZ 10)
      const dup = dto.clientId && isUniqueViolation(e) ? await this.repo.findIdByClientId(dto.clientId) : null;
      if (!dup) throw e;
      id = dup;
    }
    return this.get(user, id);
  }

  private createTx(user: AuthUser, branchId: string, dto: SaleDto, requestId?: string) {
    return runTx(this.db, async (tx) => {
      // Qulf tartibi hamma joyda bir xil: avval filial qatori (chek raqami), keyin qoldiq qatorlari — deadlock bo'lmasin
      const b = await this.repo.lockBranch(tx, branchId);
      const shiftId = await this.shifts.requireForSale(tx, user, branchId);
      const q = await this.quoteLines(tx, branchId, dto, true);
      const rules = q.rules;
      if (rules.cashierMaxDiscount > 0 && q.discount > rules.cashierMaxDiscount && !user.permissions.includes('manage_users')) {
        throw unprocessable('discount_too_large', `Kassir uchun chegirma ko'pi bilan ${rules.cashierMaxDiscount.toLocaleString('ru-RU')} so'm`);
      }

      // To'lovlar (TZ 8.8): har usul yoqilgan, qarz usuli emas; Σ + nasiya = total
      const methods = await this.repo.paymentMethods(tx);
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
      const customer = dto.customerId ? await this.customers.get(dto.customerId, tx) : null;
      if (remaining > 0) {
        if (!dto.onCredit) throw unprocessable('validation_failed', `${remaining.toLocaleString('ru-RU')} so'm yetmayapti`);
        if (!user.permissions.includes('give_debt')) throw forbidden("Nasiyaga sotish huquqi yo'q");
        if (!customer) throw unprocessable('debtor_required', 'Nasiya uchun mijozni tanlang');
        if (customer.totalDebtUZS + remaining > customer.creditLimitUZS) throw unprocessable('credit_limit_exceeded', `Kredit limiti oshadi (${customer.creditLimitUZS.toLocaleString('ru-RU')} so'm)`, { limit: customer.creditLimitUZS, debt: customer.totalDebtUZS, requested: remaining });
      }
      const debtMethod = methods.find((m) => m.kind === 'debt');
      const paymentSummary = remaining > 0 && pays.length === 0 ? (debtMethod?.code ?? 'debt') : pays.length === 1 ? pays[0].m.code : pays.length > 1 ? 'mixed' : (methods.find((m) => m.kind === 'cash')?.code ?? 'cash');

      // Chek raqami: filial kodi + kun + tartib (filial qulfi ostida)
      const number = await this.nextNumber(tx, branchId, b!.code);
      const saleId = await this.repo.insertSale(tx, {
        branchId, number, type: 'sale', shiftId, cashierId: user.id, cashierName: user.name, customerId: customer?.id ?? null, customerName: customer?.name ?? 'Oddiy mijoz',
        paymentSummary, subtotal: q.subtotal, discountAmount: q.discount, totalAmount: q.total, paidAmount: paid, remainingDebt: remaining, profit: q.profit, vatIncluded: q.vat, clientId: dto.clientId ?? null,
      });
      await this.repo.insertLines(tx, q.lines.map((l, i) => ({ saleId, productId: l.productId, variantId: l.variantId, name: l.name, variantName: l.variantName, sku: l.sku, categoryId: l.categoryId, unit: l.unit, qty: l.qty, baseQty: l.baseQty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, costPerBase: l.costPerBase, cuts: l.cuts ?? null, sortOrder: i })));
      if (pays.length) await this.repo.insertPayments(tx, pays.map((p) => ({ saleId, methodId: p.m.id, methodCode: p.m.code, kind: p.m.kind, amount: p.amount, ref: p.ref })));
      // Qoldiqni ayirish (qulflangan qatorlar)
      for (const [key, need] of q.need) {
        const lvl = q.levels.get(key)!;
        const l = q.lines.find((x) => `${x.productId}|${x.variantId ?? ''}` === key)!;
        await this.inventory.applyMovement(tx, lvl, { branchId, productId: l.productId, variantId: l.variantId, type: 'sale', qtyBase: -need, unit: l.unit, qtyUnit: -need, costPerBase: lvl.costPrice, refType: 'sale', refId: saleId, userId: user.id });
      }
      // Nasiya
      if (remaining > 0 && customer) {
        const r = await this.customers.applyDebt(tx, { customerId: customer.id, branchId, type: 'sale_debt', amount: remaining, refType: 'sale', refId: saleId, userId: user.id, dueDays: rules.defaultCreditDays });
        await this.repo.updateSale(tx, saleId, { customerDebtAfter: r.after });
      }
      await this.audit.log(user, {
        action: 'sale', module: 'Kassa', targetId: saleId, targetName: `Chek ${number} · ${customer?.name ?? 'Oddiy mijoz'}`, branchId, requestId,
        details: remaining > 0 ? `Nasiya: jami ${q.total.toLocaleString('ru-RU')} so'm (${paid.toLocaleString('ru-RU')} to'landi + ${remaining.toLocaleString('ru-RU')} qarz)` : `Sotuv: ${q.total.toLocaleString('ru-RU')} so'm${q.discount ? `, chegirma ${q.discount.toLocaleString('ru-RU')}` : ''}${pays.length > 1 ? " (aralash to'lov)" : ''}`,
      }, tx);
      return saleId;
    });
  }

  private async nextNumber(tx: DbOrTx, branchId: string, code: string) {
    const day = dayKey(new Date()).replace(/-/g, '');
    const prefix = `${code}-${day}-`;
    // Tartib raqami — chek raqamining oxirgi qismi (MAIN-20261024-0007 → 7)
    const max = await this.repo.maxSeq(tx, branchId, prefix);
    return `${prefix}${String(max + 1).padStart(4, '0')}`;
  }

  /* ───────── Qarz to'lovi (TZ 8.8) ───────── */

  async debtPayment(user: AuthUser, branchId: string, customerId: string, dto: DebtPaymentDto, requestId?: string) {
    const id = await runTx(this.db, async (tx) => {
      const shiftId = await this.shifts.requireForSale(tx, user, branchId, true);
      const m = await this.repo.findPaymentMethod(tx, dto.methodId);
      if (!m || !m.enabled || m.kind === 'debt') throw unprocessable('payment_method_disabled', "To'lov usuli noto'g'ri yoki o'chirilgan");
      const b = await this.repo.lockBranch(tx, branchId);
      const number = await this.nextNumber(tx, branchId, b!.code);
      const amount = Math.round(dto.amount);
      const saleId = await this.repo.insertSale(tx, { branchId, number, type: 'debt_payment', shiftId, cashierId: user.id, cashierName: user.name, customerId, customerName: '', paymentSummary: m.code, subtotal: amount, totalAmount: amount, paidAmount: amount });
      const r = await this.customers.applyDebt(tx, { customerId, branchId, type: 'payment', amount: -amount, refType: 'debt_payment', refId: saleId, userId: user.id, markPaid: true });
      await this.repo.updateSale(tx, saleId, { customerName: r.customer.name, customerDebtAfter: r.after });
      await this.repo.insertPayments(tx, [{ saleId, methodId: m.id, methodCode: m.code, kind: m.kind, amount }]);
      await this.audit.log(user, { action: 'debt_payment', module: 'Nasiya / Qarz', targetId: customerId, targetName: r.customer.name, branchId, requestId, details: `To'lov: ${amount.toLocaleString('ru-RU')} so'm (${m.label.toLowerCase()}), qoldiq ${r.after.toLocaleString('ru-RU')} so'm` }, tx);
      return saleId;
    });
    return this.get(user, id);
  }

  /* ───────── Storno (TZ 7.9) ───────── */

  async void(user: AuthUser, branchId: string, id: string, reason: string, requestId?: string) {
    await runTx(this.db, async (tx) => {
      // Qulf tartibi sotuv bilan bir xil: filial → chek → qoldiq qatorlari
      await this.repo.lockBranch(tx, branchId);
      const s = await this.repo.lockById(tx, id);
      if (!s) throw notFound('Chek');
      if (s.branchId !== branchId) throw forbidden("Boshqa filial chekini bekor qila olmaysiz", 'branch_forbidden');
      if (s.type !== 'sale') throw unprocessable('validation_failed', 'Faqat sotuv cheki bekor qilinadi');
      if (s.status === 'voided') throw conflict('already_voided', 'Bu chek allaqachon bekor qilingan');
      const lines = await this.repo.lines(tx, id);
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
      await this.repo.updateSale(tx, id, { status: 'voided', voidedAt: new Date(), voidedBy: user.id, voidedByName: user.name, voidReason: reason.trim() });
      await this.shifts.refreezeIfClosed(tx, s.shiftId);
      await this.audit.log(user, { action: 'sale_void', module: 'Kassa', targetId: id, targetName: `Chek ${s.number} · ${s.customerName}`, branchId, requestId, details: `Bekor qilindi: ${s.totalAmount.toLocaleString('ru-RU')} so'm${debtNote}. Sabab: ${reason.trim()}` }, tx);
    });
    return this.get(user, id);
  }

  /* ───────── O'qish ───────── */

  async get(user: AuthUser, id: string, strict = false) {
    const s = await this.repo.findById(id);
    if (!s) throw notFound('Chek');
    if (strict) {
      // Id bilan so'rash: filial xodimi faqat o'z filiali chekini, kassir (hisobot huquqisiz) faqat o'z chekini ko'radi
      if (!user.allBranches && !user.branchIds.includes(s.branchId)) throw forbidden("Bu filialga kirish huquqingiz yo'q", 'branch_forbidden');
      if (!this.seeAll(user) && s.cashierId !== user.id) throw forbidden("Faqat o'zingiz tuzgan cheklarni ko'ra olasiz");
    }
    const [lines, pays] = await this.repo.details(id);
    return toSaleView(s, lines, pays, this.withCost(user));
  }

  /** Ro'yxat: kassir faqat o'zinikini, view_analytics/manage_users hammasini (TZ 9.6). 4 ta so'rov. */
  async list(user: AuthUser, branchId: string, q: SalesListQuery) {
    const [items, total] = await this.repo.list(branchId, this.seeAll(user) ? q.cashierId : user.id, q);
    const [lines, pays] = await this.repo.detailsMany(items.map((s) => s.id));
    return page(toSaleList(items, lines, pays, this.withCost(user)), total, q);
  }
}
