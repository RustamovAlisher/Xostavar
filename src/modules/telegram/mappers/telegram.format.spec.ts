import { describe, expect, it } from 'vitest';
import { dailyReportMessage, esc, money, ownUseMessage, receiptsListMessages, saleMessage, usd, type DayReport, type ReceiptRow } from './telegram.format.js';
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

  const saleBase = {
    number: 'MAIN-20261106-0012', branchName: 'Asosiy', cashierName: 'Aziz', customerName: '', createdAt: tk('2026-11-06 14:32'),
    lines: [{ name: 'Disk <230>', variantName: '230 mm', qty: 3, unit: 'dona', unitPrice: 28_600, lineTotal: 85_800 }],
    subtotal: 85_800, discount: 0, total: 85_800, remainingDebt: 0, usdRate: 12_000,
    payments: [{ kind: 'cash', label: 'Naqd pul', amount: 85_800, amountUsd: null }],
  };

  it('sotuv xabari: kim, qachon, nima, qancha, qanday to\'langan — oddiy so\'zlar bilan', () => {
    const m = saleMessage(saleBase);
    expect(m).toContain('🧾 <b>SOTUV</b>');
    expect(m).toContain('🕐 06.11.2026 14:32 · Kassir: <b>Aziz</b>');
    expect(m).toContain('👤 Mijoz: <b>Oddiy mijoz</b>');
    expect(m).toContain('<b>1.</b> Disk &lt;230&gt; — 230 mm');
    expect(m).toContain("3 dona × 28 600 = <b>85 800 so'm</b>");
    expect(m).toContain("💰 <b>JAMI: 85 800 so'm</b>  (≈ $7.15)");
    expect(m).toContain("<b>To'lov:</b>\n💵 Naqd pul: 85 800 so'm");
    expect(m).toContain('<i>Chek № MAIN-20261106-0012 · Asosiy</i>');
    expect(m).not.toContain('Nasiya');
    expect(m).not.toContain('Chegirma');
  });

  it('nasiya: sarlavha, qarz va mijozning umumiy qarzi; chegirma va aralash to\'lov alohida qatorlarda', () => {
    const credit = saleMessage({
      ...saleBase, customerName: 'Vali', remainingDebt: 50_000, customerDebtAfter: 150_000, discount: 1_000, subtotal: 86_800,
      payments: [{ kind: 'cash', label: 'Naqd pul', amount: 20_000 }, { kind: 'card', label: 'Plastik karta', amount: 15_800, amountUsd: 1.5 }],
    });
    expect(credit).toContain('📒 <b>NASIYAGA SOTUV</b>');
    expect(credit).toContain('👤 Mijoz: <b>Vali</b>');
    expect(credit).toContain("Mahsulotlar: 86 800 so'm");
    expect(credit).toContain("🏷 Chegirma: −1 000 so'm");
    expect(credit).toContain("💵 Naqd pul: 20 000 so'm");
    expect(credit).toContain("💳 Plastik karta: 15 800 so'm ($1.50)");
    expect(credit).toContain("📒 Nasiyaga (qarzga): <b>50 000 so'm</b>");
    expect(credit).toContain("⚠️ Mijozning umumiy qarzi: <b>150 000 so'm</b>");
  });

  it('kesib sotilgan mahsulot: kesim tafsiloti va sof uzunlik xabarda ko\'rinadi', () => {
    const m = saleMessage({
      ...saleBase,
      lines: [
        { name: 'Truba kvadrat', variantName: '40×40×2 mm', qty: 15, unit: 'm', unitPrice: 9_000, lineTotal: 135_000, cuts: [{ lengthMeters: 6, quantity: 2 }, { lengthMeters: 3, quantity: 1 }] },
        { name: 'Sement', qty: 2, unit: 'qop', unitPrice: 65_000, lineTotal: 130_000, cuts: [] },
      ],
      subtotal: 265_000, total: 265_000, payments: [{ kind: 'cash', label: 'Naqd pul', amount: 265_000 }],
    });
    expect(m).toContain('<b>1.</b> Truba kvadrat — 40×40×2 mm');
    // mahsulot blokida qisqa belgi, tafsilot esa alohida qalin «KESIB BERISH» bo'limida
    expect(m).toContain('✂️ <i>kesib beriladi — pastda yozilgan</i>');
    expect(m).toContain('✂️ <b>KESIB BERISH KERAK</b>');
    expect(m).toContain('<b>1. Truba kvadrat — 40×40×2 mm</b>\n     ▪️ <b>6 m × 2 ta</b>\n     ▪️ <b>3 m × 1 ta</b>\n     jami: <b>15 m</b>');
    expect(m).not.toContain('Sement</b>\n     ▪️'); // kesimsiz mahsulot bo'limga tushmaydi
    expect(m.indexOf('KESIB BERISH KERAK')).toBeLessThan(m.indexOf('JAMI:')); // bo'lim jamidan oldin
    expect(saleMessage(saleBase)).not.toContain('KESIB BERISH');
  });

  it('juda ko\'p mahsulot: Telegram 4096 chegarasidan oshmaydi, oxirida «yana N ta»', () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({ name: `Mahsulot raqami ${i + 1} (uzun nomli tovar)`, variantName: 'katta o\'lcham', qty: 1, unit: 'dona', unitPrice: 10_000, lineTotal: 10_000, cuts: [{ lengthMeters: 1.5, quantity: 2 }] }));
    const m = saleMessage({ ...saleBase, lines, subtotal: 800_000, total: 800_000, payments: [{ kind: 'cash', label: 'Naqd pul', amount: 800_000 }] });
    expect(m.length).toBeLessThan(4096);
    expect(m).toMatch(/va yana \d+ ta mahsulot/);
    expect(m).toContain("JAMI: 800 000 so'm"); // jami/to'lov qismi hech qachon kesilmaydi
  });

  it("«O'zimga olindi» xabari: kim, nima, kesim, xarajatga yozilgan summa; sotuv emasligi aytilgan", () => {
    const m = ownUseMessage({
      branchName: 'Asosiy', userName: 'Aziz', createdAt: tk('2026-11-22 10:15'), amount: 280_000,
      lines: [
        { name: 'Truba kvadrat', variantName: '40×40×2 mm', qty: 12, unit: 'm', unitPrice: 17_500, lineTotal: 210_000, cuts: [{ lengthMeters: 6, quantity: 2 }] },
        { name: 'Montaj kleyi', qty: 1, unit: 'dona', unitPrice: 70_000, lineTotal: 70_000 },
      ],
    });
    expect(m).toContain("🏠 <b>O'ZIMGA OLINDI</b>");
    expect(m).toContain('🕐 22.11.2026 10:15 · Kim: <b>Aziz</b>');
    expect(m).toContain("12 m × 17 500 = <b>210 000 so'm</b>");
    expect(m).toContain('✂️ <b>KESIB BERISH KERAK</b>');
    expect(m).toContain("💸 <b>Xarajatga yozildi (tannarxda): 280 000 so'm</b>");
    expect(m).toContain('Bu sotuv emas');
    expect(m).toContain('<i>Asosiy</i>');
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
