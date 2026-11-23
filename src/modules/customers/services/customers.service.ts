import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { conflict, isUniqueViolation, notFound, unprocessable } from '../../../common/errors/app-error.js';
import { addDays, canonicalPhone, todayISO } from '../../../common/utils/numbers.js';
import { page } from '../../../common/utils/pagination.js';
import { assertVersion } from '../../../common/utils/version.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { SettingsService } from '../../settings/services/settings.service.js';
import type { CustomerDto, CustomerListQuery, ManualDebtDto, SetDebtDto } from '../dto/customers.dto.js';
import { toCustomerView, type CustomerView } from '../mappers/customers.mapper.js';
import { CustomersRepository, type CustomerInsert, type DebtLedgerInsert } from '../repositories/customers.repository.js';
import { allocateDebt } from './debt-allocation.js';

export type { CustomerView } from '../mappers/customers.mapper.js';

/** Mijozlar umumiy (TZ 7.5): istalgan filialdan xarid, qarz va limit umumiy. */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: CustomersRepository,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** Ro'yxat: 2 ta so'rov (mijozlar + guruh join, jami). Tartib: muddati o'tganlar, keyin qarz kamayishi bo'yicha. */
  async list(q: CustomerListQuery) {
    const today = todayISO();
    const [rows, total] = await this.repo.list(q, today);
    return page(rows.map((r) => toCustomerView(r.c, r.g, today)), total, q);
  }

  async get(id: string, db?: DbOrTx): Promise<CustomerView> {
    const r = await this.repo.findWithGroup(id, db);
    if (!r) throw notFound('Mijoz');
    return toCustomerView(r.c, r.g);
  }

  private async assertPhoneFree(tx: DbOrTx, phone: string, exceptId?: string) {
    const dup = await this.repo.findByPhone(phone, exceptId, tx);
    if (dup) throw conflict('duplicate_code', `Bu telefon raqami allaqachon mavjud: ${dup.name}`);
  }

  /** Telefon ixtiyoriy: bo'sh bo'lsa null; kiritilgan bo'lsa to'liq bo'lishi shart. */
  private parsePhone(raw: string | null | undefined): string | null {
    if (!raw || !raw.replace(/\D/g, '').replace(/^998/, '')) return null;
    const phone = canonicalPhone(raw);
    if (!phone) throw unprocessable('validation_failed', "Telefon raqamini to'liq kiriting (+998 va 9 ta raqam)");
    return phone;
  }

  /** Unikal indeks `customers_phone_uq`: ikki kassir bir vaqtda bir raqam bilan yaratsa — ikkinchisi 409 (500 emas). */
  private phoneConflict(e: unknown): never {
    if (isUniqueViolation(e)) throw conflict('duplicate_code', 'Bu telefon raqami allaqachon mavjud');
    throw e;
  }

  async create(user: AuthUser, dto: CustomerDto): Promise<CustomerView> {
    const phone = this.parsePhone(dto.phone);
    const rules = await this.settings.getRules();
    const id = await runTx(this.db, async (tx) => {
      if (phone) await this.assertPhoneFree(tx, phone);
      const groupId = dto.groupId ?? (await this.repo.firstGroupId(tx));
      const c = await this.repo.insert(tx, { name: dto.name.trim(), phone, groupId, creditLimit: dto.creditLimit ?? rules.defaultCreditLimit, dueDate: dto.dueDate ?? addDays(todayISO(), rules.defaultCreditDays) });
      await this.audit.log(user, { action: 'add', module: 'Nasiya / Qarz', targetId: c.id, targetName: c.name, details: `Yangi mijoz, limit ${c.creditLimit.toLocaleString('ru-RU')} so'm` }, tx);
      return c.id;
    }).catch((e) => this.phoneConflict(e));
    return this.get(id);
  }

  async update(user: AuthUser, id: string, dto: CustomerDto): Promise<CustomerView> {
    const phone = this.parsePhone(dto.phone);
    await runTx(this.db, async (tx) => {
      const old = await this.repo.lockById(tx, id);
      if (!old) throw notFound('Mijoz');
      assertVersion(old.version, dto.version, 'Mijoz');
      if (phone) await this.assertPhoneFree(tx, phone, id);
      // total_debt faqat ledger orqali o'zgaradi; limit qarzdan kichik bo'lishi mumkin (keyingi nasiya rad etiladi)
      const next = { name: dto.name.trim(), phone, groupId: dto.groupId === undefined ? old.groupId : dto.groupId, creditLimit: dto.creditLimit ?? old.creditLimit, dueDate: dto.dueDate === undefined ? old.dueDate : dto.dueDate };
      await this.repo.update(tx, id, { ...next, version: old.version + 1 });
      await this.audit.log(user, {
        action: 'edit', module: 'Nasiya / Qarz', targetId: id, targetName: next.name, details: "Mijoz ma'lumotlari tahrirlandi",
        diff: { before: { telefon: old.phone, limit: old.creditLimit, muddat: old.dueDate }, after: { telefon: phone, limit: next.creditLimit, muddat: next.dueDate } },
      }, tx);
    }).catch((e) => this.phoneConflict(e));
    return this.get(id);
  }

  /**
   * Yumshoq o'chirish (TZ 8.11). Qarzi bor mijoz faqat `writeOff` bilan: qarz avval 0 ga tushiriladi —
   * jurnalga `adjustment` (refType `customer_delete`) yoziladi va auditda summa ko'rsatiladi. Tarix saqlanadi.
   */
  async remove(user: AuthUser, id: string, opts: { branchId?: string; writeOff?: boolean } = {}) {
    await runTx(this.db, async (tx) => {
      const c = await this.repo.lockById(tx, id);
      if (!c) throw notFound('Mijoz');
      let writtenOff = 0;
      if (c.totalDebt > 0) {
        if (!opts.writeOff || !opts.branchId) throw conflict('in_use', `Mijozning ${c.totalDebt.toLocaleString('ru-RU')} so'm qarzi bor — o'chirish uchun qarzni hisobdan chiqarishni tasdiqlang`);
        const r = await this.applyDebt(tx, { customerId: id, branchId: opts.branchId, type: 'adjustment', amount: -c.totalDebt, refType: 'customer_delete', refId: randomUUID(), userId: user.id, note: "Mijoz o'chirildi — qarz hisobdan chiqarildi" });
        writtenOff = -r.applied;
      }
      await this.repo.softDelete(tx, id, c.phone);
      await this.audit.log(user, {
        action: 'delete', module: 'Nasiya / Qarz', targetId: id, targetName: c.name, branchId: opts.branchId,
        details: writtenOff > 0 ? `Mijoz o'chirildi, ${writtenOff.toLocaleString('ru-RU')} so'm qarz hisobdan chiqarildi` : "Mijoz o'chirildi",
        ...(writtenOff > 0 ? { diff: { before: { qarz: writtenOff }, after: { qarz: 0 } } } : {}),
      }, tx);
    });
  }

  /** Qarzni tahrirlash: umumiy qarzni `dto.amount` ga o'rnatadi. Farq (+/−) `adjustment` (refType `manual_edit`) bilan yoziladi. */
  async setDebt(user: AuthUser, branchId: string, id: string, dto: SetDebtDto): Promise<CustomerView> {
    const target = Math.round(dto.amount);
    const note = dto.note?.trim() || null;
    const rules = await this.settings.getRules();
    await runTx(this.db, async (tx) => {
      const c = await this.repo.lockById(tx, id);
      if (!c) throw notFound('Mijoz');
      const delta = target - c.totalDebt;
      if (delta === 0) return;
      const r = await this.applyDebt(tx, { customerId: id, branchId, type: 'adjustment', amount: delta, refType: 'manual_edit', refId: randomUUID(), userId: user.id, note: note ?? 'Qarz tahrirlandi' });
      if (r.after > 0 && !c.dueDate) await this.repo.setDueDate(tx, id, addDays(todayISO(), rules.defaultCreditDays));
      await this.audit.log(user, {
        action: 'edit', module: 'Nasiya / Qarz', targetId: id, targetName: c.name, branchId,
        details: `Qarz tahrirlandi: ${r.before.toLocaleString('ru-RU')} → ${r.after.toLocaleString('ru-RU')} so'm (${delta > 0 ? '+' : ''}${delta.toLocaleString('ru-RU')})${note ? `, sabab: ${note}` : ''}`,
        diff: { before: { qarz: r.before }, after: { qarz: r.after } },
      }, tx);
    });
    return this.get(id);
  }

  /* ───────── Qarz jurnali (sotuv va to'lov servisi chaqiradi) ───────── */

  /** Mijoz qatorini qulflab qarzni o'zgartiradi, ledger yozadi. Qaytaradi: yangi qarz. */
  async applyDebt(tx: DbOrTx, p: { customerId: string; branchId: string; type: DebtLedgerInsert['type']; amount: number; refType: string; refId: string; userId: string; dueDays?: number; markPaid?: boolean; capAtZero?: boolean; note?: string | null }) {
    const c = await this.repo.lockById(tx, p.customerId);
    if (!c) throw notFound('Mijoz');
    let amount = p.amount;
    // Storno: mijoz chekdan keyin qisman to'lagan bo'lsa qarz 0 gacha kamayadi, ortig'i naqd qaytariladi (chaqiruvchi auditga yozadi)
    if (p.capAtZero && c.totalDebt + amount < 0) amount = -c.totalDebt;
    if (c.totalDebt + amount < 0) throw unprocessable('validation_failed', `Summa qarzdan katta (${c.totalDebt.toLocaleString('ru-RU')} so'm)`);
    const set: Partial<Pick<CustomerInsert, 'dueDate' | 'lastPaidDate'>> = {};
    if (p.amount > 0 && p.dueDays != null) {
      // TZ 8.8: due_date = max(joriy muddat, bugun + N); muddat o'tgan bo'lsa yangi sana
      const today = todayISO();
      const next = addDays(today, p.dueDays);
      set.dueDate = c.dueDate && c.dueDate > next && c.dueDate >= today ? c.dueDate : next;
    }
    if (p.markPaid) set.lastPaidDate = todayISO();
    // Balans atomar yangilanadi (o'qib-yozish emas): qulf bilan birga ikki qavat himoya; natija ledger ga yoziladi
    const balance = await this.repo.addDebt(tx, c.id, amount, set);
    if (balance == null) throw unprocessable('validation_failed', `Summa qarzdan katta (${c.totalDebt.toLocaleString('ru-RU')} so'm)`);
    if (amount !== 0) await this.repo.insertLedger(tx, { customerId: c.id, branchId: p.branchId, type: p.type, amount, balanceAfter: balance, refType: p.refType, refId: p.refId, userId: p.userId, note: p.note ?? null });
    return { before: balance - amount, after: balance, applied: amount, customer: c };
  }

  /** Qo'lda qarz qo'shish (savdosiz: eski daftar, kelishuv): qarz oshadi, `adjustment` yozuvi ochiladi, kassaga tegmaydi. */
  async addManualDebt(user: AuthUser, branchId: string, id: string, dto: ManualDebtDto): Promise<CustomerView> {
    const amount = Math.round(dto.amount);
    const note = dto.note?.trim() || null;
    const rules = await this.settings.getRules();
    await runTx(this.db, async (tx) => {
      const r = await this.applyDebt(tx, { customerId: id, branchId, type: 'adjustment', amount, refType: 'manual', refId: randomUUID(), userId: user.id, note });
      if (r.after > 0) {
        const due = dto.dueDate ?? (r.customer.dueDate ? null : addDays(todayISO(), rules.defaultCreditDays));
        if (due) await this.repo.setDueDate(tx, id, due);
      }
      await this.audit.log(user, {
        action: 'edit', module: 'Nasiya / Qarz', targetId: id, targetName: r.customer.name, branchId,
        details: `Qo'lda qarz qo'shildi: +${amount.toLocaleString('ru-RU')} so'm${note ? ` (${note})` : ''}, jami ${r.after.toLocaleString('ru-RU')} so'm`,
        diff: { before: { qarz: r.before }, after: { qarz: r.after } },
      }, tx);
    });
    return this.get(id);
  }

  async ledger(id: string, q: { page: number; pageSize: number; offset: number }) {
    await this.get(id);
    const [items, total] = await this.repo.ledger(id, q);
    return page(items, total, q);
  }

  /* ───────── Mijoz profili: savdolar, har savdo bo'yicha qarz va to'lovlar ───────── */

  /** Qarzni savdolar bo'yicha taqsimlaydi (ledger qayta o'ynaladi, debt-allocation.ts). */
  private async allocation(id: string, tx: DbOrTx = this.db) {
    const [events, pays] = await Promise.all([this.repo.ledgerAll(id, tx), this.repo.debtPayments(id, tx)]);
    const target = new Map(pays.map((p) => [p.id, p.debtSaleId]));
    return { ...allocateDebt(events, (pid) => target.get(pid)), pays };
  }

  /** Bitta nasiya savdoning qolgan qarzi (to'lovni savdoga bog'lashda tekshirish; mijoz qatorini qulflaydi). */
  async saleDebtLeft(tx: DbOrTx, customerId: string, saleId: string): Promise<{ number: string; left: number }> {
    if (!(await this.repo.lockById(tx, customerId))) throw notFound('Mijoz'); // parallel to'lovlar bir-birini ko'rsin
    const s = await this.repo.findSaleHead(saleId, tx);
    if (!s || s.customerId !== customerId || s.type !== 'sale') throw notFound('Savdo');
    if (s.status !== 'completed') throw unprocessable('validation_failed', `Chek ${s.number} bekor qilingan`);
    const { items } = await this.allocation(customerId, tx);
    return { number: s.number, left: items.find((i) => i.saleId === saleId)?.outstanding ?? 0 };
  }

  /** Mijoz kartasi: ma'lumot, statistika, savdolar (qatorlar, to'lovlar, qarz holati), qarz to'lovlari va ularning taqsimoti. */
  async profile(id: string) {
    const customer = await this.get(id);
    const [{ items, bySource, pays }, list, stats, ledgerRows] = await Promise.all([
      this.allocation(id),
      this.repo.customerSales(id, 500),
      this.repo.saleStats(id),
      this.repo.ledgerAll(id),
    ]);
    const noteOf = new Map(ledgerRows.map((r) => [r.id, r.note]));
    const ids = list.map((s) => s.id);
    const [lines, payParts] = await Promise.all([this.repo.saleLinesFor(ids), this.repo.salePaymentsFor(ids)]);
    const byItem = new Map(items.map((i) => [i.saleId ?? i.key, i]));
    const payById = new Map(pays.map((p) => [p.id, p]));
    const numberOf = new Map(list.map((s) => [s.id, s.number]));
    const group = <T extends { saleId: string }>(rows: T[]) => {
      const m = new Map<string, Omit<T, 'saleId'>[]>();
      for (const { saleId, ...rest } of rows) { const a = m.get(saleId) ?? []; a.push(rest); m.set(saleId, a); }
      return m;
    };
    const linesBy = group(lines);
    const paysBy = group(payParts);

    const salesView = list.map((s) => {
      const it = byItem.get(s.id);
      const paidAlloc = it?.allocations.filter((a) => a.kind !== 'void') ?? [];
      return {
        id: s.id, number: s.number, createdAt: s.createdAt.toISOString(), branchId: s.branchId, cashierName: s.cashierName, status: s.status,
        voidReason: s.voidReason, subtotal: s.subtotal, discountAmount: s.discountAmount, totalAmount: s.totalAmount, paidAmount: s.paidAmount,
        lines: linesBy.get(s.id) ?? [],
        payments: paysBy.get(s.id) ?? [],
        debt: s.remainingDebt > 0
          ? {
              original: s.remainingDebt,
              paid: paidAlloc.reduce((a, x) => a + x.amount, 0),
              voided: (it?.allocations ?? []).filter((a) => a.kind === 'void').reduce((a, x) => a + x.amount, 0),
              outstanding: it?.outstanding ?? 0,
              payments: paidAlloc.map((a) => {
                const p = payById.get(a.sourceId);
                return { id: a.sourceId, kind: a.kind, amount: a.amount, at: a.at.toISOString(), number: p?.number ?? null, method: p?.paymentSummary ?? null, cashierName: p?.cashierName ?? null, targeted: p?.debtSaleId === s.id };
              }),
            }
          : null,
      };
    });

    const paymentsView = pays.map((p) => ({
      id: p.id, number: p.number, createdAt: p.createdAt.toISOString(), branchId: p.branchId, cashierName: p.cashierName, amount: p.amount,
      method: p.paymentSummary, status: p.status, debtSaleId: p.debtSaleId, debtAfter: p.debtAfter,
      allocations: (bySource.get(p.id) ?? []).map((a) => ({ saleId: a.saleId, number: a.saleId ? (numberOf.get(a.saleId) ?? null) : null, amount: a.amount })),
    }));

    // Qo'lda kiritilgan qarzlar (savdosiz bandlar): qachon, qancha, izoh, qanchasi yopilgan
    const manualDebts = items.filter((i) => !i.saleId).map((i) => {
      const ledgerId = i.key.replace(/^adj:/, '');
      return {
        id: ledgerId, createdAt: i.at.toISOString(), note: noteOf.get(ledgerId) ?? null, original: i.original, outstanding: i.outstanding,
        payments: i.allocations.map((a) => ({ id: a.sourceId, kind: a.kind, amount: a.amount, at: a.at.toISOString(), number: payById.get(a.sourceId)?.number ?? null })),
      };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const adjustmentsLeft = items.filter((i) => !i.saleId).reduce((a, i) => a + i.outstanding, 0);
    return {
      customer,
      stats: {
        salesCount: stats.count, voidedCount: stats.voided, totalSpent: Number(stats.spent),
        firstSaleAt: stats.first ? new Date(stats.first).toISOString() : null, lastSaleAt: stats.last ? new Date(stats.last).toISOString() : null,
        debtSalesCount: items.filter((i) => i.saleId).length, openDebtSales: items.filter((i) => i.saleId && i.outstanding > 0).length,
        paidTotal: pays.filter((p) => p.status === 'completed').reduce((a, p) => a + p.amount, 0),
        adjustmentsLeft,
      },
      sales: salesView,
      payments: paymentsView,
      manualDebts,
    };
  }
}
