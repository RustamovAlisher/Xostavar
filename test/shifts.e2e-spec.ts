import { INestApplication } from '@nestjs/common';
import { code, createApp, makeProduct, seeded, uniq, type Seeded, today as todayStr } from './helpers.js';

describe('shifts (TZ 7.7, 8.9, 9.7)', () => {
  let app: INestApplication;
  let s: Seeded;
  let branch: string;
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
    // Alohida filial: boshqa testlarning smenasi xalaqit bermasin
    branch = (await s.admin.post('/branches', { name: uniq('Smena ') }, { idem: false })).body.id;
  });
  afterAll(() => app.close());

  it('ochish: boshlang\'ich naqd; ikkinchi marta 409; current jamlari nol', async () => {
    const c = s.admin.at(branch);
    const r = await c.post('/shifts/open', { openingCash: 150000 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ branchId: branch, openedByName: 'Alisher Navoiy', openingCash: 150000, closedAt: null });
    expect(code(await c.post('/shifts/open', {}))).toBe('in_use');
    const cur = (await c.get('/shifts/current')).body;
    expect(cur.totals).toMatchObject({ cash: 0, card: 0, receipts: 0, revenue: 0, cashOut: 0, voided: 0, byMethod: {} });
    expect((await c.post('/shifts/open', { openingCash: -5 })).status).toBe(400);
  });

  it("har kassirning o'z smenasi: admin smenasi ochiq bo'lsa ham kassir o'zinikini ochadi va sotadi; bir xodimda ikkinchi smena 409; boshqaning smenasini faqat manage_users shiftId bilan yopadi", async () => {
    const main = s.admin;
    const cur = await main.get('/shifts/current');
    if (cur.body?.id) await main.post('/shifts/close', {});
    const kcur = await s.kassir.get('/shifts/current');
    if (kcur.body?.id) await s.kassir.post('/shifts/close', {});
    const adminShift = (await main.post('/shifts/open', { openingCash: 0 })).body;
    const p = await makeProduct(main, s, { stock: 5, price: 1000 });
    const sell = () => s.kassir.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 1 }], payments: [{ methodId: s.methods.cash, amount: 1000 }] });
    // kassirning o'z smenasi yo'q — sota olmaydi, o'zinikini ochadi (admin smenasi xalaqit bermaydi)
    expect((await s.kassir.get('/shifts/current')).body?.id).toBeUndefined();
    expect(code(await sell())).toBe('shift_required');
    const mine = await s.kassir.post('/shifts/open', {});
    expect(mine.status).toBe(201);
    expect(code(await s.kassir.post('/shifts/open', {}))).toBe('in_use');
    const sale = await sell();
    expect(sale.status).toBe(201);
    expect(sale.body.shiftId).toBe(mine.body.id); // chek kassirning o'z smenasiga yoziladi
    expect((await main.get('/shifts/current')).body.totals.receipts).toBe(0);
    expect((await s.kassir.get('/shifts/current')).body.totals.receipts).toBe(1);
    // ochiq smenalar ro'yxati — faqat manage_users; kassir boshqaning smenasini yopa olmaydi
    expect((await s.kassir.get('/shifts/open')).status).toBe(403);
    const open = (await main.get('/shifts/open')).body as { id: string }[];
    expect(open.map((x) => x.id)).toEqual(expect.arrayContaining([adminShift.id, mine.body.id]));
    expect(code(await s.kassir.post('/shifts/close', { shiftId: adminShift.id }))).toBe('shift_owned_by_other');
    // administrator kassirning unutilgan smenasini yopadi; yopilganini qayta yopib bo'lmaydi
    const closed = await main.post('/shifts/close', { shiftId: mine.body.id });
    expect(closed.status).toBe(201);
    expect(closed.body.totals.receipts).toBe(1);
    expect((await main.post('/shifts/close', { shiftId: mine.body.id })).status).toBe(404);
    expect((await s.kassir.get('/shifts/current')).body?.id).toBeUndefined();
    expect((await main.post('/shifts/close', {})).status).toBe(201);
  });

  it('yopish: jamlar muzlatiladi, kutilgan naqd = boshlang\'ich + naqd tushum − kassadan chiqim, farq; yopilgan smena qayta yopilmaydi', async () => {
    const c = s.admin.at(branch);
    const p = await makeProduct(c, s, { stock: 10, price: 10000 });
    await c.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 2 }], payments: [{ methodId: s.methods.cash, amount: 20000 }] });
    await c.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 1 }], payments: [{ methodId: s.methods.card, amount: 10000 }] });
    const cat = s.settings.expenseCategories[0].id;
    await c.post('/expenses', { date: todayStr(), categoryId: cat, amount: 5000, methodId: s.methods.cash, source: 'cash_register' });
    const r = await c.post('/shifts/close', { countedCash: 160000 });
    expect(r.status).toBe(201);
    expect(r.body.totals).toMatchObject({ cash: 20000, card: 10000, receipts: 2, revenue: 30000, cashOut: 5000, byMethod: { cash: 20000, card: 10000 } });
    expect(r.body).toMatchObject({ expectedCash: 150000 + 20000 - 5000, closingCashCounted: 160000 });
    expect(r.body.closedAt).toBeTruthy();
    expect((await c.get('/shifts/current')).body?.id).toBeUndefined();
    expect(code(await c.post('/shifts/close', {}))).toBe('not_found');
    const rep = (await c.get(`/shifts/${r.body.id}/report`)).body;
    expect(rep.totals.revenue).toBe(30000);
    expect(rep.expectedCash).toBe(165000);
    expect(rep.methodLabels.cash).toBe('Naqd pul');
    const list = (await c.get('/shifts')).body;
    expect(list.items[0].id).toBe(r.body.id);
    expect((await s.kassir.get('/shifts')).status).toBe(403); // view_analytics kerak
  });

  it('require_shift=false bo\'lsa smenasiz sotuv mumkin (shiftId null)', async () => {
    const d = (await s.admin.get('/settings')).body;
    await s.admin.put('/settings', { ...d, rules: { ...d.rules, requireShift: false } });
    const c = s.admin.at(branch);
    const p = await makeProduct(c, s, { stock: 5, price: 1000 });
    const r = await c.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 1 }], payments: [{ methodId: s.methods.cash, amount: 1000 }] });
    expect(r.status).toBe(201);
    expect(r.body.shiftId).toBeNull();
    await s.admin.put('/settings', { ...d, rules: { ...d.rules, requireShift: true } });
    expect(code(await c.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 1 }], payments: [{ methodId: s.methods.cash, amount: 1000 }] }))).toBe('shift_required');
  });

  it('bir vaqtda ikkita ochish so\'rovi: faqat bittasi muvaffaqiyatli (qisman unikal indeks)', async () => {
    const c = s.admin.at(branch);
    const rs = await Promise.all(Array.from({ length: 5 }, () => c.post('/shifts/open', {})));
    const ok = rs.filter((r) => r.status === 201).length;
    expect(ok).toBe(1);
    expect(rs.filter((r) => r.status === 409).length).toBe(4);
    await c.post('/shifts/close', {});
  });
});
