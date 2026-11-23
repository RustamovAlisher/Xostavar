import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { conflict, forbidden, isUniqueViolation, notFound, unprocessable } from '../../../common/errors/app-error.js';
import { dayKey, qty4 } from '../../../common/utils/numbers.js';
import { OWN_USE_CATEGORY, OWN_USE_REF, OWN_USE_VOID_REF } from '../../../common/constants/own-use.js';
import { page } from '../../../common/utils/pagination.js';
import { calcLine, factorOf, priceOf } from '../../../common/utils/pricing.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { CurrencyService } from '../../currency/services/currency.service.js';
import { NotifyService } from '../../telegram/services/notify.service.js';
import { CustomersService } from '../../customers/services/customers.service.js';
import { InventoryService } from '../../inventory/services/inventory.service.js';
import { SettingsService } from '../../settings/services/settings.service.js';
import { ShiftsService } from '../../shifts/services/shifts.service.js';
import type { DebtPaymentDto } from '../../customers/dto/customers.dto.js';
import type { OwnUseDto, OwnUseListQuery, SaleDto, SalesListQuery } from '../dto/sales.dto.js';
import { toQuoteView, toSaleList, toSaleView, type QuotedLine, type QuoteWarning } from '../mappers/sales.mapper.js';
import { SalesRepository } from '../repositories/sales.repository.js';

export type { QuotedLine, SaleView } from '../mappers/sales.mapper.js';

/** Audit uchun: kassir narxini o'zgartirgan qatorlar («narx o'zgartirildi: Armatura 37 000 → 36 500»). */
function priceNote(lines: QuotedLine[]): string {
  const ch = lines.filter((l) => l.lineTotal !== l.listTotal);
  if (!ch.length) return '';
  return `; narx o'zgartirildi: ${ch.slice(0, 5).map((l) => `${l.name}${l.variantName ? ` (${l.variantName})` : ''} ${l.listUnitPrice.toLocaleString('ru-RU')} → ${l.unitPrice.toLocaleString('ru-RU')}`).join(', ')}${ch.length > 5 ? ` va yana ${ch.length - 5} ta` : ''}`;
}

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
    private readonly currency: CurrencyService,
    private readonly notify: NotifyService,
  ) {}

  /** Hammasini yoki faqat o'z cheklarini ko'rish (TZ 9.6). */
  private seeAll = (user: AuthUser) => user.permissions.includes('view_all_sales');
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
      const overridden = l.lineTotal != null || l.unitPrice != null;
      if (priceOf(target, l.unit) <= 0 && !overridden) throw unprocessable('price_missing', `"${t.product.name}" uchun ${l.unit} narxi belgilanmagan`);
      const calc = calcLine(target, l.unit, l.qty, l.cuts, { cutDeductionMode: rules.cutDeductionMode, pieceLengthMeters: Number(rules.pieceLengthMeters) }, unitById.get(l.unit)!.precision);
      const listUnitPrice = calc.unitPrice;
      const listTotal = calc.lineTotal;
      // Kassir narxni (yoki qator summasini) o'zgartirgan: faqat shu chek uchun, katalog narxi o'zgarmaydi
      if (l.lineTotal != null) {
        calc.lineTotal = l.lineTotal;
        calc.unitPrice = calc.qty > 0 ? Math.round(l.lineTotal / calc.qty) : listUnitPrice;
      } else if (l.unitPrice != null) {
        calc.unitPrice = l.unitPrice;
        calc.lineTotal = Math.round(l.unitPrice * calc.qty);
      }
      if (calc.qty <= 0 || calc.lineTotal <= 0) throw unprocessable('validation_failed', `"${t.product.name}": miqdor yoki summa 0`);
      return { ...calc, listUnitPrice, listTotal, productId: l.productId, variantId: l.variantId ?? null, name: t.product.name, variantName: t.variant?.name ?? null, sku: t.variant?.sku ?? t.product.sku, categoryId: t.product.categoryId, available: lvl.stock, costPerBase: lvl.costPrice };
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
    return { rules, lines, subtotal, discount, total, profit, need, levels, warnings };
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
      // Narxni pasaytirish ham chegirma hisoblanadi (kassir chegirma limiti)
      const priceCut = q.lines.reduce((a, l) => a + Math.max(0, l.listTotal - l.lineTotal), 0);
      if (rules.cashierMaxDiscount > 0 && q.discount + priceCut > rules.cashierMaxDiscount && !user.permissions.includes('manage_users')) {
        throw unprocessable('discount_too_large', `Kassir uchun chegirma ko'pi bilan ${rules.cashierMaxDiscount.toLocaleString('ru-RU')} so'm`);
      }

      // To'lovlar (TZ 8.8): har usul yoqilgan, qarz usuli emas; Σ + nasiya = total
      const methods = await this.repo.paymentMethods(tx);
      const pays = (dto.payments ?? []).map((p) => {
        const m = methods.find((x) => x.id === p.methodId);
        if (!m) throw notFound("To'lov usuli", { methodId: p.methodId });
        if (!m.enabled) throw unprocessable('payment_method_disabled', `"${m.label}" usuli o'chirilgan`);
        if (m.kind === 'debt') throw unprocessable('validation_failed', "Nasiya to'lov qismi sifatida kiritilmaydi — onCredit=true yuboring");
        return { m, amount: Math.round(p.amount), amountUsd: p.amountUsd ?? null, ref: p.ref?.trim() || null };
      });
      // Dollar to'lov: so'm qiymati joriy kursga mos bo'lishi kerak (kassa ochiq turganda kurs yangilansa — 2 % gacha farqqa ruxsat)
      const usdRate = await this.currency.currentRate(tx);
      for (const p of pays) {
        if (p.amountUsd == null) continue;
        if (!usdRate) throw unprocessable('validation_failed', "Dollar kursi kiritilmagan — dollar bilan to'lov qabul qilib bo'lmaydi");
        const expected = p.amountUsd * usdRate;
        if (Math.abs(expected - p.amount) > Math.max(1_000, expected * 0.02)) {
          throw unprocessable('validation_failed', `Dollar to'lov ${p.amountUsd} $ joriy kurs bo'yicha ${Math.round(expected).toLocaleString('ru-RU')} so'm — sahifani yangilab qayta urinib ko'ring`, { usdRate });
        }
      }
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
        paymentSummary, subtotal: q.subtotal, discountAmount: q.discount, totalAmount: q.total, paidAmount: paid, remainingDebt: remaining, profit: q.profit, clientId: dto.clientId ?? null,
        usdRate,
      });
      await this.repo.insertLines(tx, q.lines.map((l, i) => ({ saleId, productId: l.productId, variantId: l.variantId, name: l.name, variantName: l.variantName, sku: l.sku, categoryId: l.categoryId, unit: l.unit, qty: l.qty, baseQty: l.baseQty, unitPrice: l.unitPrice, lineTotal: l.lineTotal, costPerBase: l.costPerBase, cuts: l.cuts ?? null, sortOrder: i })));
      if (pays.length) await this.repo.insertPayments(tx, pays.map((p) => ({ saleId, methodId: p.m.id, methodCode: p.m.code, kind: p.m.kind, amount: p.amount, amountUsd: p.amountUsd, ref: p.ref })));
      // Qoldiqni ayirish (qulflangan qatorlar): hammasi bitta UPDATE + bitta INSERT
      await this.inventory.applyMovements(tx, [...q.need].map(([key, need]) => {
        const lvl = q.levels.get(key)!;
        const l = q.lines.find((x) => `${x.productId}|${x.variantId ?? ''}` === key)!;
        return { lvl, m: { branchId, productId: l.productId, variantId: l.variantId, type: 'sale' as const, qtyBase: -need, unit: l.unit, qtyUnit: -need, costPerBase: lvl.costPrice, refType: 'sale', refId: saleId, userId: user.id } };
      }));
      // Nasiya
      if (remaining > 0 && customer) {
        const r = await this.customers.applyDebt(tx, { customerId: customer.id, branchId, type: 'sale_debt', amount: remaining, refType: 'sale', refId: saleId, userId: user.id, dueDays: rules.defaultCreditDays });
        await this.repo.updateSale(tx, saleId, { customerDebtAfter: r.after });
      }
      await this.audit.log(user, {
        action: 'sale', module: 'Kassa', targetId: saleId, targetName: `Chek ${number} · ${customer?.name ?? 'Oddiy mijoz'}`, branchId, requestId,
        details: remaining > 0 ? `Nasiya: jami ${q.total.toLocaleString('ru-RU')} so'm (${paid.toLocaleString('ru-RU')} to'landi + ${remaining.toLocaleString('ru-RU')} qarz)` : `Sotuv: ${q.total.toLocaleString('ru-RU')} so'm${q.discount ? `, chegirma ${q.discount.toLocaleString('ru-RU')}` : ''}${pays.length > 1 ? " (aralash to'lov)" : ''}${priceNote(q.lines)}`,
      }, tx);
      await this.notify.enqueue(tx, 'sale', saleId, branchId);
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

  /* ───────── O'zimga olish (kassadan mol egasi hisobiga) ───────── */

  /**
   * Savatdagi mollar sotilmaydi, pul olinmaydi: ombordan chiqariladi (`write_off`) va TANNARXDA «O'zimga olingan»
   * xarajatiga yoziladi. Sotuv/tushum/foyda/smena hisobiga ta'sir qilmaydi (xarajat manbasi `other` — kassadagi naqd kamaymaydi).
   * Telegram botga xabar ketadi. Bekor qilish: `ownUseVoid` (qoldiq qaytadi). Hamma xodim (view_pos) qila oladi.
   */
  async ownUse(user: AuthUser, branchId: string, dto: OwnUseDto, requestId?: string) {
    return runTx(this.db, async (tx) => {
      const branch = await this.repo.lockBranch(tx, branchId);
      const q = await this.quoteLines(tx, branchId, { lines: dto.lines }, true);
      const methods = await this.repo.paymentMethods(tx);
      // Xarajat jadvalida usul majburiy; pul harakatlanmaydi (manba `other`), shuning uchun naqd usul yoziladi
      const method = methods.find((m) => m.kind === 'cash' && m.enabled) ?? methods.find((m) => m.enabled && m.kind !== 'debt');
      if (!method) throw unprocessable('payment_method_disabled', "Yoqilgan to'lov usuli yo'q");
      const cat = await this.repo.ensureCategory(tx, OWN_USE_CATEGORY);

      // Xarajatga TANNARX yoziladi (sotuv narxi olinmaydi): har qator = asosiy birlikdagi miqdor × tannarx.
      // Tannarxi hali kiritilmagan mahsulotda qiymatni bilib bo'lmaydi — shu qatorda kassadagi narx olinadi.
      const valued = q.lines.map((l) => {
        const value = Math.round(l.costPerBase != null && l.costPerBase > 0 ? l.baseQty * l.costPerBase : l.lineTotal);
        return { l, value, unitValue: l.qty > 0 ? Math.round(value / l.qty) : 0 };
      });
      const amount = Math.max(1, valued.reduce((a, v) => a + v.value, 0));
      const shortOf = new Map((await this.repo.units(tx)).map((u) => [u.id, u.short]));
      const unitName = (u: string) => shortOf.get(u) ?? u;
      const list = q.lines.map((l) => `${l.name}${l.variantName ? ` (${l.variantName})` : ''} — ${qty4(l.qty).toLocaleString('ru-RU')} ${unitName(l.unit)}`).join('; ');
      const note = `${dto.note?.trim() ? `${dto.note.trim()}. ` : ''}Ombordan olindi: ${list}`.slice(0, 480);
      const expenseId = await this.repo.insertExpense(tx, {
        branchId, date: dayKey(new Date()), categoryId: cat.id, amount, methodId: method.id, source: 'other', shiftId: null, supplierId: null,
        note, createdBy: user.id, createdByName: user.name,
      });
      for (const [key, need] of q.need) {
        const lvl = q.levels.get(key)!;
        const l = q.lines.find((x) => `${x.productId}|${x.variantId ?? ''}` === key)!;
        await this.inventory.applyMovement(tx, lvl, { branchId, productId: l.productId, variantId: l.variantId, type: 'write_off', qtyBase: -need, unit: l.unit, qtyUnit: -need, costPerBase: lvl.costPrice, refType: OWN_USE_REF, refId: expenseId, userId: user.id });
      }
      await this.audit.log(user, { action: 'expense', module: 'Xarajatlar', targetId: expenseId, targetName: OWN_USE_CATEGORY, branchId, requestId, details: `O'zimga olindi: ${amount.toLocaleString('ru-RU')} so'm. ${list}` }, tx);
      await this.notify.enqueueOwnUse(tx, expenseId, branchId, {
        branchName: branch?.name ?? '', userName: user.name, createdAt: new Date().toISOString(), amount,
        lines: valued.map(({ l, value, unitValue }) => ({ name: l.name, variantName: l.variantName, qty: l.qty, unit: unitName(l.unit), unitPrice: unitValue, lineTotal: value, cuts: l.cuts ?? null })),
      });
      return { id: expenseId, amount, lines: q.lines.length };
    });
  }

  /** «O'zimga olingan» yozuvlar: hammasini ko'rish huquqi bo'lmasa — faqat o'zi olganlari. */
  async ownUseList(user: AuthUser, branchId: string, q: OwnUseListQuery) {
    const userId = this.seeAll(user) ? q.userId : user.id;
    const [items, totals] = await Promise.all([
      this.repo.ownUseRows(branchId, OWN_USE_CATEGORY, { from: q.from, to: q.to, userId }),
      this.repo.ownUseTotals(branchId, OWN_USE_CATEGORY, { from: q.from, to: q.to, userId }),
    ]);
    return { items, ...totals };
  }

  /** O'zimga olishni bekor qilish: ombor qoldig'i qaytadi, xarajat o'chiriladi. Yozgan xodim yoki administrator. */
  async ownUseVoid(user: AuthUser, branchId: string, id: string, requestId?: string) {
    await runTx(this.db, async (tx) => {
      await this.repo.lockBranch(tx, branchId);
      const e = await this.repo.findExpenseForUpdate(tx, id);
      if (!e) throw notFound('Yozuv');
      const cat = await this.repo.ensureCategory(tx, OWN_USE_CATEGORY);
      if (e.categoryId !== cat.id) throw unprocessable('validation_failed', "Bu «O'zimga olingan» yozuvi emas");
      if (e.branchId !== branchId) throw forbidden("Boshqa filial yozuvi", 'branch_forbidden');
      if (e.voidedAt) throw conflict('already_voided', 'Bu yozuv allaqachon bekor qilingan');
      if (e.createdBy !== user.id && !user.permissions.includes('manage_users')) throw forbidden("Boshqa xodim yozgan yozuvni faqat administrator bekor qiladi");
      const moves = await this.repo.ownMovements(tx, id, OWN_USE_REF);
      const levels = await this.inventory.lockLevels(tx, branchId, moves.map((m) => ({ productId: m.productId, variantId: m.variantId })), true);
      for (const m of moves) {
        const key = `${m.productId}|${m.variantId ?? ''}`;
        await this.inventory.applyMovement(tx, levels.get(key)!, { branchId, productId: m.productId, variantId: m.variantId, type: 'adjustment', qtyBase: -Number(m.qtyBase), unit: m.unit, qtyUnit: -Number(m.qtyUnit), costPerBase: m.costPerBase == null ? null : Number(m.costPerBase), refType: OWN_USE_VOID_REF, refId: id, userId: user.id });
      }
      await this.repo.voidExpenseRow(tx, id, user.id);
      await this.audit.log(user, { action: 'delete', module: 'Xarajatlar', targetId: id, targetName: OWN_USE_CATEGORY, branchId, requestId, details: `O'zimga olish bekor qilindi: ${e.amount.toLocaleString('ru-RU')} so'm, qoldiq qaytarildi` }, tx);
    });
    return { id, voided: true };
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
      // Savdoga bog'langan to'lov: shu chekning qolgan qarzidan oshmasin (umumiy to'lov — FIFO, tekshiruv applyDebt da)
      let forSale = '';
      if (dto.saleId) {
        const t = await this.customers.saleDebtLeft(tx, customerId, dto.saleId);
        if (t.left <= 0) throw unprocessable('validation_failed', `Chek ${t.number} bo'yicha qarz yo'q`);
        if (amount > t.left) throw unprocessable('validation_failed', `Summa chek ${t.number} qarzidan katta (${t.left.toLocaleString('ru-RU')} so'm)`);
        forSale = `, chek ${t.number} uchun`;
      }
      const saleId = await this.repo.insertSale(tx, { branchId, number, type: 'debt_payment', shiftId, cashierId: user.id, cashierName: user.name, customerId, customerName: '', paymentSummary: m.code, subtotal: amount, totalAmount: amount, paidAmount: amount, debtSaleId: dto.saleId ?? null });
      const r = await this.customers.applyDebt(tx, { customerId, branchId, type: 'payment', amount: -amount, refType: 'debt_payment', refId: saleId, userId: user.id, markPaid: true });
      await this.repo.updateSale(tx, saleId, { customerName: r.customer.name, customerDebtAfter: r.after });
      await this.repo.insertPayments(tx, [{ saleId, methodId: m.id, methodCode: m.code, kind: m.kind, amount }]);
      await this.audit.log(user, { action: 'debt_payment', module: 'Nasiya / Qarz', targetId: customerId, targetName: r.customer.name, branchId, requestId, details: `To'lov: ${amount.toLocaleString('ru-RU')} so'm (${m.label.toLowerCase()})${forSale}, qoldiq ${r.after.toLocaleString('ru-RU')} so'm` }, tx);
      await this.notify.enqueue(tx, 'debt_payment', saleId, branchId);
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
      await this.notify.enqueue(tx, 'void', id, branchId);
    });
    return this.get(user, id);
  }

  /**
   * Nasiya chekdan bitta mahsulotni olib tashlash (qisman qaytarish): ombor qoldig'i qaytadi, chek summasi (chegirma ulushi bilan)
   * va mijoz qarzi shuncha kamayadi. Mijoz bu chek uchun allaqachon to'lagan pulga tegilmaydi: mahsulot summasi chekning
   * qolgan qarzidan oshmasa ruxsat; aks holda butun chek bekor qilinadi (naqd qaytarish bilan). Qator o'chadi, izi auditda qoladi.
   */
  async removeLine(user: AuthUser, branchId: string, id: string, lineId: string, reason: string, requestId?: string) {
    await runTx(this.db, async (tx) => {
      await this.repo.lockBranch(tx, branchId);
      const s = await this.repo.lockById(tx, id);
      if (!s) throw notFound('Chek');
      if (s.branchId !== branchId) throw forbidden("Boshqa filial chekini o'zgartira olmaysiz", 'branch_forbidden');
      if (s.type !== 'sale') throw unprocessable('validation_failed', 'Faqat sotuv chekidan mahsulot olib tashlanadi');
      if (s.status === 'voided') throw conflict('already_voided', 'Bu chek bekor qilingan');
      if (!s.customerId || s.remainingDebt <= 0) throw unprocessable('validation_failed', "Faqat nasiyali (qarzi bor) chekdan mahsulot olib tashlanadi — boshqa chekni bekor qiling");
      const lines = await this.repo.lines(tx, id);
      const line = lines.find((l) => l.id === lineId);
      if (!line) throw notFound('Chek qatori');
      if (lines.length < 2) throw unprocessable('validation_failed', "Chekda bitta mahsulot qolgan — butun chekni bekor qiling");

      // Mahsulot summasi chegirma ulushini ayirib: Σ to'langan + qarz = jami tengligi saqlanadi
      const lineTotal = Number(line.lineTotal);
      const share = s.subtotal > 0 ? Math.round((s.discountAmount * lineTotal) / s.subtotal) : 0;
      const value = lineTotal - share;
      const cost = Math.round(Number(line.costPerBase ?? 0) * Number(line.baseQty));

      // Qulf tartibi void bilan bir xil: filial → chek → qoldiq → mijoz
      const levels = await this.inventory.lockLevels(tx, branchId, [{ productId: line.productId, variantId: line.variantId }], true);
      const { left, number } = await this.customers.saleDebtLeft(tx, s.customerId, id);
      if (value > left) {
        throw unprocessable('validation_failed', `Mahsulot summasi (${value.toLocaleString('ru-RU')} so'm) chekning qolgan qarzidan (${left.toLocaleString('ru-RU')} so'm) katta — mijoz to'lagan pulni qaytarish uchun butun chekni bekor qiling`);
      }
      const key = `${line.productId}|${line.variantId ?? ''}`;
      await this.inventory.applyMovement(tx, levels.get(key)!, { branchId, productId: line.productId, variantId: line.variantId, type: 'sale_void', qtyBase: qty4(Number(line.baseQty)), unit: line.unit, qtyUnit: qty4(Number(line.qty)), refType: 'sale', refId: id, userId: user.id });
      const r = await this.customers.applyDebt(tx, { customerId: s.customerId, branchId, type: 'sale_void', amount: -value, refType: 'sale', refId: id, userId: user.id });
      await this.repo.deleteLine(tx, lineId);
      await this.repo.updateSale(tx, id, {
        subtotal: s.subtotal - lineTotal, discountAmount: s.discountAmount - share, totalAmount: s.totalAmount - value,
        remainingDebt: s.remainingDebt - value, profit: s.profit - (value - cost), customerDebtAfter: r.after,
      });
      await this.shifts.refreezeIfClosed(tx, s.shiftId);
      await this.audit.log(user, {
        action: 'edit', module: 'Kassa', targetId: id, targetName: `Chek ${number} · ${s.customerName}`, branchId, requestId,
        details: `Mahsulot olib tashlandi: ${line.name}${line.variantName ? ` (${line.variantName})` : ''} ${Number(line.qty)} ${line.unit}, ${value.toLocaleString('ru-RU')} so'm; mijoz qarzi ${(-r.applied).toLocaleString('ru-RU')} so'mga kamaydi${reason ? `. Sabab: ${reason}` : ''}`,
      }, tx);
    });
    return this.get(user, id);
  }

  /** Kassa kategoriyalarini «eng ko'p sotiladigan birinchi» tartiblash uchun: oxirgi 90 kun, sotuv qatorlari soni (summa ochilmaydi). */
  async categoryRank(branchId: string) {
    const rows = await this.repo.categoryRank(branchId, 90);
    return { days: 90, items: rows.map((r) => ({ categoryId: r.categoryId as string, lines: r.lines })) };
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

  /** Ro'yxat: kassir faqat o'zinikini, `view_all_sales` hammasini (TZ 9.6). 4 ta so'rov. */
  async list(user: AuthUser, branchId: string, q: SalesListQuery) {
    const cashier = this.seeAll(user) ? q.cashierId : user.id;
    const [[items, total], summary, ownUse] = await Promise.all([
      this.repo.list(branchId, cashier, q), this.repo.summary(branchId, cashier, q),
      this.repo.ownUseTotals(branchId, OWN_USE_CATEGORY, { from: q.from, to: q.to, userId: cashier }),
    ]);
    const [lines, pays] = await this.repo.detailsMany(items.map((s) => s.id));
    // «O'zimga olingan» sotuv summasiga kirmaydi — alohida (Sotuvlar sahifasida «O'zimga» bo'limi)
    return { ...page(toSaleList(items, lines, pays, this.withCost(user)), total, q), summary: { ...summary, ownUse } };
  }
}
