import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { conflict, notFound, unprocessable } from '../../../common/errors/app-error.js';
import { qty4, todayISO } from '../../../common/utils/numbers.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { SupplierDto, SupplierListQuery, SupplierManualDebtDto, SupplierPaymentDto, SupplierSetDebtDto } from '../dto/suppliers.dto.js';
import { SuppliersRepository, type SupplierRow } from '../repositories/suppliers.repository.js';
import { allocateCredits, type DebtItem } from './supplier-allocation.js';

const fmt = (n: number) => n.toLocaleString('ru-RU');

const toView = (s: SupplierRow) => ({ id: s.id, name: s.name, phone: s.phone, note: s.note, totalDebt: s.totalDebt, createdAt: s.createdAt.toISOString() });

/**
 * Yetkazib beruvchilar bilan hisob-kitob: bizning ularga qarzimiz (kreditorlik).
 * Qarz faqat `supplier_ledger` orqali o'zgaradi (yozuv + `suppliers.total_debt` bitta tranzaksiyada, qator qulflanadi).
 */
@Injectable()
export class SuppliersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: SuppliersRepository,
    private readonly audit: AuditService,
  ) {}

  /* ───────── Ro'yxat va karta ───────── */

  async list(q: SupplierListQuery) {
    const rows = await this.repo.list(q);
    const items = rows.map((r) => ({ ...toView(r.s), purchasesCount: r.purchasesCount, lastPurchaseDate: r.lastPurchaseDate, lastPaymentDate: r.lastPaymentDate }));
    const debtors = items.filter((i) => i.totalDebt > 0);
    return { items, summary: { totalDebt: debtors.reduce((a, i) => a + i.totalDebt, 0), debtors: debtors.length, suppliers: items.length } };
  }

  async get(id: string, db: DbOrTx = this.db) {
    const s = await this.repo.find(id, db);
    if (!s) throw notFound('Yetkazib beruvchi');
    return toView(s);
  }

  /** Karta: kirimlar (qaysi tovar, qancha, qancha to'langan, qancha qolgan) va to'lovlar jurnali. */
  async profile(id: string) {
    const s = await this.repo.find(id);
    if (!s) throw notFound('Yetkazib beruvchi');
    const [receipts, debtReceipts, manual, credits, ledger] = await Promise.all([
      this.repo.receipts(id), this.repo.debtReceipts(id), this.repo.manualDebts(id), this.repo.creditsTotal(id), this.repo.ledger(id),
    ]);
    const lines = await this.repo.receiptLinesOf(receipts.map((r) => r.r.id));
    const sold = await this.soldByLine(lines);
    const linesOf = new Map<string, typeof lines>();
    for (const l of lines) linesOf.set(l.receiptId, [...(linesOf.get(l.receiptId) ?? []), l]);
    const items: DebtItem[] = [
      ...debtReceipts.map((r) => ({ key: `r:${r.id}`, at: r.date, amount: r.debt })),
      ...manual.map((m) => ({ key: `a:${m.id}`, at: m.date, amount: m.amount })),
    ];
    const alloc = allocateCredits(items, credits);
    return {
      supplier: toView(s),
      purchases: receipts.map(({ r, branchName }) => {
        const total = Math.round(Number(r.totalCost));
        const a = alloc.get(`r:${r.id}`);
        return {
          id: r.id, number: r.number, date: r.date, invoice: r.invoice, note: r.note, branchId: r.branchId, branchName, userName: r.userName,
          total, paidAtReceipt: r.paidAmount, debt: r.debtAmount, left: a?.left ?? 0,
          /** false — eski kirim: qarz hisobi yuritilmagan (to'liq to'langan deb olinadi). */
          tracked: r.paidAmount != null,
          lines: (linesOf.get(r.id) ?? []).map((l) => {
            const qty = Number(l.qty);
            const base = Number(l.qtyBase);
            const soldQty = base > 0 ? qty4(Math.min(qty, (sold.get(l.id) ?? 0) / (base / qty))) : 0;
            return { id: l.id, productId: l.productId, variantId: l.variantId, productName: l.productName, sku: l.sku, unit: l.unit, qty, sold: soldQty, left: qty4(qty - soldQty), costPerUnit: Number(l.costPerUnit), totalCost: Number(l.totalCost) };
          }),
        };
      }),
      oldDebts: manual.map((m) => ({ id: m.id, date: m.date, amount: m.amount, note: m.note, left: alloc.get(`a:${m.id}`)?.left ?? 0 })),
      ledger: ledger.map(({ l, method }) => ({ id: l.id, type: l.type, amount: l.amount, balanceAfter: l.balanceAfter, date: l.date, method, note: l.note, refType: l.refType, refId: l.refId, createdAt: l.createdAt.toISOString() })),
    };
  }

  /**
   * Har kirim qatorining qancha qismi sotilgan (asosiy birlikda): shu mahsulot (filial, variant) bo'yicha jami chiqim
   * kirimlarga eng eskisidan boshlab taqsimlanadi (FIFO). Kirim hujjatisiz qoldiq (qo'lda tuzatish) hisobga olinmaydi — taxminiy.
   */
  private async soldByLine(lines: { id: string; productId: string }[]): Promise<Map<string, number>> {
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const [all, outs] = await Promise.all([this.repo.flowLines(productIds), this.repo.outflows(productIds)]);
    const key = (x: { branchId: string; productId: string; variantId: string | null }) => `${x.branchId}|${x.productId}|${x.variantId ?? ''}`;
    const pool = new Map(outs.map((o) => [key(o), Math.max(0, Number(o.out))]));
    const sold = new Map<string, number>();
    for (const l of all) {
      const k = key(l);
      const take = Math.min(pool.get(k) ?? 0, Number(l.qtyBase));
      pool.set(k, (pool.get(k) ?? 0) - take);
      sold.set(l.id, take);
    }
    return sold;
  }

  /* ───────── Yetkazib beruvchi yozuvi ───────── */

  async create(user: AuthUser, dto: SupplierDto) {
    const name = dto.name.trim();
    const row = await runTx(this.db, async (tx) => {
      if (await this.repo.findByName(tx, name)) throw conflict('duplicate_code', `"${name}" nomli yetkazib beruvchi bor`);
      const r = await this.repo.insert(tx, { name, phone: dto.phone?.trim() || null, note: dto.note?.trim() || null });
      await this.audit.log(user, { action: 'add', module: 'Yetkazib beruvchilar', targetId: r.id, targetName: r.name, details: "Yetkazib beruvchi qo'shildi" }, tx);
      return r;
    });
    return toView(row);
  }

  async update(user: AuthUser, id: string, dto: SupplierDto) {
    const name = dto.name.trim();
    await runTx(this.db, async (tx) => {
      const s = await this.repo.lock(tx, id);
      if (!s) throw notFound('Yetkazib beruvchi');
      const same = await this.repo.findByName(tx, name);
      if (same && same.id !== id) throw conflict('duplicate_code', `"${name}" nomli yetkazib beruvchi bor`);
      await this.repo.update(tx, id, { name, phone: dto.phone?.trim() || null, note: dto.note?.trim() || null });
      await this.audit.log(user, { action: 'edit', module: 'Yetkazib beruvchilar', targetId: id, targetName: name, details: 'Yetkazib beruvchi ma\'lumoti tahrirlandi' }, tx);
    });
    return this.get(id);
  }

  /* ───────── Qarz harakati ───────── */

  /** Yetkazib beruvchi qatorini qulflab qarzni o'zgartiradi, jurnalga yozadi. Qaytaradi: yangi qoldiq. */
  async book(tx: DbOrTx, p: { supplierId: string; branchId?: string | null; type: 'purchase' | 'purchase_edit' | 'payment' | 'adjustment'; amount: number; date: string; methodId?: string | null; refType?: string; refId?: string; note?: string | null; userId: string }) {
    if (p.amount === 0) return null;
    const s = await this.repo.lock(tx, p.supplierId);
    if (!s) throw notFound('Yetkazib beruvchi');
    const balance = await this.repo.addDebt(tx, s.id, p.amount);
    if (balance == null) throw notFound('Yetkazib beruvchi');
    await this.repo.insertLedger(tx, { supplierId: s.id, branchId: p.branchId ?? null, type: p.type, amount: p.amount, balanceAfter: balance, date: p.date, methodId: p.methodId ?? null, refType: p.refType ?? null, refId: p.refId ?? null, note: p.note ?? null, userId: p.userId });
    return { supplier: s, before: balance - p.amount, after: balance };
  }

  /**
   * Kirim hujjatidan hisobga olingan qarzni haqiqiy holatga keltiradi (kirim yaratilganda, qatori tahrirlanganda,
   * o'chirilganda, yetkazib beruvchisi almashganda): kerakli qarz = max(0, jami − to'langan). `zero` — hujjat o'chirilmoqda.
   * To'langan summa null bo'lsa (eski kirim, qarzsiz kirim) hech narsa yozilmaydi.
   */
  async syncReceiptDebt(tx: DbOrTx, userId: string, receiptId: string, opts: { zero?: boolean } = {}) {
    const r = await this.repo.lockReceipt(tx, receiptId);
    if (!r) return;
    const total = Math.round(Number(r.totalCost));
    const wantSupplier = r.supplierId;
    const want = opts.zero || r.paidAmount == null || !wantSupplier ? 0 : Math.max(0, total - r.paidAmount);
    const oldSupplier = r.debtSupplierId;
    const old = r.debtAmount;
    if (oldSupplier === (want > 0 ? wantSupplier : null) && old === want) return;
    const common = { branchId: r.branchId, date: r.date, refType: 'stock_receipt', refId: r.id, userId };
    const note = `Kirim №${r.number}${r.invoice ? `, hujjat ${r.invoice}` : ''}`;
    if (oldSupplier && oldSupplier === wantSupplier && want > 0) {
      await this.book(tx, { ...common, supplierId: oldSupplier, type: 'purchase_edit', amount: want - old, note: `${note} tahrirlandi` });
    } else {
      if (oldSupplier && old !== 0) await this.book(tx, { ...common, supplierId: oldSupplier, type: 'purchase_edit', amount: -old, note: `${note}: qarz bekor qilindi` });
      if (want > 0 && wantSupplier) await this.book(tx, { ...common, supplierId: wantSupplier, type: 'purchase', amount: want, note });
    }
    await this.repo.setReceiptDebt(tx, r.id, { debtAmount: want, debtSupplierId: want > 0 ? wantSupplier : null });
  }

  /** To'lov berish: qarz kamayadi (qarzdan ko'p bo'lmaydi). */
  async pay(user: AuthUser, branchId: string, id: string, dto: SupplierPaymentDto) {
    await runTx(this.db, async (tx) => {
      const s = await this.repo.lock(tx, id);
      if (!s) throw notFound('Yetkazib beruvchi');
      if (dto.amount > s.totalDebt) throw unprocessable('validation_failed', `To'lov qarzdan katta (qarz ${fmt(Math.max(0, s.totalDebt))} so'm)`);
      let methodLabel = '';
      if (dto.methodId) {
        const m = await this.repo.findPaymentMethod(tx, dto.methodId);
        if (!m || !m.enabled || m.kind === 'debt') throw unprocessable('payment_method_disabled', "To'lov usuli noto'g'ri yoki o'chirilgan");
        methodLabel = m.label;
      }
      const date = dto.date ?? todayISO();
      const r = await this.book(tx, { supplierId: id, branchId, type: 'payment', amount: -dto.amount, date, methodId: dto.methodId, refType: 'supplier_payment', note: dto.note?.trim() || null, userId: user.id });
      await this.audit.log(user, { action: 'debt_payment', module: 'Yetkazib beruvchilar', targetId: id, targetName: s.name, branchId, details: `To'lov: ${fmt(dto.amount)} so'm${methodLabel ? ` (${methodLabel.toLowerCase()})` : ''}, qoldiq qarz ${fmt(r!.after)} so'm${dto.note ? ` — ${dto.note.trim()}` : ''}` }, tx);
    });
    return this.profile(id);
  }

  /** Qo'lda qarz qo'shish (kirimsiz: eski daftar, kelishuv). */
  async addDebt(user: AuthUser, branchId: string, id: string, dto: SupplierManualDebtDto) {
    await runTx(this.db, async (tx) => {
      const s = await this.repo.lock(tx, id);
      if (!s) throw notFound('Yetkazib beruvchi');
      const r = await this.book(tx, { supplierId: id, branchId, type: 'adjustment', amount: dto.amount, date: dto.date ?? todayISO(), refType: 'manual', note: dto.note?.trim() || 'Eski qarz', userId: user.id });
      await this.audit.log(user, { action: 'edit', module: 'Yetkazib beruvchilar', targetId: id, targetName: s.name, branchId, details: `Qarz qo'shildi: +${fmt(dto.amount)} so'm, jami ${fmt(r!.after)} so'm${dto.note ? ` — ${dto.note.trim()}` : ''}` }, tx);
    });
    return this.profile(id);
  }

  /** Umumiy qarzni yangi summaga o'rnatish: farq `adjustment` sifatida yoziladi. */
  async setDebt(user: AuthUser, branchId: string, id: string, dto: SupplierSetDebtDto) {
    await runTx(this.db, async (tx) => {
      const s = await this.repo.lock(tx, id);
      if (!s) throw notFound('Yetkazib beruvchi');
      const delta = dto.amount - s.totalDebt;
      if (delta === 0) return;
      await this.book(tx, { supplierId: id, branchId, type: 'adjustment', amount: delta, date: todayISO(), refType: 'manual', note: dto.note?.trim() || 'Qarz tuzatildi', userId: user.id });
      await this.audit.log(user, { action: 'edit', module: 'Yetkazib beruvchilar', targetId: id, targetName: s.name, branchId, details: `Qarz tuzatildi: ${fmt(s.totalDebt)} → ${fmt(dto.amount)} so'm${dto.note ? ` — ${dto.note.trim()}` : ''}` }, tx);
    });
    return this.profile(id);
  }
}
