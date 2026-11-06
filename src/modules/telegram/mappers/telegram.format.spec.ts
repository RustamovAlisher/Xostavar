import { describe, expect, it } from 'vitest';
import { dailyReportMessage, esc, money, receiptsListMessages, saleMessage, usd, type DayReport, type ReceiptRow } from './telegram.format.js';
import { coversBranch, dailyDue, linkCode, nextDailyAt, tashkentDay, wants } from './telegram.rules.js';
import type { TelegramChatRow } from '../repositories/telegram.repository.js';

const tk = (s: string) => new Date(`${s.replace(' ', 'T')}:00+05:00`);

describe('formatlash', () => {
  it("pul va dollar", () => {
    expect(money(1234567)).toBe('1 234 567');
    expect(money(0)).toBe('0');
    expect(money(-5000)).toBe('−5 000');
    expect(usd(45.5)).toBe('$45.50');
    expect(usd(1234.5)).toBe('$1 234.50');
  });

  it('HTML ekranlanadi (mahsulot nomida < > &)', () => {
    expect(esc('Bolt <M8> & gayka')).toBe('Bolt &lt;M8&gt; &amp; gayka');
  });

  it("sotuv xabari: qatorlar va jami; nasiya bo'lsa sarlavha va qarz", () => {
    const base = {
      number: 'MAIN-20261106-0012', branchName: 'Asosiy', cashierName: 'Aziz', customerName: '', createdAt: tk('2026-11-06 14:32'),
      lines: [{ name: 'Disk <230>', variantName: '230 mm', qty: 3, unit: 'dona', unitPrice: 28_600, lineTotal: 85_800 }],
      subtotal: 85_800, discount: 0, total: 85_800, remainingDebt: 0, usdRate: 12_000,
      payments: [{ kind: 'cash', label: 'Naqd pul', amount: 85_800, amountUsd: 7.15 }],
    };
    const m = saleMessage(base);
    expect(m).toContain('🧾 <b>Sotuv</b> · 14:32');
    expect(m).toContain('• Disk &lt;230&gt; (230 mm) — 3 dona × 28 600 = <b>85 800</b>');
    expect(m).toContain("Jami: 85 800 so'm</b>  (≈ $7.15)");
    expect(m).toContain('<i>MAIN-20261106-0012 · Asosiy · Aziz</i>');
    expect(m).not.toContain('Naqd pul');
    const credit = saleMessage({ ...base, customerName: 'Vali', remainingDebt: 50_000, customerDebtAfter: 150_000, payments: [], discount: 1_000 });
    expect(credit).toContain('📒 <b>Nasiyaga sotuv</b>');
    expect(credit).toContain('Chegirma: −1 000');
    expect(credit).toContain('Qarzga: <b>50 000</b> · Vali (jami qarzi 150 000)');
  });

  it('kun yakuni: foyda faqat ruxsat bo\'lsa; bo\'sh kun', () => {
    const r: DayReport = {
      day: '2026-11-06', scopeName: 'Barcha filiallar', revenue: 1_000_000, receipts: 4, discount: 0, profit: 300_000,
      byMethod: [{ kind: 'cash', label: 'Naqd', amount: 700_000 }, { kind: 'card', label: 'Karta', amount: 300_000 }], usdTotal: 20,
      creditGiven: 0, creditCount: 0, debtPayments: 0, debtPaymentCount: 0, voids: { count: 1, sum: 50_000 }, expenses: 100_000,
      topProducts: [{ name: 'Sement', qty: 10, unit: 'qop', total: 500_000 }], cashiers: [{ name: 'Aziz', count: 4, total: 1_000_000 }],
      branches: [{ name: 'A', count: 3, total: 800_000 }, { name: 'B', count: 1, total: 200_000 }], lowStock: 2,
    };
    const m = dailyReportMessage(r, { showProfit: true });
    expect(m).toContain("Tushum: <b>1 000 000 so'm</b>");
    expect(m).toContain("o'rtacha 250 000");
    expect(m).toContain('shundan dollarda: $20.00');
    expect(m).toContain("Bekor qilingan: 1 ta (50 000 so'm)");
    expect(m).toContain('xarajatdan keyin 200 000');
    expect(m).toContain('1. Sement — 10 qop · 500 000');
    expect(m).toContain('• B: 200 000 (1 chek)');
    expect(dailyReportMessage(r, { showProfit: false })).not.toContain('foyda');
    expect(dailyReportMessage({ ...r, receipts: 0, voids: { count: 0, sum: 0 }, debtPaymentCount: 0 }, { showProfit: true })).toContain("sotuv bo'lmadi");
  });

  it("cheklar ro'yxati 4096 chegarasida bo'laklanadi, bekor qilingan chizilgan", () => {
    const row = (i: number, extra: Partial<ReceiptRow> = {}): ReceiptRow => ({ createdAt: tk('2026-11-06 10:00'), number: `MAIN-20261106-${String(i).padStart(4, '0')}`, type: 'sale', status: 'completed', total: 100_000, remainingDebt: 0, payLabel: 'Naqd', cashierName: 'Aziz', customerName: '', branchName: 'A', ...extra });
    const one = receiptsListMessages('2026-11-06', 'A', [row(1), row(2, { status: 'voided' })]);
    expect(one).toHaveLength(1);
    expect(one[0]).toContain('❌ <s>');
    expect(one[0]).toContain("Jami: <b>1</b> ta sotuv · <b>100 000 so'm</b>");
    const many = receiptsListMessages('2026-11-06', 'A', Array.from({ length: 600 }, (_, i) => row(i + 1)));
    expect(many.length).toBe(4);
    for (const p of many) expect(p.length).toBeLessThan(4096);
    expect(many[3]).toContain('Excel');
    expect(receiptsListMessages('2026-11-06', 'A', [])[0]).toContain("chek yo'q");
  });
});

describe('qoidalar', () => {
  const chat = (p: Partial<TelegramChatRow> = {}) => ({ active: true, branchIds: null, notifySales: true, minAmount: 0, notifyVoids: true, notifyDebts: true, dailyReport: true, showProfit: true, ...p }) as TelegramChatRow;
  it('filial filtri', () => {
    expect(coversBranch(chat(), 'a')).toBe(true);
    expect(coversBranch(chat({ branchIds: ['a'] }), 'a')).toBe(true);
    expect(coversBranch(chat({ branchIds: ['a'] }), 'b')).toBe(false);
    expect(wants(chat({ branchIds: ['a'] }), 'sale', { branchId: 'b', total: 1 })).toBe(false);
  });
  it("minimal summa faqat oddiy sotuvni cheklaydi; nasiya va bekor har doim", () => {
    const c = chat({ minAmount: 1_000_000 });
    expect(wants(c, 'sale', { branchId: 'a', total: 999_999 })).toBe(false);
    expect(wants(c, 'sale', { branchId: 'a', total: 1_000_000 })).toBe(true);
    expect(wants(c, 'sale', { branchId: 'a', total: 10, remainingDebt: 10 })).toBe(true);
    expect(wants(c, 'void', { branchId: 'a' })).toBe(true);
    expect(wants(chat({ notifySales: false }), 'sale', { branchId: 'a', total: 5 })).toBe(false);
    expect(wants(chat({ active: false }), 'daily', { branchId: null })).toBe(false);
  });
  it('21:00 Toshkent vaqti', () => {
    expect(nextDailyAt('21:00', tk('2026-11-06 20:59'))).toEqual(tk('2026-11-06 21:00'));
    expect(nextDailyAt('21:00', tk('2026-11-06 21:00'))).toEqual(tk('2026-11-07 21:00'));
    expect(nextDailyAt('21:00', tk('2026-11-06 23:30'))).toEqual(tk('2026-11-07 21:00'));
    expect(dailyDue('21:00', tk('2026-11-06 20:59'))).toBe(false);
    expect(dailyDue('21:00', tk('2026-11-06 21:05'))).toBe(true);
    expect(tashkentDay(tk('2026-11-06 23:59'))).toBe('2026-11-06');
    expect(tashkentDay(tk('2026-11-07 00:01'))).toBe('2026-11-07');
  });
  it('ulash kodi: 6 belgi, chalkash belgilarsiz', () => {
    for (let i = 0; i < 200; i++) expect(linkCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
  });
});
