import { describe, expect, it } from 'vitest';
import { periodKeys, periodLabel, periodNext, periodStart, toPeriods, toDebtsOverview } from './reports.mapper.js';

describe('davr yordamchilari (hafta dushanbadan, oy, yil)', () => {
  it('periodStart / periodNext / periodLabel', () => {
    expect(periodStart('2026-10-25', 'week')).toBe('2026-10-19'); // yakshanba → o\'sha haftaning dushanbasi
    expect(periodStart('2026-10-19', 'week')).toBe('2026-10-19');
    expect(periodStart('2026-10-25', 'month')).toBe('2026-10-01');
    expect(periodStart('2026-10-25', 'year')).toBe('2026-01-01');
    expect(periodNext('2026-10-19', 'week')).toBe('2026-10-26');
    expect(periodNext('2026-12-01', 'month')).toBe('2027-01-01');
    expect(periodNext('2026-01-01', 'year')).toBe('2027-01-01');
    expect(periodLabel('2026-10-19', 'week')).toBe('2026-W43');
    expect(periodLabel('2026-10-01', 'month')).toBe('2026-10');
    expect(periodLabel('2026-01-01', 'year')).toBe('2026');
    expect(periodLabel('2024-12-30', 'week')).toBe('2025-W01'); // ISO hafta yil chegarasida
  });
  it('periodKeys: oraliqdagi barcha davrlar, oxirgisi `to` ni o\'z ichiga oladi', () => {
    expect(periodKeys('2026-08-15', '2026-10-25', 'month')).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(periodKeys('2026-10-20', '2026-10-27', 'week')).toEqual(['2026-10-19', '2026-10-26']);
    expect(periodKeys('2023-06-01', '2026-01-01', 'year')).toEqual(['2023-01-01', '2024-01-01', '2025-01-01', '2026-01-01']);
  });
});

describe('toPeriods', () => {
  const sales = [{ period: '2026-09-01', revenue: 100, receipts: 2, salesTotal: 120, discount: 5, profit: 40, newDebt: 20, debtPaid: 0 }, { period: '2026-10-01', revenue: 50, receipts: 1, salesTotal: 50, discount: 0, profit: -10, newDebt: 0, debtPaid: 30 }];
  const exp = [{ period: '2026-09-01', expenses: 15, fromRegister: 10 }];
  it('bo\'sh oy 0 bilan, foyda/xarajat/sof foyda, jami, eng yaxshi/yomon davr', () => {
    const r = toPeriods({ from: '2026-08-01', to: '2026-10-25', g: 'month', withCost: true, withExp: true, sales, exp });
    expect(r.items.map((i) => i.label)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(r.items[0]).toMatchObject({ revenue: 0, receipts: 0, grossProfit: 0, expenses: 0, netProfit: 0, to: '2026-08-31' });
    expect(r.items[1]).toMatchObject({ revenue: 100, avgReceipt: 60, grossProfit: 40, marginPct: 33.3, expenses: 15, netProfit: 25, nasiyaWritten: 20 });
    expect(r.items[2]).toMatchObject({ grossProfit: -10, expenses: 0, netProfit: -10, debtPaid: 30, to: '2026-10-25' });
    expect(r.totals).toMatchObject({ revenue: 150, receipts: 3, grossProfit: 30, expenses: 15, netProfit: 15, avgReceipt: 57 });
    expect(r.measure).toBe('netProfit');
    expect(r.best).toMatchObject({ label: '2026-09', value: 25 });
    expect(r.worst).toMatchObject({ label: '2026-10', value: -10 });
  });
  it('tannarx huquqi bo\'lmasa foyda maydonlari yo\'q; xarajat huquqi bo\'lmasa xarajat yo\'q; o\'lchov tushum', () => {
    const r = toPeriods({ from: '2026-09-01', to: '2026-10-25', g: 'month', withCost: false, withExp: false, sales, exp: [] });
    expect(r.items[0]).not.toHaveProperty('grossProfit');
    expect(r.items[0]).not.toHaveProperty('expenses');
    expect(r.measure).toBe('revenue');
    expect(r.best?.label).toBe('2026-09');
  });
});

describe('toDebtsOverview', () => {
  it('davr dinamikasi balansni boshlang\'ich qoldiqdan yig\'adi; aging summa va soni; eng katta qarzdorlar', () => {
    const r = toDebtsOverview({
      from: '2026-09-01', to: '2026-10-25', g: 'month',
      summary: { total: 0, debtors: 2, overdueCount: 1, overdueSum: 300, dueSoonCount: 0, dueSoonSum: 0, creditLimit: 1000 },
      debtors: [
        { id: 'a', name: 'A', phone: '', totalDebt: 300, creditLimit: 500, dueDate: '2026-09-01', lastPaidDate: null, overdueDays: 54 },
        { id: 'b', name: 'B', phone: '', totalDebt: 100, creditLimit: 500, dueDate: '2026-11-01', lastPaidDate: null, overdueDays: 0 },
      ],
      ledger: [{ period: '2026-10-01', newDebt: 500, paid: 150, other: -50, net: 300 }],
      opening: 100, top: 1,
    });
    expect(r.dynamics.map((d) => [d.label, d.balanceEnd])).toEqual([['2026-09', 100], ['2026-10', 400]]);
    expect(r.summary).toMatchObject({ total: 400, openingBalance: 100, closingBalance: 400, overdueCount: 1 });
    expect(r.aging.sum).toMatchObject({ current: 100, d60: 300 });
    expect(r.aging.count).toMatchObject({ current: 1, d60: 1 });
    expect(r.top.map((t) => t.name)).toEqual(['A']);
    expect(r.totals).toEqual({ newDebt: 500, paid: 150, net: 300 });
  });
});
