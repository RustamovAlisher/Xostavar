import { addDays } from '../../../common/utils/numbers.js';
import type { CategoryShareRow, DashboardDayRow, DebtAggRow, DebtorRow, ExpenseAggRow, ExpenseByCategoryRow, ExpenseByMethodRow, InventoryValueRow, LowStockRow, PaymentDayRow, PaymentRow, ProductReportRow, RevenueDayRow, SalesSummaryRow } from '../repositories/reports.repository.js';

const ZERO_DAY: Omit<DashboardDayRow, 'day'> = { revenue: 0, sales: 0, salesTotal: 0, profit: 0, newDebt: 0, debtPaid: 0 };
const pair = (a: number, b: number) => ({ today: a, yesterday: b });
/** Foiz, 1 xona: foyda / savdo summasi. */
const pct = (profit: number, total: number) => (total ? +((profit / total) * 100).toFixed(1) : 0);

export interface DashboardInput {
  today: string;
  scId: string | null;
  withCost: boolean;
  withExp: boolean;
  byDay: DashboardDayRow[];
  catShare: CategoryShareRow[];
  payToday: PaymentDayRow[];
  debt: DebtAggRow;
  inv: InventoryValueRow;
  lowStock: LowStockRow[];
  exp: ExpenseAggRow;
  expByCat: ExpenseByCategoryRow[];
  soldCostToday: number;
  stockInToday: number;
}

/** Kam qoldiq qatori: numeric → son, nom variant bilan. */
export const toLowStockItem = <T extends LowStockRow>(l: T) => ({ ...l, stock: Number(l.stock), minStock: Number(l.minStock), name: l.variantName ? `${l.name} — ${l.variantName}` : l.name });
/** `GET /reports/low-stock` ro'yxati (nom o'zgartirilmaydi, variant alohida maydon). */
export const toLowStockList = <T extends LowStockRow>(rows: T[]) => rows.map((l) => ({ ...l, stock: Number(l.stock), minStock: Number(l.minStock) }));

/** Frontend "Moliya va statistika" sahifasi uchun bitta javob (TZ 9.9 dashboard). Foyda maydonlari faqat `withCost`, xarajatlar faqat `withExp`. */
export function toDashboard(i: DashboardInput) {
  const { today, withCost, withExp, exp, inv } = i;
  const yesterday = addDays(today, -1);
  const weekStart = addDays(today, -6);
  const d = new Map(i.byDay.map((r) => [r.day, r]));
  const t = d.get(today) ?? ZERO_DAY;
  const y = d.get(yesterday) ?? ZERO_DAY;
  // Kechagi ombor qiymati taxmini (bugungi sotuv tannarxi qaytariladi, bugungi kirim ayriladi); 0 dan kichik bo'lmaydi
  const invYesterday = Math.max(0, inv.value + i.soldCostToday - i.stockInToday);
  let profit30 = 0;
  for (const r of i.byDay) profit30 += r.profit;

  return {
    date: today,
    branchId: i.scId ?? 'all',
    revenue: pair(t.revenue, y.revenue),
    receipts: pair(t.sales, y.sales),
    avgReceipt: pair(t.sales ? Math.round(t.salesTotal / t.sales) : 0, y.sales ? Math.round(y.salesTotal / y.sales) : 0),
    ...(withCost ? { grossProfit: pair(t.profit, y.profit), marginPct: pair(pct(t.profit, t.salesTotal), pct(y.profit, y.salesTotal)) } : {}),
    ...(withCost && withExp ? { netProfit: pair(t.profit - exp.today, y.profit - exp.yesterday) } : {}),
    customerDebt: { total: i.debt.total, yesterday: i.debt.total - t.newDebt + t.debtPaid, debtors: i.debt.debtors, overdue: i.debt.overdue },
    inventoryValue: { today: inv.value, yesterday: invYesterday, positions: inv.positions, atCost: withCost },
    // 7 kunlik qator: ma'lumot bo'lmagan kunlar 0 bilan to'ldiriladi
    week: Array.from({ length: 7 }, (_, k) => {
      const day = addDays(weekStart, k);
      const r = d.get(day) ?? ZERO_DAY;
      return { day, revenue: r.revenue, ...(withCost ? { profit: r.profit } : {}) };
    }),
    categoryShare: i.catShare.map((c) => ({ categoryId: c.categoryId, name: c.name ?? 'Boshqa', value: c.value })),
    paymentsToday: i.payToday.map((p) => ({ method: p.code, kind: p.kind, label: p.label ?? p.code, value: p.sum })),
    nasiyaWrittenToday: t.newDebt,
    debtPaymentsToday: t.debtPaid,
    ...(withExp ? { expenses: { today: exp.today, yesterday: exp.yesterday, month: exp.month, byCategory: i.expByCat }, ...(withCost ? { profitLoss30: { grossProfit: profit30, expenses: exp.month, netProfit: profit30 - exp.month } } : {}) } : {}),
    lowStock: i.lowStock.map(toLowStockItem),
  };
}

/** Kunlik tushum; foyda faqat `withCost`. */
export const toRevenue = (rows: RevenueDayRow[], withCost: boolean) => rows.map((r) => (withCost ? r : { ...r, profit: undefined }));

/** Mahsulotlar hisoboti: miqdor son sifatida, foyda faqat `withCost`. */
export const toProductsReport = (rows: ProductReportRow[], withCost: boolean) => rows.map((r) => ({ ...r, qtyBase: Number(r.qtyBase), profit: withCost ? r.profit : undefined }));

/** Qarzdorlar va yoshi (aging): 0–30, 31–60, 61–90, 90+ kun muddat o'tgan. */
export function toDebts(rows: DebtorRow[]) {
  const bucket = (d: number) => (d <= 0 ? 'current' : d <= 30 ? 'd30' : d <= 60 ? 'd60' : d <= 90 ? 'd90' : 'd90plus');
  const aging: Record<string, number> = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  for (const r of rows) aging[bucket(r.overdueDays)] += r.totalDebt;
  return { items: rows, total: rows.reduce((a, r) => a + r.totalDebt, 0), aging };
}

/** Foyda va zarar (TZ 7.11): tushum, tannarx, yalpi foyda, xarajatlar kategoriya bo'yicha, sof foyda. */
export function toProfitLoss(q: { from: string; to: string }, s: SalesSummaryRow, exp: ExpenseByCategoryRow[]) {
  const expTotal = exp.reduce((a, e) => a + e.value, 0);
  return { from: q.from, to: q.to, revenue: s.salesTotal, costOfGoods: s.salesTotal - s.profit, grossProfit: s.profit, receipts: s.receipts, expenses: expTotal, expensesByCategory: exp, netProfit: s.profit - expTotal };
}

/** Kassa oqimi: kirim (to'lovlar) − chiqim (xarajatlar). */
export const toCashFlow = (inflow: PaymentRow[], outflow: ExpenseByMethodRow[]) => ({ inflow, outflow, net: inflow.reduce((a, r) => a + r.sum, 0) - outflow.reduce((a, r) => a + r.sum, 0) });
