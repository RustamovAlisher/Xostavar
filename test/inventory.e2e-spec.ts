import { INestApplication } from '@nestjs/common';
import { as, code, createApp, makeProduct, rawDb, seeded, uniq, type Client, type Seeded } from './helpers.js';

describe('inventory (TZ 7.4, 8.5, 8.6, 9.5)', () => {
  let app: INestApplication;
  let s: Seeded;
  let arm: { id: string; variants: { id: string; sku: string }[] };
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
    arm = (await s.admin.post('/products', {
      name: uniq('Armatura '), categoryId: s.cats['Armatura'], baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'piece', factor: 11.7 }], isVariable: true,
      variants: [{ name: 'Ø 12', retailPrice: 12500, conversions: [{ unit: 'kg', factor: 1.1261 }] }],
    }, { idem: false })).body;
  });
  afterAll(() => app.close());

  describe('kirim', () => {
    it('ko\'p qatorli hujjat: raqam filial bo\'yicha ketma-ket, qtyBase = qty × factor, costPerBase = cost / factor, jami', async () => {
      const cement = (await s.admin.get('/products/lookup?code=4780012345024')).body.product;
      const r = await s.admin.post('/stock-in', { supplierName: 'Bekobod', invoice: 'NK-7', note: 'test', lines: [{ productId: arm.id, variantId: arm.variants[0].id, unit: 'piece', qty: 100, costPerUnit: 140000 }, { productId: cement.id, unit: 'bag', qty: 50, costPerUnit: 56000 }] });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ supplierName: 'Bekobod', invoice: 'NK-7', totalCost: 100 * 140000 + 50 * 56000 });
      expect(r.body.number).toBeGreaterThanOrEqual(1);
      const [a, c] = r.body.lines;
      expect(a).toMatchObject({ unit: 'piece', qty: 100, qtyBase: 1170, costPerUnit: 140000, totalCost: 14_000_000 });
      expect(a.costPerBase).toBeCloseTo(11965.812, 2);
      expect(c).toMatchObject({ qty: 50, qtyBase: 50, costPerBase: 56000 });
      const r2 = await s.admin.post('/stock-in', { lines: [{ productId: cement.id, unit: 'bag', qty: 1 }] });
      expect(r2.body.number).toBe(r.body.number + 1);
      expect(r2.body.lines[0].costPerUnit).toBe(0);
    });
    it('o\'rtacha tannarx og\'irlikli; tannarx 0 bo\'lsa o\'zgarmaydi; variant qoldig\'i va ota jami', async () => {
      const p = await makeProduct(s.admin, s, { stock: 10, cost: 100 });
      await s.admin.post('/stock-in', { lines: [{ productId: p.id, unit: 'piece', qty: 30, costPerUnit: 300 }] });
      let g = (await s.admin.get(`/products/${p.id}`)).body;
      expect(g).toMatchObject({ stock: 40, costPrice: 250 }); // (10×100 + 30×300) / 40
      await s.admin.post('/stock-in', { lines: [{ productId: p.id, unit: 'piece', qty: 10 }] });
      g = (await s.admin.get(`/products/${p.id}`)).body;
      expect(g).toMatchObject({ stock: 50, costPrice: 250 });
      // Variant: ota qoldig'i variantlar yig'indisi
      const a = (await s.admin.get(`/products/${arm.id}`)).body;
      expect(a.variants[0].stock).toBe(1170);
      expect(a.stock).toBe(1170);
      expect(a.inBranch).toBe(true);
      expect(a.variants[0].costPrice).toBeCloseTo(11965.81, 1);
    });
    it('kirim bilan sotish narxini yangilash faqat edit_product bilan', async () => {
      const p = await makeProduct(s.admin, s, { price: 1000 });
      await s.admin.post('/stock-in', { lines: [{ productId: p.id, unit: 'piece', qty: 1, newRetailPrice: 1500 }] });
      expect((await s.admin.get(`/products/${p.id}`)).body.retailPrice).toBe(1500);
      // Filial admini (stock_in bor, edit_product yo'q): narx o'zgarmaydi
      const roleId = (await s.admin.get('/roles')).body.find((r: { name: string }) => r.name === 'Filial admini').id;
      const u = (await s.admin.post('/users', { name: 'FA', username: uniq('fa'), roleId, password: 'Parol-12345', branchIds: [s.mainId] }, { idem: false })).body;
      const fa = await as(app, u.username, 'Parol-12345');
      await fa.post('/auth/change-password', { currentPassword: 'Parol-12345', newPassword: 'Filial-Admin-9' }, { idem: false });
      expect((await fa.post('/stock-in', { lines: [{ productId: p.id, unit: 'piece', qty: 1, newRetailPrice: 9999 }] })).status).toBe(201);
      expect((await s.admin.get(`/products/${p.id}`)).body.retailPrice).toBe(1500);
    });
    it('xatolar: variant tanlanmagan, birlik ruxsat etilmagan, miqdor 0, mahsulot yo\'q, bo\'sh ro\'yxat, Idempotency-Key yo\'q', async () => {
      expect(code(await s.admin.post('/stock-in', { lines: [{ productId: arm.id, unit: 'piece', qty: 1 }] }))).toBe('validation_failed');
      expect(code(await s.admin.post('/stock-in', { lines: [{ productId: arm.id, variantId: arm.variants[0].id, unit: 'box', qty: 1 }] }))).toBe('unit_not_allowed');
      expect((await s.admin.post('/stock-in', { lines: [{ productId: arm.id, variantId: arm.variants[0].id, unit: 'piece', qty: 0 }] })).status).toBe(400);
      expect((await s.admin.post('/stock-in', { lines: [{ productId: '00000000-0000-4000-8000-000000000000', unit: 'piece', qty: 1 }] })).status).toBe(404);
      expect((await s.admin.post('/stock-in', { lines: [] })).status).toBe(400);
      expect((await s.admin.post('/stock-in', { lines: [{ productId: arm.id, variantId: arm.variants[0].id, unit: 'piece', qty: 1 }] }, { idem: false })).status).toBe(400);
    });
    it('idempotentlik: bir xil kalit → bir xil javob, qoldiq bir marta oshadi', async () => {
      const p = await makeProduct(s.admin, s);
      const key = uniq('idem-');
      const a = await s.admin.post('/stock-in', { lines: [{ productId: p.id, unit: 'piece', qty: 5 }] }, { idem: key });
      const b = await s.admin.post('/stock-in', { lines: [{ productId: p.id, unit: 'piece', qty: 5 }] }, { idem: key });
      expect(b.headers['idempotent-replayed']).toBe('true');
      expect(b.body.id).toBe(a.body.id);
      expect((await s.admin.get(`/products/${p.id}`)).body.stock).toBe(5);
      // Boshqa foydalanuvchi bir xil kalit bilan — o'z natijasi
      const c = await s.omborchi.post('/stock-in', { lines: [{ productId: p.id, unit: 'piece', qty: 5 }] }, { idem: key });
      expect(c.headers['idempotent-replayed']).toBeUndefined();
      expect((await s.admin.get(`/products/${p.id}`)).body.stock).toBe(10);
    });
    it('filial: kirim faqat joriy filialga; kassir (stock_in yo\'q) 403; boshqa filial omborida ko\'rinmaydi', async () => {
      const other = (await s.admin.get('/branches')).body.find((b: { id: string; active: boolean }) => b.id !== s.mainId && b.active) ?? (await s.admin.post('/branches', { name: uniq('F ') }, { idem: false })).body;
      const p = await makeProduct(s.admin, s);
      await s.admin.at(other.id).post('/stock-in', { lines: [{ productId: p.id, unit: 'piece', qty: 3 }] });
      expect((await s.admin.get(`/products/${p.id}`)).body).toMatchObject({ stock: 0, inBranch: false });
      expect((await s.admin.at(other.id).get(`/products/${p.id}`)).body).toMatchObject({ stock: 3, inBranch: true });
      expect((await s.kassir.post('/stock-in', { lines: [{ productId: p.id, unit: 'piece', qty: 1 }] })).status).toBe(403);
      const across = (await s.admin.get(`/stock-levels?productId=${p.id}&branchId=all`)).body;
      expect(across.map((l: { branchId: string; stock: number }) => [l.branchId, l.stock])).toEqual([[other.id, 3]]);
      // Kassir barcha filiallarni so'rasa faqat o'zinikini oladi
      expect((await s.kassir.get(`/stock-levels?productId=${p.id}&branchId=all`)).body).toEqual([]);
    });
  });

  describe('hujjatlar, jurnal, tuzatish', () => {
    it('kirimlar ro\'yxati sana/mahsulot filtri bilan, qatorlar bilan; bitta hujjat', async () => {
      const p = await makeProduct(s.admin, s, { stock: 2 });
      const list = (await s.admin.get(`/stock-in?productId=${p.id}`)).body;
      expect(list.total).toBe(1);
      expect(list.items[0].lines[0].productId).toBe(p.id);
      const one = (await s.admin.get(`/stock-in/${list.items[0].id}`)).body;
      expect(one.lines.length).toBe(1);
      expect((await s.admin.get('/stock-in?from=2099-01-01')).body.total).toBe(0);
      expect((await s.kassir.get('/stock-in')).status).toBe(403);
    });
    it('stock_movements: har o\'zgarish balance_after bilan; qoldiq = Σ qty_base (yaxlitlik)', async () => {
      const p = await makeProduct(s.admin, s, { stock: 10 });
      await s.admin.post('/stock-adjustments', { productId: p.id, delta: -3, reason: 'sinov' });
      await s.admin.post('/stock-adjustments', { productId: p.id, newStock: 20, reason: 'inventarizatsiya' });
      const m = (await s.admin.get(`/stock-movements?productId=${p.id}`)).body.items as { type: string; qtyBase: number; balanceAfter: number }[];
      expect(m.map((x) => [x.type, x.qtyBase, x.balanceAfter])).toEqual([['adjustment', 13, 20], ['adjustment', -3, 7], ['stock_in', 10, 10]]);
      const sum = m.reduce((a, x) => a + x.qtyBase, 0);
      expect((await s.admin.get(`/products/${p.id}`)).body.stock).toBe(sum);
      // Manfiy tuzatish → 422
      expect(code(await s.admin.post('/stock-adjustments', { productId: p.id, newStock: -1, reason: 'x' }))).toBe('validation_failed');
      expect(code(await s.admin.post('/stock-adjustments', { productId: p.id, delta: -100, reason: 'x' }))).toBe('insufficient_stock');
      // O'zgarishsiz tuzatish jurnalga yozilmaydi
      await s.admin.post('/stock-adjustments', { productId: p.id, newStock: 20, reason: 'x' });
      expect((await s.admin.get(`/stock-movements?productId=${p.id}`)).body.total).toBe(3);
      expect((await s.kassir.post('/stock-adjustments', { productId: p.id, delta: 1, reason: 'x' })).status).toBe(403);
    });
    it('PATCH /stock-levels/:id: min. qoldiq; tannarx faqat view_cost_price; boshqa filial qatori 404', async () => {
      const p = await makeProduct(s.admin, s, { stock: 4, cost: 50 });
      const levels = (await s.admin.get(`/stock-levels?productId=${p.id}&branchId=all`)).body;
      const r = await s.admin.patch(`/stock-levels/${levels[0].id}`, { minStock: 10, costPrice: 60 });
      expect(r.body).toMatchObject({ minStock: 10, costPrice: 60 });
      expect((await s.admin.get(`/products/${p.id}`)).body).toMatchObject({ minStock: 10, costPrice: 60 });
      expect((await s.omborchi.patch(`/stock-levels/${levels[0].id}`, { costPrice: 1 })).status).toBe(403);
      expect((await s.omborchi.patch(`/stock-levels/${levels[0].id}`, { minStock: 0 })).body.minStock).toBeNull();
      expect((await s.admin.patch(`/stock-levels/${levels[0].id}`, {})).status).toBe(409);
      // Kam qoldiq ro'yxati
      await s.admin.patch(`/stock-levels/${levels[0].id}`, { minStock: 10 });
      const low = (await s.admin.get('/products?lowStock=true&pageSize=500')).body.items;
      expect(low.some((x: { id: string }) => x.id === p.id)).toBe(true);
      expect((await s.admin.get('/reports/low-stock')).body.some((x: { productId: string }) => x.productId === p.id)).toBe(true);
    });
  });

  it('yaxlitlik: barcha qatorlar uchun stock_levels.stock = Σ stock_movements.qty_base (TZ 18.5)', async () => {
    const db = rawDb();
    const { rows } = await db.query(`
      select l.id, l.stock, coalesce(sum(m.qty_base), 0) as moved
      from stock_levels l
      left join stock_movements m on m.branch_id = l.branch_id and m.product_id = l.product_id and m.variant_id is not distinct from l.variant_id
      group by l.id, l.stock having l.stock <> coalesce(sum(m.qty_base), 0)`);
    await db.end();
    expect(rows).toEqual([]);
  });

  it('omborchi: kirim qila oladi, tannarxni ko\'rmaydi (javobda costPrice yo\'q) — lekin kirimda tannarx kiritadi', async () => {
    const o: Client = s.omborchi;
    const p = await makeProduct(s.admin, s);
    const r = await o.post('/stock-in', { lines: [{ productId: p.id, unit: 'piece', qty: 2, costPerUnit: 777 }] });
    expect(r.status).toBe(201);
    expect((await o.get(`/products/${p.id}`)).body).not.toHaveProperty('costPrice');
    expect((await s.admin.get(`/products/${p.id}`)).body.costPrice).toBe(777);
  });
});
