import { INestApplication } from '@nestjs/common';
import { MarketRateClient } from '../src/modules/currency/services/cbu.client.js';
import { code, createApp, ensureShift, seeded, uniq, type Client, type Seeded } from './helpers.js';

/** Dollar kursi: qo'lda kiritish, dollar narxli mahsulot, kurs o'zgarganda qayta hisoblash, dollar to'lov. */
describe('currency (USD)', () => {
  let app: INestApplication;
  let s: Seeded;
  let c: Client;
  let close: () => Promise<unknown>;
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
    const branch = (await s.admin.post('/branches', { name: uniq('Valyuta ') }, { idem: false })).body.id;
    c = s.admin.at(branch);
    expect((await c.post('/currency/usd', { rate: 12000 })).status).toBe(200);
    close = await ensureShift(c);
  });
  afterAll(async () => {
    await close();
    await app.close();
  });

  it('joriy kurs va jadval; kassir ko\'radi, lekin o\'zgartira olmaydi', async () => {
    const r = await s.kassir.get('/currency/usd');
    expect(r.status).toBe(200);
    expect(r.body.current).toMatchObject({ currency: 'USD', rate: 12000, source: 'manual' });
    expect(r.body.schedule).toEqual(['07:00', '12:00']);
    expect(new Date(r.body.nextAutoAt).getTime()).toBeGreaterThan(Date.now());
    expect((await s.kassir.post('/currency/usd', { rate: 1 })).status).toBe(403);
    expect((await s.kassir.post('/currency/usd/refresh')).status).toBe(403);
    expect(code(await c.post('/currency/usd', { rate: 5 }))).toBe('validation_failed');
    const h = await c.get('/currency/usd/history?limit=3');
    expect(h.body[0]).toMatchObject({ rate: 12000, source: 'manual' });
  });

  it("dollar narxli mahsulot: so'm narxi server hisoblaydi va kurs o'zgarganda yangilanadi", async () => {
    const p = await c.post('/products', {
      name: uniq('Makute drel '), categoryId: s.cats['Asbob-uskunalar'], baseUnit: 'piece', isDivisible: false, conversions: [],
      isVariable: false, priceCurrency: 'USD', retailPriceUsd: 45.5, retailPrice: 1, // so'm qiymatiga ishonilmaydi
    }, { idem: false });
    expect(p.status).toBe(201);
    expect(p.body).toMatchObject({ priceCurrency: 'USD', retailPriceUsd: 45.5, retailPrice: 546_000 });
    const v = await c.post('/products', {
      name: uniq('Pollwon disk '), categoryId: s.cats['Asbob-uskunalar'], baseUnit: 'piece', isDivisible: false, conversions: [],
      isVariable: true, priceCurrency: 'USD', variants: [{ name: '125', retailPrice: 0, retailPriceUsd: 1.25 }, { name: '230', retailPrice: 0, retailPriceUsd: 2.4 }],
    }, { idem: false });
    expect(v.status).toBe(201);
    expect(v.body.variants.map((x: { retailPrice: number; retailPriceUsd: number }) => [x.retailPriceUsd, x.retailPrice])).toEqual([[1.25, 15_000], [2.4, 28_800]]);
    const uzs = await c.post('/products', { name: uniq("So'm tovar "), categoryId: s.cats['Asbob-uskunalar'], baseUnit: 'piece', isDivisible: false, conversions: [], isVariable: false, retailPrice: 7000 }, { idem: false });
    expect(uzs.body).toMatchObject({ priceCurrency: 'UZS', retailPrice: 7000 });
    expect(uzs.body.retailPriceUsd).toBeUndefined();

    const r = await c.post('/currency/usd', { rate: 12500 });
    expect(r.status).toBe(200);
    expect(r.body.updatedProducts).toBeGreaterThanOrEqual(2);
    expect((await c.get(`/products/${p.body.id}`)).body.retailPrice).toBe(568_800); // 45.5 × 12500 = 568 750 → 568 800
    expect((await c.get(`/products/${v.body.id}`)).body.variants.map((x: { retailPrice: number }) => x.retailPrice)).toEqual([15_600, 30_000]);
    expect((await c.get(`/products/${uzs.body.id}`)).body.retailPrice).toBe(7000);

    // Tahrirda so'mga qaytarish: dollar narxi tozalanadi, keyingi kurs o'zgarishi ta'sir qilmaydi
    const back = await c.put(`/products/${p.body.id}`, { ...p.body, version: (await c.get(`/products/${p.body.id}`)).body.version, priceCurrency: 'UZS', retailPrice: 560_000, categoryId: s.cats['Asbob-uskunalar'] });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ priceCurrency: 'UZS', retailPrice: 560_000 });
    await c.post('/currency/usd', { rate: 13000 });
    expect((await c.get(`/products/${p.body.id}`)).body.retailPrice).toBe(560_000);
  });

  it("dollar bilan to'lov: amountUsd saqlanadi, chekda kurs; kursga mos bo'lmasa 422", async () => {
    await c.post('/currency/usd', { rate: 12000 });
    const prod = (await c.post('/products', { name: uniq('Tovar $ '), categoryId: s.cats['Asbob-uskunalar'], baseUnit: 'piece', isDivisible: false, conversions: [], isVariable: false, retailPrice: 120_000 }, { idem: false })).body;
    await c.post('/stock-in', { lines: [{ productId: prod.id, unit: 'piece', qty: 5, costPerUnit: 90_000 }] });
    const ok = await c.post('/sales', { lines: [{ productId: prod.id, unit: 'piece', qty: 1 }], payments: [{ methodId: s.methods.cash, amount: 120_000, amountUsd: 10 }] });
    expect(ok.status).toBe(201);
    expect(ok.body.usdRate).toBe(12000);
    expect(ok.body.payments[0]).toMatchObject({ amount: 120_000, amountUsd: 10 });
    const bad = await c.post('/sales', { lines: [{ productId: prod.id, unit: 'piece', qty: 1 }], payments: [{ methodId: s.methods.cash, amount: 120_000, amountUsd: 5 }] });
    expect(code(bad)).toBe('validation_failed');
  });

  it("brauzer orqali Markaziy bank kursi: navbat kelganda har kim yuboradi, bozor kursidan uzoq bo'lsa rad etiladi", async () => {
    const market = vi.spyOn(MarketRateClient.prototype, 'fetchUsdUzs').mockResolvedValue(12_000);
    try {
      const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
      const before = (await s.kassir.get('/currency/usd')).body;
      if (before.cbuDue) {
        const r = await s.kassir.post('/currency/usd/cbu-report', { rate: 12_050.37, date: today });
        expect(r.status).toBe(200);
        expect(r.body.current).toMatchObject({ rate: 12_050.37, source: 'cbu', rateDate: today });
      }
      expect((await s.kassir.get('/currency/usd')).body.cbuDue).toBe(false);
      // Navbat kelmagan — kassir yuborgani e'tiborsiz (spam / eski tab himoyasi)
      const again = await s.kassir.post('/currency/usd/cbu-report', { rate: 12_100, date: today });
      expect(again.status).toBe(200);
      expect(again.body.changed).toBe(false);
      // Admin har doim yubora oladi, lekin tekshiruvdan o'tishi kerak
      expect(code(await c.post('/currency/usd/cbu-report', { rate: 15_000, date: today }))).toBe('validation_failed');
      expect(code(await c.post('/currency/usd/cbu-report', { rate: 12_000, date: '2099-01-01' }))).toBe('validation_failed');
      const ok = await c.post('/currency/usd/cbu-report', { rate: 12_010, date: today });
      expect(ok.body).toMatchObject({ changed: true, current: { rate: 12_010, source: 'cbu' } });
    } finally {
      market.mockRestore();
    }
  });
});
