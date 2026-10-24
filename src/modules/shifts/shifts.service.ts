import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../db/db.module.js';
import { businessRules, expenses, paymentMethods, salePayments, sales, shifts } from '../../db/schema/index.js';
import type { AuthUser } from '../../common/auth-context.js';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors.js';
import { page, type PageQuery } from '../../common/pagination.js';
import { AuditService } from '../audit/audit.service.js';

export interface ShiftTotals {
  cash: number;
  card: number;
  transfer: number;
  other: number;
  byMethod: Record<string, number>;
  nasiyaDebt: number;
  debtPayments: number;
  receipts: number;
  revenue: number;
  cashOut: number;
  voided: number;
}

@Injectable()
export class ShiftsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async current(branchId: string, tx: DbOrTx = this.db) {
    const [s] = await tx.select().from(shifts).where(and(eq(shifts.branchId, branchId), isNull(shifts.closedAt))).limit(1);
    return s ?? null;
  }

  /**
   * Sotuv/qarz to'lovi oldidan (TZ 8.9): require_shift bo'lsa ochiq smena va u shu xodimniki (yoki admin) bo'lishi shart.
   * Tranzaksiya ichida chaqiriladi; ochiq smena id sini qaytaradi (bo'lmasa null).
   */
  async requireForSale(tx: DbOrTx, user: AuthUser, branchId: string, allowAdmin = false): Promise<string | null> {
    const [rules] = await tx.select({ requireShift: businessRules.requireShift }).from(businessRules).limit(1);
    const s = await this.current(branchId, tx);
    if (!rules?.requireShift) return s?.id ?? null;
    if (!s) throw unprocessable('shift_required', 'Avval smenani oching');
    if (s.openedBy !== user.id && !(allowAdmin && user.permissions.includes('manage_users'))) {
      throw forbidden(`Smena ${s.openedByName} nomida ochilgan`, 'shift_owned_by_other');
    }
    return s.id;
  }

  async open(user: AuthUser, branchId: string, openingCash = 0) {
    const existing = await this.current(branchId);
    if (existing) throw conflict('in_use', `Smena allaqachon ochiq (${existing.openedByName})`);
    const cash = Math.max(0, Math.round(openingCash));
    try {
      const s = await this.db.transaction(async (tx) => {
        const [row] = await tx.insert(shifts).values({ branchId, openedBy: user.id, openedByName: user.name, openingCash: cash }).returning();
        await this.audit.log(user, { action: 'shift_open', module: 'Kassa', targetId: row.id, targetName: 'Smena', details: `Smena ochildi, kassada ${cash.toLocaleString('ru-RU')} so'm`, branchId }, tx);
        return row;
      });
      return s;
    } catch (e) {
      // Qisman unikal indeks: ikki kassir bir vaqtda ochsa — ikkinchisi 409
      if ((e as { code?: string }).code === '23505') throw conflict('in_use', 'Smena allaqachon ochiq');
      throw e;
    }
  }

  /** Jamlar — 3 ta GROUP BY so'rov, chek soniga bog'liq emas (TZ 7.7). */
  async totals(shiftId: string, tx: DbOrTx = this.db): Promise<ShiftTotals> {
    const [payRows, saleRows, [exp]] = await Promise.all([
      tx
        .select({ code: salePayments.methodCode, kind: salePayments.kind, sum: sql<number>`coalesce(sum(${salePayments.amount}), 0)::bigint` })
        .from(salePayments)
        .innerJoin(sales, eq(sales.id, salePayments.saleId))
        .where(and(eq(sales.shiftId, shiftId), eq(sales.status, 'completed')))
        .groupBy(salePayments.methodCode, salePayments.kind),
      tx
        .select({
          type: sales.type,
          status: sales.status,
          n: sql<number>`count(*)::int`,
          paid: sql<number>`coalesce(sum(${sales.paidAmount}), 0)::bigint`,
          debt: sql<number>`coalesce(sum(${sales.remainingDebt}), 0)::bigint`,
        })
        .from(sales)
        .where(eq(sales.shiftId, shiftId))
        .groupBy(sales.type, sales.status),
      tx
        .select({ cashOut: sql<number>`coalesce(sum(${expenses.amount}), 0)::bigint` })
        .from(expenses)
        .where(and(eq(expenses.shiftId, shiftId), eq(expenses.source, 'cash_register'), isNull(expenses.voidedAt))),
    ]);
    const t: ShiftTotals = { cash: 0, card: 0, transfer: 0, other: 0, byMethod: {}, nasiyaDebt: 0, debtPayments: 0, receipts: 0, revenue: 0, cashOut: exp?.cashOut ?? 0, voided: 0 };
    for (const p of payRows) {
      if (p.kind === 'cash') t.cash += p.sum;
      else if (p.kind === 'card') t.card += p.sum;
      else if (p.kind === 'transfer') t.transfer += p.sum;
      else t.other += p.sum;
      t.byMethod[p.code] = (t.byMethod[p.code] ?? 0) + p.sum;
    }
    for (const r of saleRows) {
      if (r.status === 'voided') {
        t.voided += r.n;
        continue;
      }
      t.revenue += r.paid;
      if (r.type === 'sale') {
        t.receipts += r.n;
        t.nasiyaDebt += r.debt;
      } else t.debtPayments += r.paid;
    }
    return t;
  }

  async close(user: AuthUser, branchId: string, countedCash?: number) {
    const s = await this.current(branchId);
    if (!s) throw notFound('Ochiq smena');
    if (s.openedBy !== user.id && !user.permissions.includes('manage_users')) {
      throw forbidden(`Smenani faqat ${s.openedByName} yoki administrator yopa oladi`, 'shift_owned_by_other');
    }
    return this.db.transaction(async (tx) => {
      const totals = await this.totals(s.id, tx);
      const expectedCash = s.openingCash + totals.cash - totals.cashOut;
      const counted = countedCash != null ? Math.max(0, Math.round(countedCash)) : null;
      const [row] = await tx
        .update(shifts)
        .set({ closedAt: new Date(), closedBy: user.id, closedByName: user.name, totals: totals as unknown as Record<string, unknown>, expectedCash, closingCashCounted: counted })
        .where(and(eq(shifts.id, s.id), isNull(shifts.closedAt)))
        .returning();
      if (!row) throw conflict('in_use', 'Smena allaqachon yopilgan');
      const diff = counted != null ? counted - expectedCash : null;
      await this.audit.log(user, {
        action: 'shift_close', module: 'Kassa', targetId: s.id, targetName: 'Smena', branchId,
        details: `Smena yopildi: tushum ${totals.revenue.toLocaleString('ru-RU')} so'm, ${totals.receipts} ta chek, kutilgan naqd ${expectedCash.toLocaleString('ru-RU')}${diff != null ? `, sanaldi ${counted!.toLocaleString('ru-RU')} (farq ${diff >= 0 ? '+' : ''}${diff.toLocaleString('ru-RU')})` : ''}`,
      }, tx);
      return { ...row, totals };
    });
  }

  async report(id: string) {
    const [s] = await this.db.select().from(shifts).where(eq(shifts.id, id)).limit(1);
    if (!s) throw notFound('Smena');
    const totals = s.closedAt && s.totals ? (s.totals as unknown as ShiftTotals) : await this.totals(id);
    const methods = await this.db.select({ code: paymentMethods.code, label: paymentMethods.label }).from(paymentMethods);
    return { ...s, totals, expectedCash: s.expectedCash ?? s.openingCash + totals.cash - totals.cashOut, methodLabels: Object.fromEntries(methods.map((m) => [m.code, m.label])) };
  }

  async list(branchId: string, q: PageQuery & { from?: string; to?: string }) {
    const where = and(eq(shifts.branchId, branchId), q.from ? gte(shifts.openedAt, new Date(q.from)) : undefined, q.to ? lte(shifts.openedAt, new Date(q.to + 'T23:59:59.999Z')) : undefined);
    const [items, [{ total }]] = await Promise.all([
      this.db.select().from(shifts).where(where).orderBy(desc(shifts.openedAt)).limit(q.pageSize).offset(q.offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(shifts).where(where),
    ]);
    return page(items, total, q);
  }
}
