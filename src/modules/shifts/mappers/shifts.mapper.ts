import type { ShiftRow } from '../repositories/shifts.repository.js';

/** Z-hisobot jamlari (TZ 7.7). Yopilgan smenada `shifts.totals` ichida muzlatiladi. */
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

type PayRow = { code: string; kind: string; sum: number };
type SaleRow = { type: string; status: string; n: number; paid: number; debt: number };

/** GROUP BY qatorlaridan jamlar: storno cheklar faqat `voided` ga kiradi, tushumga qo'shilmaydi. */
export function toShiftTotals(payRows: PayRow[], saleRows: SaleRow[], cashOut: number): ShiftTotals {
  const t: ShiftTotals = { cash: 0, card: 0, transfer: 0, other: 0, byMethod: {}, nasiyaDebt: 0, debtPayments: 0, receipts: 0, revenue: 0, cashOut, voided: 0 };
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

export const expectedCashOf = (openingCash: number, t: ShiftTotals) => openingCash + t.cash - t.cashOut;

/** Z-hisobot javobi: smena + jamlar + to'lov usuli nomlari (frontend `methodLabels`). */
export function toShiftReport(s: ShiftRow, totals: ShiftTotals, methods: { code: string; label: string }[]) {
  return { ...s, totals, expectedCash: s.expectedCash ?? expectedCashOf(s.openingCash, totals), methodLabels: Object.fromEntries(methods.map((m) => [m.code, m.label])) };
}
