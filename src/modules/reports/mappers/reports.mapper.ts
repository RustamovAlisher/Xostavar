import { addDays } from '../../../common/utils/numbers.js';
import type { CategoryShareRow, DashboardDayRow, DebtAggRow, DebtLedgerPeriodRow, DebtorRow, DebtSummaryRow, ExpenseAggRow, ExpenseByCategoryRow, ExpenseByMethodRow, ExpensePeriodRow, Granularity, InventoryValueRow, LowStockRow, PaymentDayRow, PaymentRow, ProductReportRow, RevenueDayRow, SalesPeriodRow, SalesSummaryRow } from '../repositories/reports.repository.js';

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

/* ───────── Davrlar (hafta / oy / yil) ───────── */

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (s: string) => new Date(s + 'T00:00:00Z');

/** Davr boshi: hafta — dushanba, oy — 1-sana, yil — 1 yanvar (Postgres `date_trunc` bilan bir xil). */
export function periodStart(dateISO: string, g: Granularity): string {
  const d = utc(dateISO);
  if (g === 'week') {
    const dow = (d.getUTCDay() + 6) % 7; // dushanba = 0
    d.setUTCDate(d.getUTCDate() - dow);
  } else if (g === 'month') d.setUTCDate(1);
  else { d.setUTCMonth(0, 1); }
  return iso(d);
}

/** Keyingi davr boshi. */
export function periodNext(startISO: string, g: Granularity): string {
  const d = utc(startISO);
  if (g === 'week') d.setUTCDate(d.getUTCDate() + 7);
  else if (g === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return iso(d);
}

/** `from`..`to` oralig'idagi barcha davr boshlari (bo'sh davrlar ham 0 bilan chiqsin). */
export function periodKeys(from: string, to: string, g: Granularity): string[] {
  const keys: string[] = [];
  for (let k = periodStart(from, g); k <= to && keys.length < 400; k = periodNext(k, g)) keys.push(k);
  return keys;
}

/** Ko'rsatish uchun yorliq: hafta `2026-W43`, oy `2026-10`, yil `2026`. */
export function periodLabel(start: string, g: Granularity): string {
  if (g === 'month') return start.slice(0, 7);
  if (g === 'year') return start.slice(0, 4);
  const d = utc(start);
  // ISO hafta raqami
  const t = new Date(d);
  t.setUTCDate(t.getUTCDate() + 3);
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${pad(week)}`;
}

export interface PeriodsInput { from: string; to: string; g: Granularity; withCost: boolean; withExp: boolean; sales: SalesPeriodRow[]; exp: ExpensePeriodRow[] }

/**
 * Davrlar hisoboti (TZ 9.9 kengaytmasi): har davr uchun tushum, cheklar, savdo, yalpi foyda, xarajat, sof foyda.
 * Bo'sh davrlar 0 bilan to'ldiriladi; jami va eng yaxshi/yomon davr alohida. Foyda faqat `withCost`, xarajat/sof foyda faqat `withExp`.
 */
export function toPeriods(i: PeriodsInput) {
  const s = new Map(i.sales.map((r) => [r.period, r]));
  const e = new Map(i.exp.map((r) => [r.period, r]));
  const items = periodKeys(i.from, i.to, i.g).map((start) => {
    const a = s.get(start);
    const x = e.get(start);
    const salesTotal = a?.salesTotal ?? 0;
    const receipts = a?.receipts ?? 0;
    const profit = a?.profit ?? 0;
    const expenses = x?.expenses ?? 0;
    const end = iso(new Date(utc(periodNext(start, i.g)).getTime() - 86_400_000));
    return {
      period: start, label: periodLabel(start, i.g), from: start, to: end < i.to ? end : i.to,
      revenue: a?.revenue ?? 0, receipts, salesTotal, discount: a?.discount ?? 0, avgReceipt: receipts ? Math.round(salesTotal / receipts) : 0,
      nasiyaWritten: a?.newDebt ?? 0, debtPaid: a?.debtPaid ?? 0,
      ...(i.withCost ? { grossProfit: profit, marginPct: pct(profit, salesTotal) } : {}),
      ...(i.withExp ? { expenses, expensesFromRegister: x?.fromRegister ?? 0 } : {}),
      ...(i.withCost && i.withExp ? { netProfit: profit - expenses } : {}),
    };
  });
  const sum = (k: keyof (typeof items)[number]) => items.reduce((acc, r) => acc + (Number(r[k]) || 0), 0);
  const totals = {
    revenue: sum('revenue'), receipts: sum('receipts'), salesTotal: sum('salesTotal'), discount: sum('discount'), nasiyaWritten: sum('nasiyaWritten'), debtPaid: sum('debtPaid'),
    avgReceipt: sum('receipts') ? Math.round(sum('salesTotal') / sum('receipts')) : 0,
    ...(i.withCost ? { grossProfit: sum('grossProfit'), marginPct: pct(sum('grossProfit'), sum('salesTotal')) } : {}),
    ...(i.withExp ? { expenses: sum('expenses') } : {}),
    ...(i.withCost && i.withExp ? { netProfit: sum('grossProfit') - sum('expenses') } : {}),
  };
  const withData = items.filter((r) => r.receipts > 0 || r.revenue > 0);
  const key = i.withCost && i.withExp ? 'netProfit' : i.withCost ? 'grossProfit' : 'revenue';
  const by = (r: (typeof items)[number]) => Number(r[key as keyof typeof r]) || 0;
  const best = withData.length ? withData.reduce((a, b) => (by(b) > by(a) ? b : a)) : null;
  const worst = withData.length ? withData.reduce((a, b) => (by(b) < by(a) ? b : a)) : null;
  return { granularity: i.g, from: i.from, to: i.to, items, totals, best: best ? { period: best.period, label: best.label, value: by(best) } : null, worst: worst ? { period: worst.period, label: worst.label, value: by(worst) } : null, measure: key };
}

/* ───────── Qarzlar sahifasi ───────── */

export interface DebtsOverviewInput { from: string; to: string; g: Granularity; summary: DebtSummaryRow; debtors: DebtorRow[]; ledger: DebtLedgerPeriodRow[]; opening: number; top: number }

/** Qarzlar: holat (jami, qarzdorlar, muddati o'tgan, 7 kunda keladigan), aging, davr dinamikasi (yangi/to'langan/balans), eng katta qarzdorlar. */
export function toDebtsOverview(i: DebtsOverviewInput) {
  const l = new Map(i.ledger.map((r) => [r.period, r]));
  let balance = i.opening;
  const dynamics = periodKeys(i.from, i.to, i.g).map((start) => {
    const r = l.get(start);
    balance += r?.net ?? 0;
    return { period: start, label: periodLabel(start, i.g), newDebt: r?.newDebt ?? 0, paid: r?.paid ?? 0, other: r?.other ?? 0, net: r?.net ?? 0, balanceEnd: balance };
  });
  const { items, total, aging } = toDebts(i.debtors);
  const agingCount: Record<string, number> = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  const bucket = (d: number) => (d <= 0 ? 'current' : d <= 30 ? 'd30' : d <= 60 ? 'd60' : d <= 90 ? 'd90' : 'd90plus');
  for (const r of items) agingCount[bucket(r.overdueDays)] += 1;
  const top = [...items].sort((a, b) => b.totalDebt - a.totalDebt).slice(0, i.top);
  return {
    granularity: i.g, from: i.from, to: i.to,
    summary: { ...i.summary, total, openingBalance: i.opening, closingBalance: balance },
    aging: { sum: aging, count: agingCount },
    dynamics,
    top,
    totals: { newDebt: dynamics.reduce((a, r) => a + r.newDebt, 0), paid: dynamics.reduce((a, r) => a + r.paid, 0), net: balance - i.opening },
  };
}
