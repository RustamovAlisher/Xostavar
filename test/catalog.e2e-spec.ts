import { INestApplication } from '@nestjs/common';
import { code, createApp, makeProduct, seeded, uniq, type Seeded } from './helpers.js';

describe('catalog (TZ 7.3, 9.4)', () => {
  let app: INestApplication;
  let s: Seeded;
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
  });
  afterAll(() => app.close());

  const armBody = (over: Record<string, unknown> = {}) => ({
    name: uniq('Armatura '), categoryId: s.cats['Armatura'], baseUnit: 'meter', isDivisible: true,
    conversions: [{ unit: 'piece', factor: 11.7 }], isVariable: true,
    variants: [
      { name: 'Ø 10', retailPrice: 8800, conversions: [{ unit: 'kg', factor: 1.6207 }] },
      { name: 'Ø 12', sku: uniq('ARM12-'), retailPrice: 12500, barcodes: [uniq('478')], conversions: [{ unit: 'kg', factor: 1.1261 }] },
    ],
    ...over,
  });

  describe('yaratish', () => {
    it('variantli mahsulot: avto SKU (ota va variant), konversiyalar, shtrix-kodlar; javob frontend Product shaklida', async () => {
      const body = armBody();
      const r = await s.admin.post('/products', body, { idem: false });
      expect(r.status).toBe(201);
      expect(r.body.sku).toMatch(/^ARMATURA-/);
      expect(r.body.isVariable).toBe(true);
      expect(r.body.stock).toBe(0);
      expect(r.body.inBranch).toBe(false);
      expect(r.body.conversions).toEqual([{ unit: 'piece', factor: 11.7 }]);
      const [v10, v12] = r.body.variants;
      expect(v10.sku).toBe(`${r.body.sku}-10`);
      expect(v12.sku).toBe(body.variants[1].sku);
      expect(v12.barcodes).toEqual(body.variants[1].barcodes);
      expect(v12.conversions).toEqual([{ unit: 'kg', factor: 1.1261 }]);
      expect(v12).toMatchObject({ stock: 0, retailPrice: 12500 });
    });
    it('validatsiya: birlik mavjud emas, konversiya asosiy birlik bilan bir xil, takror birlik, factor ≤ 0, variantsiz isVariable, kategoriya yo\'q', async () => {
      expect((await s.admin.post('/products', armBody({ baseUnit: 'yoq' }), { idem: false })).status).toBe(422);
      expect((await s.admin.post('/products', armBody({ conversions: [{ unit: 'meter', factor: 1 }] }), { idem: false })).status).toBe(422);
      expect((await s.admin.post('/products', armBody({ conversions: [{ unit: 'piece', factor: 11.7 }, { unit: 'piece', factor: 6 }] }), { idem: false })).status).toBe(422);
      expect((await s.admin.post('/products', armBody({ conversions: [{ unit: 'piece', factor: 0 }] }), { idem: false })).status).toBe(400);
      expect((await s.admin.post('/products', armBody({ variants: [] }), { idem: false })).status).toBe(422);
      expect((await s.admin.post('/products', armBody({ categoryId: '00000000-0000-4000-8000-000000000000' }), { idem: false })).status).toBe(422);
    });
    it('kodlar butun tizimda unikal (harf farqsiz): SKU, variant SKU, shtrix-kod, qadoq shtrix-kodi', async () => {
      const a = (await s.admin.post('/products', armBody(), { idem: false })).body;
      const dupSku = await s.admin.post('/products', armBody({ sku: a.sku.toLowerCase() }), { idem: false });
      expect(code(dupSku)).toBe('duplicate_code');
      const dupVar = await s.admin.post('/products', armBody({ variants: [{ name: 'X', sku: a.variants[0].sku, retailPrice: 1 }] }), { idem: false });
      expect(code(dupVar)).toBe('duplicate_code');
      const dupBc = await s.admin.post('/products', armBody({ barcodes: [a.variants[1].barcodes[0]] }), { idem: false });
      expect(code(dupBc)).toBe('duplicate_code');
      const selfDup = await s.admin.post('/products', armBody({ barcodes: ['111222'], conversions: [{ unit: 'piece', factor: 11.7, barcode: '111222' }] }), { idem: false });
      expect(code(selfDup)).toBe('duplicate_code');
      // Seed sement shtrix-kodi
      expect(code(await s.admin.post('/products', armBody({ barcodes: ['4780012345024'] }), { idem: false }))).toBe('duplicate_code');
    });
    it('huquqlar: kassir yarata olmaydi (add_product yo\'q), omborchi yarata oladi, o\'chira olmaydi', async () => {
      expect((await s.kassir.post('/products', armBody(), { idem: false })).status).toBe(403);
      const r = await s.omborchi.post('/products', armBody({ isVariable: false, variants: undefined, retailPrice: 100 }), { idem: false });
      expect(r.status).toBe(201);
      expect((await s.omborchi.del(`/products/${r.body.id}`)).status).toBe(403);
      expect((await s.admin.del(`/products/${r.body.id}`)).status).toBe(204);
    });
    it('narxsiz mahsulot qabul qilinadi (katalog faqat asosiy ma\'lumot) — kassada sotilmaydi (price_missing)', async () => {
      const r = await s.admin.post('/products', armBody({ isVariable: false, variants: undefined }), { idem: false });
      expect(r.status).toBe(201);
      expect(r.body.retailPrice).toBe(0);
    });
  });

  describe('ro\'yxat va qidiruv', () => {
    it('sahifalash, kategoriya filtri va facets; q — nom, SKU, shtrix-kod, variant nomi/SKU bo\'yicha', async () => {
      const p = (await s.admin.post('/products', armBody({ name: uniq('Qidiruv Test ') }), { idem: false })).body;
      const byName = await s.admin.get(`/products?q=${encodeURIComponent(p.name.slice(0, 12))}`);
      expect(byName.body.items.map((x: { id: string }) => x.id)).toContain(p.id);
      expect(byName.body).toMatchObject({ page: 1, pageSize: 50 });
      expect(byName.body.facets.byCategory[s.cats['Armatura']]).toBeGreaterThan(0);
      expect((await s.admin.get(`/products?q=${p.variants[1].sku}`)).body.items[0].id).toBe(p.id);
      expect((await s.admin.get(`/products?q=${p.variants[1].barcodes[0]}`)).body.items[0].id).toBe(p.id);
      expect((await s.admin.get(`/products?q=Ø 12&categoryId=${s.cats['Armatura']}`)).body.total).toBeGreaterThan(0);
      expect((await s.admin.get(`/products?categoryId=${s.cats['Kafel va pol']}&pageSize=1`)).body.items.length).toBe(1);
      expect((await s.admin.get('/products?pageSize=1000')).status).toBe(400);
    });
    it('inBranch=true faqat omborda bo\'lganlar; kirimdan keyin inBranch=true va qoldiq ko\'rinadi', async () => {
      const p = await makeProduct(s.admin, s, { stock: 7, cost: 500 });
      const inb = (await s.admin.get('/products?inBranch=true&pageSize=500')).body.items as { id: string; stock: number; inBranch: boolean }[];
      const hit = inb.find((x) => x.id === p.id)!;
      expect(hit).toMatchObject({ stock: 7, inBranch: true });
      expect(inb.every((x) => x.inBranch)).toBe(true);
      const notIn = (await s.admin.post('/products', armBody(), { idem: false })).body;
      expect(inb.some((x) => x.id === notIn.id)).toBe(false);
    });
    it('lookup: SKU, shtrix-kod, variant SKU (variantId), qadoq shtrix-kodi (unit); topilmasa 404', async () => {
      const p = (await s.admin.post('/products', armBody({ barcodes: [uniq('99')], conversions: [{ unit: 'piece', factor: 11.7, barcode: uniq('88') }] }), { idem: false })).body;
      expect((await s.admin.get(`/products/lookup?code=${p.sku.toLowerCase()}`)).body).toMatchObject({ product: { id: p.id }, variantId: null, unit: null });
      expect((await s.admin.get(`/products/lookup?code=${p.barcodes[0]}`)).body.product.id).toBe(p.id);
      expect((await s.admin.get(`/products/lookup?code=${p.variants[1].sku}`)).body).toMatchObject({ product: { id: p.id }, variantId: p.variants[1].id });
      expect((await s.admin.get(`/products/lookup?code=${p.variants[1].barcodes[0]}`)).body.variantId).toBe(p.variants[1].id);
      expect((await s.admin.get(`/products/lookup?code=${p.conversions[0].barcode}`)).body).toMatchObject({ product: { id: p.id }, unit: 'piece' });
      expect((await s.admin.get('/products/lookup?code=yoq-kod')).status).toBe(404);
      expect((await s.admin.get('/products/lookup?code=')).status).toBe(404);
    });
    it('tannarx va ulgurji narx faqat view_cost_price bilan', async () => {
      const p = await makeProduct(s.admin, s, { stock: 3, cost: 700 });
      const adm = (await s.admin.get(`/products/${p.id}`)).body;
      expect(adm.costPrice).toBe(700);
      const kas = (await s.kassir.get(`/products/${p.id}`)).body;
      expect(kas).not.toHaveProperty('costPrice');
      expect(kas).not.toHaveProperty('wholesalePrice');
      expect(kas.stock).toBe(3);
    });
  });

  describe('tahrirlash va o\'chirish', () => {
    it('PUT: variant qo\'shish/tahrirlash/olib tashlash; version conflict; audit diff', async () => {
      const p = (await s.admin.post('/products', armBody(), { idem: false })).body;
      const put = await s.admin.put(`/products/${p.id}`, {
        ...armBody({ name: p.name + ' v2' }), sku: p.sku,
        variants: [
          { id: p.variants[0].id, name: 'Ø 10 A500C', retailPrice: 9000 }, // tahrir
          { name: 'Ø 14', retailPrice: 15000 }, // yangi
          // p.variants[1] olib tashlanadi
        ],
        version: p.version,
      });
      expect(put.status).toBe(200);
      expect(put.body.name).toBe(p.name + ' v2');
      expect(put.body.version).toBe(p.version + 1);
      expect(put.body.variants.map((v: { name: string }) => v.name)).toEqual(['Ø 10 A500C', 'Ø 14']);
      expect(put.body.variants[0].id).toBe(p.variants[0].id);
      expect(put.body.variants[0].retailPrice).toBe(9000);
      expect(put.body.variants[0].conversions).toBeUndefined(); // konversiyalar so'rovdagidek (bo'sh)
      const stale = await s.admin.put(`/products/${p.id}`, { ...armBody(), version: p.version });
      expect(code(stale)).toBe('version_conflict');
      // O'chirilgan variant SKU si bo'shaydi — qayta ishlatish mumkin
      const reuse = await s.admin.post('/products', armBody({ variants: [{ name: 'Y', sku: p.variants[1].sku, retailPrice: 1 }] }), { idem: false });
      expect(reuse.status).toBe(201);
      const log = (await s.admin.get(`/audit-logs?q=${encodeURIComponent(p.name + ' v2')}&action=edit`)).body.items[0];
      expect(log.diff.after.nomi).toBe(p.name + ' v2');
      expect(log.branchId).toBeNull();
    });
    it('qoldig\'i bor variantni olib tashlash → 409 in_use (qaysi filialda, qancha)', async () => {
      const p = (await s.admin.post('/products', armBody(), { idem: false })).body;
      await s.admin.post('/stock-in', { lines: [{ productId: p.id, variantId: p.variants[1].id, unit: 'piece', qty: 2, costPerUnit: 100000 }] });
      const r = await s.admin.put(`/products/${p.id}`, { ...armBody(), sku: p.sku, variants: [{ id: p.variants[0].id, name: 'Ø 10', retailPrice: 1 }], version: p.version });
      expect(r.status).toBe(409);
      expect(code(r)).toBe('in_use');
      expect(r.body.error.message).toMatch(/Asosiy filial/);
      expect(r.body.error.details.variantId).toBe(p.variants[1].id);
    });
    it('variantlidan oddiyga o\'tkazish: qoldiqsiz variantlar yumshoq o\'chadi', async () => {
      const p = (await s.admin.post('/products', armBody(), { idem: false })).body;
      const r = await s.admin.put(`/products/${p.id}`, { ...armBody({ isVariable: false, variants: undefined, retailPrice: 5000 }), sku: p.sku, version: p.version });
      expect(r.status).toBe(200);
      expect(r.body.isVariable).toBe(false);
      expect(r.body.variants).toBeUndefined();
      expect(r.body.retailPrice).toBe(5000);
    });
    it('min. qoldiq va tannarx joriy filial ombor qatoriga yoziladi (faqat omborda bo\'lsa)', async () => {
      const p = await makeProduct(s.admin, s, { stock: 10 });
      const get = (await s.admin.get(`/products/${p.id}`)).body;
      const r = await s.admin.put(`/products/${p.id}`, { name: get.name, categoryId: get.categoryId, sku: get.sku, baseUnit: 'piece', isDivisible: false, conversions: [], retailPrice: 10000, isVariable: false, minStock: 4, costPrice: 8000, version: get.version });
      expect(r.body).toMatchObject({ minStock: 4, costPrice: 8000 });
      // Boshqa filialda (omborda yo'q) o'zgarmaydi
      const other = (await s.admin.get('/branches')).body.find((b: { id: string; active: boolean }) => b.id !== s.mainId && b.active);
      const o = (await s.admin.at(other.id).get(`/products/${p.id}`)).body;
      expect(o.minStock).toBeUndefined();
      expect(o.stock).toBe(0);
      // Omborchi (view_cost_price yo'q) tannarxni o'zgartira olmaydi
      await s.omborchi.put(`/products/${p.id}`, { name: get.name, categoryId: get.categoryId, sku: get.sku, baseUnit: 'piece', isDivisible: false, conversions: [], retailPrice: 10000, isVariable: false, costPrice: 1 });
      expect((await s.admin.get(`/products/${p.id}`)).body.costPrice).toBe(8000);
    });
    it('o\'chirish: qoldig\'i bor → 409; tarixi bor → yumshoq (ro\'yxatdan yo\'qoladi, kodlar bo\'shaydi); tarixsiz → to\'liq', async () => {
      const stocked = await makeProduct(s.admin, s, { stock: 1 });
      expect(code(await s.admin.del(`/products/${stocked.id}`))).toBe('in_use');
      await s.admin.post('/stock-adjustments', { productId: stocked.id, newStock: 0, reason: 'test' });
      expect((await s.admin.del(`/products/${stocked.id}`)).status).toBe(204);
      expect((await s.admin.get(`/products/${stocked.id}`)).status).toBe(404);
      expect((await s.admin.get(`/products/lookup?code=${stocked.sku}`)).status).toBe(404);
      // SKU qayta ishlatish mumkin
      expect((await s.admin.post('/products', { name: 'Qayta', categoryId: s.cats['Armatura'], sku: stocked.sku, baseUnit: 'piece', isDivisible: false, conversions: [], retailPrice: 1, isVariable: false }, { idem: false })).status).toBe(201);
      const fresh = await makeProduct(s.admin, s);
      expect((await s.admin.del(`/products/${fresh.id}`)).status).toBe(204);
      expect((await s.admin.del(`/products/${fresh.id}`)).status).toBe(404);
    });
    it('tarix: kirimlar va audit; filial admini faqat o\'z filialini ko\'radi', async () => {
      const p = await makeProduct(s.admin, s, { stock: 5, cost: 100 });
      const h = (await s.admin.get(`/products/${p.id}/history`)).body;
      expect(h.receipts.length).toBe(1);
      expect(h.receipts[0]).toMatchObject({ qty: 5, costPerUnit: 100, totalCost: 500 });
      expect(h.logs.some((l: { action: string }) => l.action === 'add')).toBe(true);
      expect(h.logs.some((l: { action: string }) => l.action === 'stock_in')).toBe(true);
      const bux = (await s.buxgalter.get(`/products/${p.id}/history`)).body;
      expect(bux.receipts[0]).toMatchObject({ costPerUnit: 100 }); // buxgalter tannarxni ko'radi
      expect((await s.kassir.get(`/products/${p.id}/history`)).status).toBe(403);
    });
  });
});
