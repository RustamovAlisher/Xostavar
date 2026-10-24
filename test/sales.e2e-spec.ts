import { INestApplication } from '@nestjs/common';
import { as, code, createApp, ensureShift, makeProduct, seeded, uniq, type Client, type Seeded } from './helpers.js';

const phone = () => '+998 9' + String(Math.floor(10000000 + Math.random() * 89999999));

describe('sales (TZ 8, 9.6, 20)', () => {
  let app: INestApplication;
  let s: Seeded;
  let branch: string;
  let c: Client; // admin shu filialda
  let close: () => Promise<unknown>;
  let arm: { id: string; variants: { id: string }[] };
  let cement: { id: string };
  let customer: { id: string };
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
    branch = (await s.admin.post('/branches', { name: uniq('Kassa ') }, { idem: false })).body.id;
    c = s.admin.at(branch);
    arm = (await c.post('/products', {
      name: uniq('Armatura '), categoryId: s.cats['Armatura'], baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'piece', factor: 11.7 }], isVariable: true,
      variants: [{ name: 'Ø 12', retailPrice: 12500, conversions: [{ unit: 'kg', factor: 1.1261 }] }],
    }, { idem: false })).body;
    cement = await makeProduct(c, s, { name: uniq('Sement '), baseUnit: 'bag', price: 65000, conversions: [{ unit: 'kg', factor: 0.02, price: 1400 }], category: 'Sement va aralashmalar' });
    await c.post('/stock-in', { lines: [{ productId: arm.id, variantId: arm.variants[0].id, unit: 'piece', qty: 100, costPerUnit: 140000 }, { productId: cement.id, unit: 'bag', qty: 100, costPerUnit: 56000 }] });
    customer = (await c.post('/customers', { name: 'Nasiya Mijoz', phone: phone(), creditLimit: 500_000 }, { idem: false })).body;
    close = await ensureShift(c, 200_000);
  });
  afterAll(async () => {
    await close();
    await app.close();
  });

  const cash = (amount: number) => [{ methodId: s.methods.cash, amount }];

  describe('quote', () => {
    it('narxlar serverda: dona, metr (kesim), kg; chegirma; QQS; foyda (view_cost_price); available', async () => {
      const r = await c.post('/sales/quote', {
        lines: [
          { productId: arm.id, variantId: arm.variants[0].id, unit: 'piece', qty: 2 },
          { productId: arm.id, variantId: arm.variants[0].id, unit: 'meter', qty: 0, cuts: [{ lengthMeters: 6, quantity: 2 }] },
          { productId: cement.id, unit: 'kg', qty: 10 },
        ],
        discountAmount: 10000,
      }, { idem: false });
      expect(r.status).toBe(200);
      expect(r.body.lines[0]).toMatchObject({ unit: 'piece', qty: 2, baseQty: 23.4, unitPrice: 146250, lineTotal: 292500, available: 1170 });
      expect(r.body.lines[1]).toMatchObject({ unit: 'meter', qty: 12, baseQty: 12, unitPrice: 12500, lineTotal: 150000 });
      // 10 kg sement = 0.2 qop → bo'linmas: 1 qop (50 kg), kg narxi 1400
      expect(r.body.lines[2]).toMatchObject({ unit: 'kg', qty: 50, baseQty: 1, unitPrice: 1400, lineTotal: 70000 });
      expect(r.body).toMatchObject({ subtotal: 512500, discountAmount: 10000, totalAmount: 502500, warnings: [] });
      expect(r.body.vatIncluded).toBeCloseTo((502500 * 12) / 112, 1);
      // foyda: 502500 − (23.4+12)×11965.81 − 1×56000
      expect(r.body.profit).toBe(Math.round(502500 - 35.4 * 11965.81 - 56000));
      expect(r.body.lines[0].costPerBase).toBeCloseTo(11965.81, 1);
      const kas = await (await as(app, 'kassir')).post('/sales/quote', { lines: [{ productId: cement.id, unit: 'bag', qty: 1 }] }, { idem: false });
      // kassir main filialda: cement bu filialda yo'q → not_in_branch (filial konteksti to'g'ri ishlayapti)
      expect(code(kas)).toBe('not_in_branch');
    });
    it('chegirma subtotal dan oshmaydi; manfiy chegirma 400; miqdor 0 → 422', async () => {
      const r = await c.post('/sales/quote', { lines: [{ productId: cement.id, unit: 'bag', qty: 1 }], discountAmount: 999999 }, { idem: false });
      expect(r.body).toMatchObject({ subtotal: 65000, discountAmount: 65000, totalAmount: 0 });
      expect((await c.post('/sales/quote', { lines: [{ productId: cement.id, unit: 'bag', qty: 1 }], discountAmount: -1 }, { idem: false })).status).toBe(400);
      expect(code(await c.post('/sales/quote', { lines: [{ productId: cement.id, unit: 'bag', qty: 0 }] }, { idem: false }))).toBe('validation_failed');
    });
    it('xatolar: omborda yo\'q (not_in_branch), birlik (unit_not_allowed), narxsiz (price_missing), variant tanlanmagan, mahsulot yo\'q', async () => {
      const noStock = await makeProduct(c, s, { price: 100 });
      expect(code(await c.post('/sales/quote', { lines: [{ productId: noStock.id, unit: 'piece', qty: 1 }] }, { idem: false }))).toBe('not_in_branch');
      expect(code(await c.post('/sales/quote', { lines: [{ productId: cement.id, unit: 'box', qty: 1 }] }, { idem: false }))).toBe('unit_not_allowed');
      const free = await makeProduct(c, s, { price: 0, stock: 5 });
      expect(code(await c.post('/sales/quote', { lines: [{ productId: free.id, unit: 'piece', qty: 1 }] }, { idem: false }))).toBe('price_missing');
      expect(code(await c.post('/sales/quote', { lines: [{ productId: arm.id, unit: 'piece', qty: 1 }] }, { idem: false }))).toBe('validation_failed');
      expect((await c.post('/sales/quote', { lines: [{ productId: '00000000-0000-4000-8000-000000000000', unit: 'piece', qty: 1 }] }, { idem: false })).status).toBe(404);
    });
    it('qoldiq yetmasa: allow_negative_stock=false → 422 insufficient_stock; true → warning', async () => {
      const r = await c.post('/sales/quote', { lines: [{ productId: cement.id, unit: 'bag', qty: 60 }, { productId: cement.id, unit: 'bag', qty: 50 }] }, { idem: false });
      expect(code(r)).toBe('insufficient_stock');
      expect(r.body.error.details).toMatchObject({ available: 100, requested: 110 });
      const d = (await s.admin.get('/settings')).body;
      await s.admin.put('/settings', { ...d, rules: { ...d.rules, allowNegativeStock: true } });
      const w = await c.post('/sales/quote', { lines: [{ productId: cement.id, unit: 'bag', qty: 110 }] }, { idem: false });
      expect(w.status).toBe(200);
      expect(w.body.warnings[0].code).toBe('insufficient_stock');
      await s.admin.put('/settings', { ...d, rules: { ...d.rules, allowNegativeStock: false } });
    });
  });

  describe('sotuv', () => {
    it('oddiy sotuv: chek raqami KOD-YYYYMMDD-NNNN ketma-ket, to\'lov qismi, qoldiq ayriladi, jurnal, audit; javobda foyda faqat view_cost_price', async () => {
      const before = (await c.get(`/products/${cement.id}`)).body.stock;
      const r = await c.post('/sales', { lines: [{ productId: cement.id, unit: 'bag', qty: 2 }], payments: cash(130000) });
      expect(r.status).toBe(201);
      const branchCode = (await s.admin.get('/branches')).body.find((b: { id: string }) => b.id === branch).code;
      expect(r.body.number).toMatch(new RegExp(`^${branchCode}-\\d{8}-\\d{4}$`));
      expect(r.body).toMatchObject({ type: 'sale', status: 'completed', paymentSummary: 'cash', subtotal: 130000, totalAmount: 130000, paidAmount: 130000, remainingDebt: 0, customerName: 'Oddiy mijoz', profit: 130000 - 2 * 56000 });
      expect(r.body.payments).toEqual([{ method: 'cash', methodId: s.methods.cash, kind: 'cash', amount: 130000, ref: null }]);
      expect(r.body.lines[0]).toMatchObject({ name: expect.stringContaining('Sement'), qty: 2, baseQty: 2, unitPrice: 65000, lineTotal: 130000, costPerBase: 56000 });
      expect((await c.get(`/products/${cement.id}`)).body.stock).toBe(before - 2);
      const r2 = await c.post('/sales', { lines: [{ productId: cement.id, unit: 'bag', qty: 1 }], payments: cash(65000) });
      expect(Number(r2.body.number.slice(-4))).toBe(Number(r.body.number.slice(-4)) + 1);
      const mv = (await c.get(`/stock-movements?productId=${cement.id}`)).body.items[0];
      expect(mv).toMatchObject({ type: 'sale', qtyBase: -1, refId: r2.body.id });
      const log = (await c.get(`/audit-logs?action=sale&pageSize=1`)).body.items[0];
      expect(log.branchId).toBe(branch);
      expect(log.targetName).toContain(r2.body.number);
    });
    it('to\'lov yig\'indisi: ko\'p → 422; kam va onCredit yo\'q → 422; bitta usul ikki marta → 422; o\'chirilgan usul → payment_method_disabled', async () => {
      const line = { lines: [{ productId: cement.id, unit: 'bag', qty: 1 }] };
      expect(code(await c.post('/sales', { ...line, payments: cash(70000) }))).toBe('validation_failed');
      const less = await c.post('/sales', { ...line, payments: cash(60000) });
      expect(less.body.error.message).toMatch(/5\s000 so'm yetmayapti/);
      expect(code(await c.post('/sales', { ...line, payments: [...cash(30000), ...cash(35000)] }))).toBe('validation_failed');
      const d = (await s.admin.get('/settings')).body;
      await s.admin.put('/settings', { ...d, paymentMethods: d.paymentMethods.map((m: { code: string }) => (m.code === 'card' ? { ...m, enabled: false } : m)) });
      expect(code(await c.post('/sales', { ...line, payments: [{ methodId: s.methods.card, amount: 65000 }] }))).toBe('payment_method_disabled');
      await s.admin.put('/settings', d);
      expect(code(await c.post('/sales', { ...line, payments: [{ methodId: s.methods.debt, amount: 65000 }] }))).toBe('validation_failed');
    });
    it('aralash to\'lov: naqd + karta, paymentSummary=mixed, smena jamlari usul bo\'yicha', async () => {
      const before = (await c.get('/shifts/current')).body.totals;
      const r = await c.post('/sales', { lines: [{ productId: cement.id, unit: 'bag', qty: 2 }], discountAmount: 10000, payments: [{ methodId: s.methods.cash, amount: 70000 }, { methodId: s.methods.card, amount: 50000, ref: 'T-123' }] });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ paymentSummary: 'mixed', totalAmount: 120000, paidAmount: 120000, discountAmount: 10000 });
      expect(r.body.payments.map((p: { method: string; amount: number; ref: string }) => [p.method, p.amount, p.ref])).toEqual([['cash', 70000, null], ['card', 50000, 'T-123']]);
      const after = (await c.get('/shifts/current')).body.totals;
      expect(after.cash - before.cash).toBe(70000);
      expect(after.card - before.card).toBe(50000);
      expect(after.receipts - before.receipts).toBe(1);
    });
    it('nasiya: onCredit, mijoz majburiy (debtor_required), limit (credit_limit_exceeded), give_debt huquqi; qarz va muddat yangilanadi', async () => {
      const line = { lines: [{ productId: cement.id, unit: 'bag', qty: 3 }] };
      expect(code(await c.post('/sales', { ...line, onCredit: true }))).toBe('debtor_required');
      const over = await c.post('/sales', { ...line, customerId: customer.id, onCredit: true, payments: cash(0) });
      expect(code(over)).toBe('validation_failed'); // amount ≥ 1
      const tooMuch = await c.post('/sales', { lines: [{ productId: cement.id, unit: 'bag', qty: 10 }], customerId: customer.id, onCredit: true });
      expect(code(tooMuch)).toBe('credit_limit_exceeded');
      expect(tooMuch.body.error.details).toMatchObject({ limit: 500000, debt: 0, requested: 650000 });
      const r = await c.post('/sales', { ...line, customerId: customer.id, onCredit: true, payments: cash(45000) });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ paymentSummary: 'cash', totalAmount: 195000, paidAmount: 45000, remainingDebt: 150000, customerDebtAfter: 150000, customerName: 'Nasiya Mijoz' });
      const cu = (await c.get(`/customers/${customer.id}`)).body;
      expect(cu.totalDebtUZS).toBe(150000);
      expect(cu.dueDate > new Date().toISOString().slice(0, 10)).toBe(true);
      // to'liq nasiya (to'lovsiz)
      const full = await c.post('/sales', { lines: [{ productId: cement.id, unit: 'bag', qty: 1 }], customerId: customer.id, onCredit: true });
      expect(full.body).toMatchObject({ paymentSummary: 'debt', paidAmount: 0, remainingDebt: 65000, customerDebtAfter: 215000 });
      expect(full.body.payments).toEqual([]);
      // omborchi (give_debt yo'q) nasiya bera olmaydi — o'z filialida ombor bo'lmagani uchun avval main'da sinaymiz
      const mp = await makeProduct(s.admin, s, { stock: 5, price: 1000 });
      const closeMain = await ensureShift(s.omborchi);
      expect(code(await s.omborchi.post('/sales', { lines: [{ productId: mp.id, unit: 'piece', qty: 1 }], customerId: customer.id, onCredit: true }))).toBe('forbidden');
      await closeMain();
    });
    it('kassir chegirma chegarasi (cashier_max_discount): kassir oshira olmaydi, administrator oladi', async () => {
      const d = (await s.admin.get('/settings')).body;
      await s.admin.put('/settings', { ...d, rules: { ...d.rules, cashierMaxDiscount: 5000 } });
      const kassir = await as(app, 'kassir');
      const mp = await makeProduct(s.admin, s, { stock: 10, price: 10000 });
      const closeMain = await ensureShift(kassir);
      const r = await kassir.post('/sales', { lines: [{ productId: mp.id, unit: 'piece', qty: 1 }], discountAmount: 6000, payments: cash(4000) });
      expect(code(r)).toBe('discount_too_large');
      expect((await kassir.post('/sales', { lines: [{ productId: mp.id, unit: 'piece', qty: 1 }], discountAmount: 5000, payments: cash(5000) })).status).toBe(201);
      await closeMain();
      const closeAdmin = await ensureShift(s.admin);
      expect((await s.admin.post('/sales', { lines: [{ productId: mp.id, unit: 'piece', qty: 1 }], discountAmount: 6000, payments: cash(4000) })).status).toBe(201);
      await closeAdmin();
      await s.admin.put('/settings', d);
    });
    it('idempotentlik: bir xil kalit → bir xil chek, qoldiq bir marta; clientId takrori → avvalgi chek', async () => {
      const before = (await c.get(`/products/${cement.id}`)).body.stock;
      const key = uniq('k');
      const a = await c.post('/sales', { lines: [{ productId: cement.id, unit: 'bag', qty: 1 }], payments: cash(65000) }, { idem: key });
      const b = await c.post('/sales', { lines: [{ productId: cement.id, unit: 'bag', qty: 1 }], payments: cash(65000) }, { idem: key });
      expect(b.body.id).toBe(a.body.id);
      expect(b.headers['idempotent-replayed']).toBe('true');
      const clientId = '11111111-2222-4333-8444-555555555555';
      const c1 = await c.post('/sales', { clientId, lines: [{ productId: cement.id, unit: 'bag', qty: 1 }], payments: cash(65000) });
      const c2 = await c.post('/sales', { clientId, lines: [{ productId: cement.id, unit: 'bag', qty: 5 }], payments: cash(325000) });
      expect(c2.status).toBe(201);
      expect(c2.body.id).toBe(c1.body.id);
      expect((await c.get(`/products/${cement.id}`)).body.stock).toBe(before - 2);
    });
    it('kesim bilan sotuv: ombordan sof metr (net) yoki butun tayoqlar (bars) ayriladi, mijoz sof metr uchun to\'laydi', async () => {
      const before = (await c.get(`/products/${arm.id}`)).body.variants[0].stock;
      const net = await c.post('/sales', { lines: [{ productId: arm.id, variantId: arm.variants[0].id, unit: 'meter', qty: 0, cuts: [{ lengthMeters: 6, quantity: 2 }, { lengthMeters: 3.5, quantity: 1 }] }], payments: cash(12500 * 15.5) });
      expect(net.status).toBe(201);
      expect(net.body.lines[0]).toMatchObject({ qty: 15.5, baseQty: 15.5, lineTotal: 193750, cuts: [{ lengthMeters: 6, quantity: 2 }, { lengthMeters: 3.5, quantity: 1 }] });
      const d = (await s.admin.get('/settings')).body;
      await s.admin.put('/settings', { ...d, rules: { ...d.rules, cutDeductionMode: 'bars' } });
      const bars = await c.post('/sales', { lines: [{ productId: arm.id, variantId: arm.variants[0].id, unit: 'meter', qty: 0, cuts: [{ lengthMeters: 6, quantity: 2 }, { lengthMeters: 3.5, quantity: 1 }] }], payments: cash(193750) });
      expect(bars.body.lines[0]).toMatchObject({ qty: 15.5, baseQty: 23.4, lineTotal: 193750 });
      await s.admin.put('/settings', d);
      expect((await c.get(`/products/${arm.id}`)).body.variants[0].stock).toBeCloseTo(before - 15.5 - 23.4, 3);
    });
    it('huquq: view_pos yo\'q (buxgalterda bor), manfiy miqdor, bo\'sh qatorlar, Idempotency-Key yo\'q → 400', async () => {
      expect((await c.post('/sales', { lines: [] })).status).toBe(400);
      expect((await c.post('/sales', { lines: [{ productId: cement.id, unit: 'bag', qty: -1 }] })).status).toBe(400);
      expect((await c.post('/sales', { lines: [{ productId: cement.id, unit: 'bag', qty: 1 }], payments: cash(65000) }, { idem: false })).status).toBe(400);
    });
  });

  describe('qarz to\'lovi va storno', () => {
    it('qarz to\'lovi: debt_payment chek, ledger, lastPaidDate; qarzdan ko\'p → 422; smena kerak', async () => {
      const before = (await c.get(`/customers/${customer.id}`)).body.totalDebtUZS;
      const r = await c.post(`/customers/${customer.id}/payments`, { amount: 50000, methodId: s.methods.card });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ type: 'debt_payment', totalAmount: 50000, paidAmount: 50000, paymentSummary: 'card', customerDebtAfter: before - 50000, customerName: 'Nasiya Mijoz' });
      expect(r.body.number).toMatch(/-\d{4}$/);
      expect((await c.get(`/customers/${customer.id}`)).body).toMatchObject({ totalDebtUZS: before - 50000, lastPaidDate: new Date().toISOString().slice(0, 10) });
      expect(code(await c.post(`/customers/${customer.id}/payments`, { amount: 9_999_999, methodId: s.methods.cash }))).toBe('validation_failed');
      expect(code(await c.post(`/customers/${customer.id}/payments`, { amount: 100, methodId: s.methods.debt }))).toBe('payment_method_disabled');
      expect((await c.post(`/customers/${customer.id}/payments`, { amount: 0, methodId: s.methods.cash })).status).toBe(400);
      expect((await c.get('/shifts/current')).body.totals.debtPayments).toBeGreaterThanOrEqual(50000);
    });
    it('storno: faqat manage_users, sabab majburiy; qoldiq qaytadi (sale_void), nasiya qarzi kamayadi; takror → already_voided; boshqa filial → 403', async () => {
      const stockBefore = (await c.get(`/products/${cement.id}`)).body.stock;
      const sale = await c.post('/sales', { lines: [{ productId: cement.id, unit: 'bag', qty: 2 }], customerId: customer.id, onCredit: true, payments: cash(30000) });
      expect(sale.status).toBe(201);
      const debtBefore = (await c.get(`/customers/${customer.id}`)).body.totalDebtUZS;
      expect((await c.post(`/sales/${sale.body.id}/void`, { reason: '' })).status).toBe(400);
      const kassir = await as(app, 'kassir');
      expect((await kassir.at(branch).post(`/sales/${sale.body.id}/void`, { reason: 'x' })).status).toBe(403);
      expect(code(await s.admin.post(`/sales/${sale.body.id}/void`, { reason: 'x' }))).toBe('branch_forbidden'); // main kontekstida
      const r = await c.post(`/sales/${sale.body.id}/void`, { reason: 'mijoz qaytardi' });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ status: 'voided', voidReason: 'mijoz qaytardi', voidedByName: 'Alisher Navoiy' });
      expect((await c.get(`/products/${cement.id}`)).body.stock).toBe(stockBefore);
      expect((await c.get(`/customers/${customer.id}`)).body.totalDebtUZS).toBe(debtBefore - 100000);
      expect((await c.get(`/stock-movements?productId=${cement.id}`)).body.items[0]).toMatchObject({ type: 'sale_void', qtyBase: 2 });
      expect(code(await c.post(`/sales/${sale.body.id}/void`, { reason: 'yana' }))).toBe('already_voided');
      const pay = (await c.get('/sales?type=debt_payment&pageSize=1')).body.items[0];
      expect(code(await c.post(`/sales/${pay.id}/void`, { reason: 'x' }))).toBe('validation_failed');
      // Jamlardan chiqadi
      expect((await c.get('/shifts/current')).body.totals.voided).toBeGreaterThanOrEqual(1);
    });
    it('storno chekka holati: mijoz nasiya chekidan keyin qisman to\'lagan — qarz 0 gacha, ortig\'i auditda "naqd qaytariladi"', async () => {
      const cu = (await c.post('/customers', { name: 'Chekka', phone: phone(), creditLimit: 1_000_000 }, { idem: false })).body;
      const sale = await c.post('/sales', { lines: [{ productId: cement.id, unit: 'bag', qty: 2 }], customerId: cu.id, onCredit: true });
      await c.post(`/customers/${cu.id}/payments`, { amount: 100000, methodId: s.methods.cash });
      expect((await c.get(`/customers/${cu.id}`)).body.totalDebtUZS).toBe(30000);
      const r = await c.post(`/sales/${sale.body.id}/void`, { reason: 'qaytarish' });
      expect(r.status).toBe(201);
      expect((await c.get(`/customers/${cu.id}`)).body.totalDebtUZS).toBe(0);
      const log = (await c.get('/audit-logs?action=sale_void&pageSize=1')).body.items[0];
      expect(log.details).toMatch(/30\s000 so'm qarz qaytarildi/);
      expect(log.details).toMatch(/100\s000 so'mni avval to'lagan/);
    });
  });

  describe('ro\'yxat', () => {
    it('filtrlar: davr, tur, holat, mijoz, qidiruv (raqam/mijoz/mahsulot); kassir faqat o\'z cheklarini ko\'radi', async () => {
      const all = (await c.get('/sales?pageSize=200')).body;
      expect(all.total).toBeGreaterThan(5);
      expect(all.items.every((x: { branchId: string }) => x.branchId === branch)).toBe(true);
      expect(all.items[0].lines).toBeDefined();
      expect((await c.get('/sales?type=debt_payment')).body.items.every((x: { type: string }) => x.type === 'debt_payment')).toBe(true);
      expect((await c.get('/sales?status=voided')).body.items.every((x: { status: string }) => x.status === 'voided')).toBe(true);
      expect((await c.get(`/sales?customerId=${customer.id}`)).body.items.every((x: { customerId: string }) => x.customerId === customer.id)).toBe(true);
      expect((await c.get('/sales?q=Sement')).body.total).toBeGreaterThan(0);
      expect((await c.get('/sales?from=2099-01-01')).body.total).toBe(0);
      const num = all.items[0].number;
      expect((await c.get(`/sales?q=${num}`)).body.items[0].number).toBe(num);
      const kassir = await as(app, 'kassir');
      const mine = (await kassir.get('/sales?pageSize=200')).body.items as { cashierName: string }[];
      expect(mine.every((x) => x.cashierName === 'Jasur Mirzayev')).toBe(true);
      // bitta chek — kassir foyda ko'rmaydi
      const firstSale = all.items.find((x: { type: string }) => x.type === 'sale');
      const one = (await kassir.get(`/sales/${firstSale.id}`)).body;
      expect(one.profit).toBeUndefined();
      expect(one.lines[0].costPerBase).toBeUndefined();
    });
  });
});
