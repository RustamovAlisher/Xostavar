import { INestApplication } from '@nestjs/common';
import { as, code, createApp, ensureShift, makeProduct, seeded, uniq, type Client, type Seeded, today as todayStr } from './helpers.js';

const phone = () => '+998 9' + String(Math.floor(10000000 + Math.random() * 89999999));

/** Id bilan so'ralganda ham filial/egalik chegarasi; yopilgan smena Z-hisoboti; filial narxi; quote ogohlantirishlari. */
describe('scope, frozen Z-report, branch prices, quote warnings', () => {
  let app: INestApplication;
  let s: Seeded;
  let branchB: string;
  let badmin: Client;
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
    branchB = (await s.admin.post('/branches', { name: uniq('Scope ') }, { idem: false })).body.id;
    const roleId = (await s.admin.get('/roles')).body.find((r: { name: string }) => r.name === 'Filial admini').id;
    const u = (await s.admin.post('/users', { name: 'FA', username: uniq('fa'), roleId, password: 'Parol-12345', branchIds: [branchB] }, { idem: false })).body;
    badmin = await as(app, u.username, 'Parol-12345');
    await badmin.post('/auth/change-password', { currentPassword: 'Parol-12345', newPassword: 'Filial-Admin-S1' }, { idem: false });
  });
  afterAll(() => app.close());

  it('kirim hujjati, smena hisoboti va chek id bilan ham boshqa filial uchun 403; kassir faqat o\'z chekini', async () => {
    const p = await makeProduct(s.admin, s, { stock: 5, price: 1000 });
    const receipt = (await s.admin.get(`/stock-in?productId=${p.id}`)).body.items[0];
    expect(code(await badmin.get(`/stock-in/${receipt.id}`))).toBe('branch_forbidden');
    expect((await s.admin.get(`/stock-in/${receipt.id}`)).status).toBe(200);
    const close = await ensureShift(s.admin);
    const sale = await s.admin.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 1 }], payments: [{ methodId: s.methods.cash, amount: 1000 }] });
    const shiftId = sale.body.shiftId;
    await close();
    expect(code(await badmin.get(`/shifts/${shiftId}/report`))).toBe('branch_forbidden');
    expect(code(await badmin.get(`/sales/${sale.body.id}`))).toBe('branch_forbidden');
    // Kassir (main): boshqa kassirning chekini id bilan ko'ra olmaydi, o'zinikini ko'radi
    const kassir = await as(app, 'kassir');
    expect((await kassir.get(`/sales/${sale.body.id}`)).status).toBe(403);
    const closeK = await ensureShift(kassir);
    const own = await kassir.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 1 }], payments: [{ methodId: s.methods.cash, amount: 1000 }] });
    await closeK();
    expect((await kassir.get(`/sales/${own.body.id}`)).status).toBe(200);
    expect((await s.buxgalter.get(`/sales/${own.body.id}`)).status).toBe(200); // view_analytics
  });

  it('yopilgan smenadagi chek storno qilinsa yoki kassadan chiqim o\'chirilsa Z-hisobot qayta hisoblanadi', async () => {
    const c = s.admin.at(branchB);
    const p = await makeProduct(c, s, { stock: 10, price: 10000 });
    await c.post('/shifts/open', { openingCash: 50000 });
    const sale = await c.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 2 }], payments: [{ methodId: s.methods.cash, amount: 20000 }] });
    const exp = await c.post('/expenses', { date: todayStr(), categoryId: s.settings.expenseCategories[0].id, amount: 5000, methodId: s.methods.cash, source: 'cash_register' });
    const closed = await c.post('/shifts/close', {});
    expect(closed.body.totals).toMatchObject({ cash: 20000, receipts: 1, cashOut: 5000 });
    expect(closed.body.expectedCash).toBe(65000);
    await c.post(`/sales/${sale.body.id}/void`, { reason: 'xato chek' });
    let rep = (await c.get(`/shifts/${closed.body.id}/report`)).body;
    expect(rep.totals).toMatchObject({ cash: 0, receipts: 0, voided: 1, cashOut: 5000 });
    expect(rep.expectedCash).toBe(45000);
    await c.post(`/expenses/${exp.body.id}/void`, {});
    rep = (await c.get(`/shifts/${closed.body.id}/report`)).body;
    expect(rep.totals.cashOut).toBe(0);
    expect(rep.expectedCash).toBe(50000);
    expect((await c.get(`/products/${p.id}`)).body.stock).toBe(10);
  });

  it('filial narxi: faqat shu filialda; quote va sotuv shu narx bilan; olib tashlansa umumiy narx', async () => {
    const c = s.admin.at(branchB);
    const p = await makeProduct(c, s, { stock: 10, price: 1000 });
    const r = await c.put(`/products/${p.id}/branch-price`, { retailPrice: 1500, wholesalePrice: 1200 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ retailPrice: 1500, wholesalePrice: 1200 });
    expect((await s.admin.get(`/products/${p.id}`)).body.retailPrice).toBe(1000); // main da umumiy
    const q = await c.post('/sales/quote', { lines: [{ productId: p.id, unit: 'piece', qty: 2 }] }, { idem: false });
    expect(q.body.lines[0].unitPrice).toBe(1500);
    expect(code(await c.put(`/products/${p.id}/branch-price`, { retailPrice: 0 }))).toBe('validation_failed');
    expect(code(await c.put(`/products/${p.id}/branch-price`, { retailPrice: 1, variantId: '00000000-0000-4000-8000-000000000000' }))).toBe('validation_failed');
    expect((await badmin.put(`/products/${p.id}/branch-price`, { retailPrice: 1 })).status).toBe(403); // edit_product yo'q
    // Parallel PUT lar: upsert bitta so'rovda — 500 yo'q, oxirgi qiymat qoladi
    const par = await Promise.all([1700, 1800, 1900].map((retailPrice) => c.put(`/products/${p.id}/branch-price`, { retailPrice })));
    expect(par.map((r) => r.status)).toEqual([200, 200, 200]);
    expect([1700, 1800, 1900]).toContain((await c.get(`/products/${p.id}`)).body.retailPrice);
    const d = await c.del(`/products/${p.id}/branch-price`);
    expect(d.body.retailPrice).toBe(1000);
    // Variantli mahsulot: variant uchun
    const arm = (await c.post('/products', { name: uniq('V '), categoryId: s.cats['Armatura'], baseUnit: 'meter', isDivisible: true, conversions: [], isVariable: true, variants: [{ name: 'Ø 10', retailPrice: 100 }] }, { idem: false })).body;
    expect(code(await c.put(`/products/${arm.id}/branch-price`, { retailPrice: 200 }))).toBe('validation_failed');
    const vr = await c.put(`/products/${arm.id}/branch-price`, { retailPrice: 200, variantId: arm.variants[0].id });
    expect(vr.body.variants[0].retailPrice).toBe(200);
    expect((await s.admin.get(`/products/${arm.id}`)).body.variants[0].retailPrice).toBe(100);
  });

  it('variantsiz mahsulot qoldig\'i bilan variantliga o\'tkazilmaydi (qoldiq yashirin qolmasin); qoldiq 0 bo\'lsa o\'tadi', async () => {
    const c = s.admin.at(branchB);
    const p = await makeProduct(c, s, { stock: 3, price: 1000 });
    const full = (await c.get(`/products/${p.id}`)).body;
    const toVariable = { name: full.name, categoryId: full.categoryId, sku: full.sku, baseUnit: full.baseUnit, isDivisible: full.isDivisible, conversions: [], isVariable: true, variants: [{ name: 'A', retailPrice: 1000 }], version: full.version };
    const r = await c.put(`/products/${p.id}`, toVariable);
    expect(code(r)).toBe('in_use');
    expect(r.body.error.message).toMatch(/qoldiq/);
    await c.post('/stock-adjustments', { productId: p.id, newStock: 0, reason: 'test' });
    const ok = await c.put(`/products/${p.id}`, toVariable);
    expect(ok.status).toBe(200);
    expect(ok.body.isVariable).toBe(true);
    expect(ok.body.stock).toBe(0);
  });

  it('quote: muddati o\'tgan mijoz va limit oshishi ogohlantirish sifatida (sotuvni to\'xtatmaydi)', async () => {
    const c = s.admin.at(branchB);
    const p = await makeProduct(c, s, { stock: 10, price: 100000 });
    const cu = (await c.post('/customers', { name: 'Ogoh', phone: phone(), creditLimit: 150000, dueDate: '2020-01-01' }, { idem: false })).body;
    const q = await c.post('/sales/quote', { lines: [{ productId: p.id, unit: 'piece', qty: 2 }], customerId: cu.id, onCredit: true }, { idem: false });
    expect(q.status).toBe(200);
    expect(q.body.warnings.map((w: { code: string }) => w.code)).toEqual(['credit_limit_exceeded']); // qarzi 0 → overdue emas
    await c.post('/shifts/open', {});
    await c.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 1 }], customerId: cu.id, onCredit: true });
    const cv = (await c.get(`/customers/${cu.id}`)).body;
    await c.patch(`/customers/${cu.id}`, { name: cv.name, phone: cv.phone, dueDate: '2020-01-01', version: cv.version });
    const q2 = await c.post('/sales/quote', { lines: [{ productId: p.id, unit: 'piece', qty: 1 }], customerId: cu.id, onCredit: true }, { idem: false });
    expect(q2.body.warnings.map((w: { code: string }) => w.code)).toEqual(['customer_overdue', 'credit_limit_exceeded']);
    expect((await c.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 1 }], customerId: cu.id, onCredit: true, payments: [{ methodId: s.methods.cash, amount: 60000 }] })).status).toBe(201); // muddati o'tgan bo'lsa ham ruxsat (TZ 8.8)
    await c.post('/shifts/close', {});
  });

  it('qidiruv: nom, SKU, variant va shtrix-kod bo\'yicha (lower/like, trigram indekslar) va mijoz nomi', async () => {
    const sku = uniq('QDR-').toUpperCase();
    const p = (await s.admin.post('/products', { name: 'Qidiruv Maxsus Nom ' + sku, categoryId: s.cats['Armatura'], sku, baseUnit: 'piece', isDivisible: false, conversions: [], retailPrice: 1, isVariable: false, barcodes: ['77' + sku.slice(-5)] }, { idem: false })).body;
    expect((await s.admin.get(`/products?q=${sku.toLowerCase()}`)).body.items[0].id).toBe(p.id);
    expect((await s.admin.get('/products?q=MAXSUS nom')).body.items.some((x: { id: string }) => x.id === p.id)).toBe(true);
    expect((await s.admin.get(`/products?q=77${sku.slice(-5)}`)).body.items[0].id).toBe(p.id);
    const cu = (await s.admin.post('/customers', { name: 'Qidiruv Mijoz Nomi', phone: phone() }, { idem: false })).body;
    expect((await s.admin.get('/customers?q=MIJOZ nomi')).body.items.some((x: { id: string }) => x.id === cu.id)).toBe(true);
  });
});
