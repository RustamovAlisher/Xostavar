import { INestApplication } from '@nestjs/common';
import { as, code, createApp, makeProduct, seeded, uniq, type Client, type Seeded, today as todayStr } from './helpers.js';

const phone = () => '+998 9' + String(Math.floor(10000000 + Math.random() * 89999999));

/** Alohida filialda ma'lum sotuvlar qilib, hisobotlar aynan shu raqamlarni qaytarishini tekshiramiz. */
describe('reports (TZ 8.10, 9.9)', () => {
  let app: INestApplication;
  let s: Seeded;
  let branch: string;
  let c: Client;
  const today = todayStr();
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
    branch = (await s.admin.post('/branches', { name: uniq('Hisobot ') }, { idem: false })).body.id;
    c = s.admin.at(branch);
    const p = await makeProduct(c, s, { name: uniq('Tovar A '), stock: 100, cost: 600, price: 1000, category: 'Armatura' });
    const q = await makeProduct(c, s, { name: uniq('Tovar B '), stock: 100, cost: 2000, price: 5000, category: 'Trubalar' });
    const cu = (await c.post('/customers', { name: 'Hisobot mijoz', phone: phone(), creditLimit: 9_000_000 }, { idem: false })).body;
    await c.post('/shifts/open', { openingCash: 0 });
    // 1) 10 × A naqd = 10 000 (foyda 4 000)
    await c.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 10 }], payments: [{ methodId: s.methods.cash, amount: 10000 }] });
    // 2) 2 × B, chegirma 1 000, karta 9 000 (foyda 9000 − 4000 = 5000)
    await c.post('/sales', { lines: [{ productId: q.id, unit: 'piece', qty: 2 }], discountAmount: 1000, payments: [{ methodId: s.methods.card, amount: 9000 }] });
    // 3) nasiya: 4 × B = 20 000, 5 000 naqd + 15 000 qarz (foyda 12 000)
    await c.post('/sales', { lines: [{ productId: q.id, unit: 'piece', qty: 4 }], customerId: cu.id, onCredit: true, payments: [{ methodId: s.methods.cash, amount: 5000 }] });
    // 4) qarz to'lovi 3 000 naqd
    await c.post(`/customers/${cu.id}/payments`, { amount: 3000, methodId: s.methods.cash });
    // 5) bekor qilingan chek — hisobga kirmaydi
    const v = await c.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 50 }], payments: [{ methodId: s.methods.cash, amount: 50000 }] });
    await c.post(`/sales/${v.body.id}/void`, { reason: 'test' });
    // 6) xarajat: 2 000 kassadan, 700 boshqa
    const cat = s.settings.expenseCategories[0].id;
    await c.post('/expenses', { date: today, categoryId: cat, amount: 2000, methodId: s.methods.cash, source: 'cash_register' });
    await c.post('/expenses', { date: today, categoryId: s.settings.expenseCategories[1].id, amount: 700, methodId: s.methods.card, source: 'other' });
    // kam qoldiq chegarasi
    const lv = (await c.get(`/stock-levels?productId=${p.id}&branchId=all`)).body[0];
    await c.patch(`/stock-levels/${lv.id}`, { minStock: 95 });
    await c.post('/shifts/close', {});
  });
  afterAll(() => app.close());

  it('dashboard: bugungi tushum, cheklar, o\'rtacha chek, yalpi/sof foyda, qarz, to\'lov usullari, kategoriya ulushi, kam qoldiq', async () => {
    const d = (await c.get('/reports/dashboard')).body;
    expect(d.branchId).toBe(branch);
    expect(d.revenue).toEqual({ today: 10000 + 9000 + 5000 + 3000, yesterday: 0 });
    expect(d.receipts).toEqual({ today: 3, yesterday: 0 });
    expect(d.avgReceipt.today).toBe(Math.round((10000 + 9000 + 20000) / 3));
    expect(d.grossProfit.today).toBe(4000 + 5000 + 12000);
    expect(d.netProfit.today).toBe(21000 - 2700);
    expect(d.marginPct.today).toBe(+((21000 / 39000) * 100).toFixed(1));
    expect(d.customerDebt).toMatchObject({ debtors: expect.any(Number), overdue: expect.any(Number) });
    expect(d.customerDebt.total).toBeGreaterThanOrEqual(12000);
    expect(d.nasiyaWrittenToday).toBe(15000);
    expect(d.debtPaymentsToday).toBe(3000);
    const pay = Object.fromEntries(d.paymentsToday.map((p: { method: string; value: number }) => [p.method, p.value]));
    expect(pay).toEqual({ cash: 18000, card: 9000 });
    const cats = Object.fromEntries(d.categoryShare.map((x: { name: string; value: number }) => [x.name, x.value]));
    expect(cats['Armatura']).toBe(10000);
    expect(cats['Trubalar']).toBe(9000 + 20000); // chegirma mutanosib: 10000 × 0.9 = 9000
    expect(d.expenses).toMatchObject({ today: 2700, month: 2700 });
    expect(d.profitLoss30).toEqual({ grossProfit: 21000, expenses: 2700, netProfit: 18300 });
    expect(d.inventoryValue.atCost).toBe(true);
    expect(d.inventoryValue.today).toBe(90 * 600 + 94 * 2000);
    expect(d.lowStock.length).toBe(1);
    expect(d.lowStock[0]).toMatchObject({ stock: 90, minStock: 95 });
    expect(d.week.length).toBe(7);
    expect(d.week[6]).toMatchObject({ day: today, revenue: 27000, profit: 21000 });
  });

  it('tannarxsiz foydalanuvchi: foyda maydonlari yo\'q, ombor qiymati sotish narxida; xarajatsiz — xarajat yo\'q', async () => {
    const roleId = (await s.admin.get('/roles')).body.find((r: { name: string }) => r.name === 'Buxgalter').id;
    const u = (await s.admin.post('/users', { name: 'An', username: uniq('an'), roleId, password: 'Parol-12345', permissions: ['view_analytics'], branchIds: [branch] }, { idem: false })).body;
    const an = await as(app, u.username, 'Parol-12345');
    await an.post('/auth/change-password', { currentPassword: 'Parol-12345', newPassword: 'Analitik-Parol-1' }, { idem: false });
    const d = (await an.get('/reports/dashboard')).body;
    expect(d.grossProfit).toBeUndefined();
    expect(d.netProfit).toBeUndefined();
    expect(d.expenses).toBeUndefined();
    expect(d.week[6]).not.toHaveProperty('profit');
    expect(d.inventoryValue).toMatchObject({ atCost: false, today: 90 * 1000 + 94 * 5000 });
    expect((await an.get('/reports/profit-loss')).status).toBe(403);
  });

  it('branchId=all faqat egasi; boshqa filialni so\'rash kassirga 403', async () => {
    const all = (await s.admin.get('/reports/dashboard?branchId=all')).body;
    expect(all.branchId).toBe('all');
    expect(all.revenue.today).toBeGreaterThanOrEqual(27000);
    const other = (await s.admin.get(`/reports/dashboard?branchId=${branch}`)).body; // main kontekstida boshqa filialni so'rash — egasiga mumkin
    expect(other.branchId).toBe(branch);
    expect(code(await s.kassir.get('/reports/dashboard?branchId=all'))).toBe('forbidden'); // view_analytics yo'q
    const bux = await as(app, 'buxgalter');
    expect(code(await bux.get('/reports/dashboard?branchId=all'))).toBe('branch_forbidden');
    expect((await bux.get(`/reports/dashboard?branchId=${branch}`)).body.branchId).toBe(s.mainId); // boshqa filial so'rovi e'tiborsiz, o'z filiali
  });

  it('revenue, products, cashiers, payments, debts, profit-loss, cash-flow — raqamlar bir-biriga mos', async () => {
    const rev = (await c.get(`/reports/revenue?from=${today}&to=${today}`)).body;
    expect(rev).toEqual([{ day: today, revenue: 27000, receipts: 3, salesTotal: 39000, profit: 21000, nasiya: 15000 }]);
    const prods = (await c.get('/reports/products')).body as { name: string; qtyBase: number; total: number; profit: number }[];
    expect(prods.find((p) => p.name.startsWith('Tovar A'))).toMatchObject({ qtyBase: 10, total: 10000, profit: 4000 });
    expect(prods.find((p) => p.name.startsWith('Tovar B'))).toMatchObject({ qtyBase: 6, total: 30000, profit: 18000 }); // chegirma qatorga kirmaydi (chek darajasida)
    const cashiers = (await c.get('/reports/cashiers')).body;
    expect(cashiers).toEqual([{ cashierId: expect.any(String), name: 'Alisher Navoiy', receipts: 3, total: 39000, paid: 27000, voided: 1 }]);
    const pays = Object.fromEntries((await c.get('/reports/payments')).body.map((p: { method: string; sum: number }) => [p.method, p.sum]));
    expect(pays).toEqual({ cash: 18000, card: 9000 });
    const debts = (await c.get('/reports/debts')).body;
    expect(debts.items.some((x: { name: string; totalDebt: number }) => x.name === 'Hisobot mijoz' && x.totalDebt === 12000)).toBe(true);
    expect(debts.aging.current).toBeGreaterThanOrEqual(12000);
    const pl = (await c.get('/reports/profit-loss')).body;
    expect(pl).toMatchObject({ revenue: 39000, costOfGoods: 18000, grossProfit: 21000, receipts: 3, expenses: 2700, netProfit: 18300 });
    const cf = (await c.get('/reports/cash-flow')).body;
    expect(cf.net).toBe(27000 - 2700);
    expect(cf.outflow.map((o: { method: string; sum: number }) => [o.method, o.sum]).sort()).toEqual([['card', 700], ['cash', 2000]]);
    expect((await c.get('/reports/revenue?from=bad')).status).toBe(400);
  });

  it('low-stock ro\'yxati va kassir uchun 403 (view_inventory/view_analytics yo\'q)', async () => {
    const low = (await c.get('/reports/low-stock')).body;
    expect(low.length).toBe(1);
    expect((await s.kassir.get('/reports/low-stock')).status).toBe(403);
    expect((await s.omborchi.get('/reports/low-stock')).status).toBe(200);
  });
});
