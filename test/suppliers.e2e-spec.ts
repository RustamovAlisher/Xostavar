import { INestApplication } from '@nestjs/common';
import { code, createApp, ensureShift, makeProduct, rawDb, seeded, today, uniq, type Seeded } from './helpers.js';

describe('suppliers: yetkazib beruvchilarga qarz', () => {
  let app: INestApplication;
  let s: Seeded;
  let productId: string;
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
    productId = (await makeProduct(s.admin, s, { name: uniq('Armatura-kirim ') })).id;
  });
  afterAll(() => app.close());

  /** Kirim: 10 dona × 1000 = 10 000 so'm. */
  const receive = (extra: Record<string, unknown>, qty = 10) => s.admin.post('/stock-in', { lines: [{ productId, unit: 'piece', qty, costPerUnit: 1000 }], ...extra });
  const profile = async (id: string) => (await s.admin.get(`/suppliers/${id}`)).body;
  const supplierId = async (name: string) => ((await s.admin.get(`/suppliers?q=${encodeURIComponent(name)}`)).body.items as { id: string; name: string }[]).find((x) => x.name === name)!.id;

  it("qarzga kirim: paidAmount berilmasa qarz hisobi yuritilmaydi; 0 bo'lsa jami qarz; qisman to'langanda farqi", async () => {
    const name = uniq('Zavod ');
    const none = await receive({ supplierName: name });
    expect(none.status).toBe(201);
    expect(none.body.paidAmount).toBeNull();
    const id = await supplierId(name);
    expect((await profile(id)).supplier.totalDebt).toBe(0);

    const credit = await receive({ supplierName: name, invoice: 'INV-1', paidAmount: 0 });
    expect(credit.status).toBe(201);
    expect(credit.body.debtAmount).toBe(10000);
    expect(credit.body.debtSupplierId).toBe(id);
    expect((await profile(id)).supplier.totalDebt).toBe(10000);

    const part = await receive({ supplierName: name, paidAmount: 4000 });
    expect(part.body.debtAmount).toBe(6000);
    const p = await profile(id);
    expect(p.supplier.totalDebt).toBe(16000);
    expect(p.purchases).toHaveLength(3);
    expect(p.purchases[0]).toMatchObject({ total: 10000, paidAtReceipt: 4000, debt: 6000, left: 6000, tracked: true });
    expect(p.purchases[0].lines[0]).toMatchObject({ qty: 10, unit: 'piece', costPerUnit: 1000, totalCost: 10000 });
    expect(p.purchases[2]).toMatchObject({ tracked: false, debt: 0, left: 0 });
    expect(p.ledger.map((l: { type: string; amount: number }) => [l.type, l.amount])).toEqual([['purchase', 6000], ['purchase', 10000]]);
  });

  it("noto'g'ri holatlar: to'langan > jami, yetkazib beruvchisiz qarz → 422; to'liq to'langan kirim qarz yozmaydi", async () => {
    expect(code(await receive({ supplierName: uniq('Z '), paidAmount: 10001 }))).toBe('validation_failed');
    expect(code(await receive({ paidAmount: 0 }))).toBe('validation_failed');
    const name = uniq('Naqd ');
    const full = await receive({ supplierName: name, paidAmount: 10000 });
    expect(full.status).toBe(201);
    expect(full.body.debtAmount).toBe(0);
    const id = await supplierId(name);
    expect((await profile(id)).supplier.totalDebt).toBe(0);
    expect((await profile(id)).ledger).toHaveLength(0);
  });

  it("to'lov: qarzdan katta bo'lmaydi; qarz kamayadi; eng eski kirimdan yopiladi (FIFO); jurnal va audit yoziladi", async () => {
    const name = uniq('To\'lov ');
    await receive({ supplierName: name, paidAmount: 0, date: '2026-01-10' });
    await receive({ supplierName: name, paidAmount: 0, date: '2026-02-10' });
    const id = await supplierId(name);
    expect((await profile(id)).supplier.totalDebt).toBe(20000);

    expect(code(await s.admin.post(`/suppliers/${id}/payments`, { amount: 20001 }))).toBe('validation_failed');
    expect((await s.admin.post(`/suppliers/${id}/payments`, { amount: 0 })).status).toBe(400);
    const r = await s.admin.post(`/suppliers/${id}/payments`, { amount: 12000, methodId: s.methods.cash, note: 'Birinchi to\'lov' });
    expect(r.status).toBe(201);
    expect(r.body.supplier.totalDebt).toBe(8000);
    const byDate = Object.fromEntries(r.body.purchases.map((p: { date: string; left: number }) => [p.date, p.left]));
    expect(byDate).toEqual({ '2026-01-10': 0, '2026-02-10': 8000 });
    expect(r.body.ledger[0]).toMatchObject({ type: 'payment', amount: -12000, balanceAfter: 8000, note: "Birinchi to'lov" });
    expect(r.body.ledger[0].method).toBeTruthy();
    expect(code(await s.admin.post(`/suppliers/${id}/payments`, { amount: 100, methodId: s.methods.debt }))).toBe('payment_method_disabled');

    const logs = (await s.admin.get('/audit-logs?module=Yetkazib beruvchilar&pageSize=20')).body;
    expect(logs.items.some((l: { targetId: string; details: string }) => l.targetId === id && /^To'lov: 12\s000/.test(l.details))).toBe(true);

    expect((await s.admin.post(`/suppliers/${id}/payments`, { amount: 8000 })).body.supplier.totalDebt).toBe(0);
  });

  it("kirim qatori tahrirlansa qarz moslanadi; qator o'chirilsa va hujjat yo'qolsa qarz bekor bo'ladi", async () => {
    const name = uniq('Tahrir ');
    const rc = await receive({ supplierName: name, paidAmount: 2000 }, 10); // jami 10 000, qarz 8 000
    const id = await supplierId(name);
    expect((await profile(id)).supplier.totalDebt).toBe(8000);
    const lineId = rc.body.lines[0].id;

    // miqdor 10 → 15: jami 15 000, qarz 13 000
    expect((await s.admin.patch(`/stock-in/lines/${lineId}`, { qty: 15 })).status).toBe(200);
    expect((await profile(id)).supplier.totalDebt).toBe(13000);
    // miqdor 15 → 1: jami 1 000 < to'langan 2 000 → qarz 0
    expect((await s.admin.patch(`/stock-in/lines/${lineId}`, { qty: 1 })).status).toBe(200);
    expect((await profile(id)).supplier.totalDebt).toBe(0);
    expect((await s.admin.patch(`/stock-in/lines/${lineId}`, { qty: 10 })).status).toBe(200);
    expect((await profile(id)).supplier.totalDebt).toBe(8000);

    // oxirgi qator o'chadi — hujjat ham, qarz ham
    expect((await s.admin.del(`/stock-in/lines/${lineId}`)).status).toBe(200);
    const p = await profile(id);
    expect(p.supplier.totalDebt).toBe(0);
    expect(p.purchases).toHaveLength(0);
    expect(p.ledger[0]).toMatchObject({ type: 'purchase_edit', amount: -8000 });
  });

  it("kirimda yetkazib beruvchi almashsa qarz ham o'tadi; to'lov summasi o'zgarmaydi", async () => {
    const a = uniq('Birinchi '), b = uniq('Ikkinchi ');
    const rc = await receive({ supplierName: a, paidAmount: 0 });
    const idA = await supplierId(a);
    expect((await profile(idA)).supplier.totalDebt).toBe(10000);
    const r = await s.admin.patch(`/stock-in/lines/${rc.body.lines[0].id}`, { supplierName: b });
    expect(r.status).toBe(200);
    const idB = await supplierId(b);
    expect((await profile(idA)).supplier.totalDebt).toBe(0);
    expect((await profile(idB)).supplier.totalDebt).toBe(10000);
    expect((await profile(idB)).purchases[0].debt).toBe(10000);
  });

  it("eski qarz qo'shish va qarzni tuzatish; eski qarz ham FIFO bo'yicha yopiladi", async () => {
    const name = uniq('Eski ');
    const created = await s.admin.post('/suppliers', { name, phone: '+998901112233', note: 'Zavod' });
    expect(created.status).toBe(201);
    expect(code(await s.admin.post('/suppliers', { name: name.toUpperCase() }))).toBe('duplicate_code');
    const id = created.body.id;
    const d = await s.admin.post(`/suppliers/${id}/debts`, { amount: 5000, date: '2025-12-01', note: 'Daftardan' });
    expect(d.status).toBe(201);
    expect(d.body.supplier.totalDebt).toBe(5000);
    expect(d.body.oldDebts[0]).toMatchObject({ amount: 5000, left: 5000, note: 'Daftardan' });
    await receive({ supplierId: id, paidAmount: 0, date: '2026-03-01' });
    const pay = await s.admin.post(`/suppliers/${id}/payments`, { amount: 6000 });
    expect(pay.body.oldDebts[0].left).toBe(0);
    expect(pay.body.purchases[0].left).toBe(9000);
    const fix = await s.admin.put(`/suppliers/${id}/debt`, { amount: 3000, note: 'Kelishildi' });
    expect(fix.status).toBe(200);
    expect(fix.body.supplier.totalDebt).toBe(3000);
    expect(fix.body.ledger[0]).toMatchObject({ type: 'adjustment', amount: -6000 });
    expect((await s.admin.patch(`/suppliers/${id}`, { name: name + ' MCHJ', phone: null })).body.name).toBe(name + ' MCHJ');
  });

  it("ro'yxat: qarz bo'yicha tartib, qidiruv, debtOnly, umumiy qarz; total_debt = jurnal yig'indisi", async () => {
    const name = uniq('Royxat ');
    await receive({ supplierName: name, paidAmount: 1000 });
    const list = (await s.admin.get('/suppliers')).body;
    expect(list.summary.totalDebt).toBeGreaterThan(0);
    expect(list.summary.debtors).toBeGreaterThan(0);
    const debts = list.items.map((i: { totalDebt: number }) => i.totalDebt);
    expect(debts).toEqual([...debts].sort((a: number, b: number) => b - a));
    const one = (await s.admin.get(`/suppliers?q=${name.trim()}`)).body.items;
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ name, totalDebt: 9000, purchasesCount: 1, lastPurchaseDate: today() });
    expect((await s.admin.get('/suppliers?debtOnly=true')).body.items.every((i: { totalDebt: number }) => i.totalDebt > 0)).toBe(true);

    const db = rawDb();
    const bad = await db.query(`select s.name from suppliers s where s.total_debt <> coalesce((select sum(amount) from supplier_ledger l where l.supplier_id = s.id), 0)`);
    await db.end();
    expect(bad.rows).toEqual([]);
  });

  it("kirimdan nechtasi sotilgan / nechtasi qolgan: sotuv eng eski kirimdan yopiladi, storno qaytaradi", async () => {
    const pid = (await makeProduct(s.admin, s, { name: uniq('Qopqoq ') })).id;
    const name = uniq('Rauf ');
    const rc = (qty: number, date: string) => s.admin.post('/stock-in', { supplierName: name, paidAmount: 0, date, lines: [{ productId: pid, unit: 'piece', qty, costPerUnit: 1000 }] });
    await rc(14, '2026-02-01');
    await rc(6, '2026-03-01');
    const id = await supplierId(name);
    const lines = async () => (await profile(id)).purchases.map((p: { date: string; lines: { sold: number; left: number; qty: number }[] }) => [p.date, p.lines[0].qty, p.lines[0].sold, p.lines[0].left]);
    expect(await lines()).toEqual([['2026-03-01', 6, 0, 6], ['2026-02-01', 14, 0, 14]]);

    const close = await ensureShift(s.admin, 0);
    const sale = await s.admin.post('/sales', { lines: [{ productId: pid, unit: 'piece', qty: 16 }], payments: [{ methodId: s.methods.cash, amount: 160000 }] });
    expect(sale.status).toBe(201);
    expect(await lines()).toEqual([['2026-03-01', 6, 2, 4], ['2026-02-01', 14, 14, 0]]); // 16 ta: avval 14 (eski), keyin 2
    expect([200, 201]).toContain((await s.admin.post(`/sales/${sale.body.id}/void`, { reason: 'test' })).status);
    expect(await lines()).toEqual([['2026-03-01', 6, 0, 6], ['2026-02-01', 14, 0, 14]]);
    await close();
  });

  it("kirim to'lov holati: qarz hisobi yuritilmagan kirimni qarzga o'tkazish; summa jamidan katta bo'lmaydi; yetkazib beruvchisiz bo'lmaydi", async () => {
    const name = uniq('Eski kirim ');
    const rc = await receive({ supplierName: name }); // paidAmount yo'q — hisobsiz
    const id = await supplierId(name);
    expect(rc.body.paidAmount).toBeNull();
    expect((await profile(id)).supplier.totalDebt).toBe(0);

    expect(code(await s.admin.put(`/stock-in/${rc.body.id}/payment`, { paidAmount: 10001 }))).toBe('validation_failed');
    const r = await s.admin.put(`/stock-in/${rc.body.id}/payment`, { paidAmount: 2500 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ paidAmount: 2500, debtAmount: 7500 });
    expect((await profile(id)).supplier.totalDebt).toBe(7500);
    expect((await s.admin.put(`/stock-in/${rc.body.id}/payment`, { paidAmount: 10000 })).status).toBe(200);
    expect((await profile(id)).supplier.totalDebt).toBe(0);

    const none = await receive({});
    expect(code(await s.admin.put(`/stock-in/${none.body.id}/payment`, { paidAmount: 0 }))).toBe('validation_failed');
    expect((await s.kassir.put(`/stock-in/${rc.body.id}/payment`, { paidAmount: 0 })).status).toBe(403);
  });

  it("narxi kiritilmagan kirim qarzga olinsa (jami 0) keyin tannarx kiritilganda qarz paydo bo'ladi", async () => {
    const name = uniq('Narxsiz ');
    const rc = await s.admin.post('/stock-in', { supplierName: name, paidAmount: 0, lines: [{ productId, unit: 'piece', qty: 14 }] });
    expect(rc.status).toBe(201);
    const id = await supplierId(name);
    expect((await profile(id)).supplier.totalDebt).toBe(0);
    expect((await s.admin.patch(`/stock-in/lines/${rc.body.lines[0].id}`, { costPerUnit: 500 })).status).toBe(200);
    expect((await profile(id)).supplier.totalDebt).toBe(7000);
  });

  it("huquqlar: kassir va omborchi ko'ra olmaydi; buxgalter ko'radi va to'lov beradi; sozlamalardan qarzli yetkazib beruvchini o'chirib bo'lmaydi", async () => {
    const name = uniq('Huquq ');
    await receive({ supplierName: name, paidAmount: 0 });
    const id = await supplierId(name);
    expect((await s.kassir.get('/suppliers')).status).toBe(403);
    expect((await s.omborchi.get(`/suppliers/${id}`)).status).toBe(403);
    expect((await s.buxgalter.get('/suppliers')).status).toBe(200);
    expect((await s.buxgalter.at(s.mainId).post(`/suppliers/${id}/payments`, { amount: 1000 })).status).toBe(201);
    expect((await s.omborchi.at(s.mainId).post(`/suppliers/${id}/payments`, { amount: 1000 })).status).toBe(403);

    const cur = (await s.admin.get('/settings')).body;
    const put = await s.admin.put('/settings', { ...cur, suppliers: cur.suppliers.filter((x: { id: string }) => x.id !== id) });
    expect(put.status).toBe(409);
    expect(put.body.error.code).toBe('in_use');
  });
});
