import { INestApplication } from '@nestjs/common';
import { createApp, seeded, type Client, type Seeded } from './helpers.js';

/**
 * Huquqlar matritsasi (TZ 18.2): har endpoint ruxsatsiz rolda 403 qaytaradi.
 * Faqat huquq tekshiruvi — body yaroqsiz bo'lsa ham 403 (guard validatsiyadan oldin).
 */
describe('permissions matrix', () => {
  let app: INestApplication;
  let s: Seeded;
  const U = '00000000-0000-4000-8000-000000000000';
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
  });
  afterAll(() => app.close());

  type Row = [string, string, Client[]];
  const cases = (): Row[] => [
    ['GET', '/users', [s.kassir, s.omborchi, s.buxgalter]],
    ['POST', '/users', [s.kassir, s.omborchi, s.buxgalter]],
    ['POST', '/roles', [s.kassir, s.omborchi, s.buxgalter]],
    ['POST', '/branches', [s.kassir, s.omborchi, s.buxgalter]],
    ['GET', '/branches/overview', [s.kassir, s.omborchi, s.buxgalter]],
    ['PUT', '/settings', [s.kassir, s.omborchi, s.buxgalter]],
    ['POST', '/settings/reset', [s.kassir, s.omborchi, s.buxgalter]],
    ['POST', '/products', [s.kassir, s.buxgalter]],
    ['PUT', `/products/${U}`, [s.kassir, s.buxgalter]],
    ['DELETE', `/products/${U}`, [s.kassir, s.omborchi, s.buxgalter]],
    ['GET', `/products/${U}/history`, [s.kassir]],
    ['POST', '/stock-in', [s.kassir, s.buxgalter]],
    ['GET', '/stock-in', [s.kassir]],
    ['GET', '/stock-movements?productId=' + U, [s.kassir]],
    ['POST', '/stock-adjustments', [s.kassir, s.buxgalter]],
    ['PATCH', `/stock-levels/${U}`, [s.kassir, s.buxgalter]],
    ['PATCH', `/customers/${U}`, [s.omborchi, s.buxgalter]],
    ['DELETE', `/customers/${U}`, [s.kassir, s.omborchi, s.buxgalter]],
    ['POST', `/customers/${U}/payments`, [s.omborchi]],
    ['GET', `/customers/${U}/ledger`, [s.omborchi]],
    ['POST', `/sales/${U}/void`, [s.kassir, s.omborchi, s.buxgalter]],
    ['GET', '/shifts', [s.kassir, s.omborchi]],
    ['GET', '/expenses', [s.kassir, s.omborchi]],
    ['POST', '/expenses', [s.kassir, s.omborchi]],
    ['GET', '/reports/dashboard', [s.kassir, s.omborchi]],
    ['GET', '/reports/profit-loss', [s.kassir, s.omborchi]],
    ['GET', '/reports/cash-flow', [s.kassir, s.omborchi]],
    ['GET', '/audit-logs', [s.kassir, s.omborchi]],
  ];

  it('ruxsatsiz rollar 403 oladi', async () => {
    const failures: string[] = [];
    for (const [method, path, clients] of cases()) {
      for (const cl of clients) {
        const r = method === 'GET' ? await cl.get(path) : method === 'PUT' ? await cl.put(path, {}) : method === 'PATCH' ? await cl.patch(path, {}) : method === 'DELETE' ? await cl.del(path) : await cl.post(path, {});
        if (r.status !== 403) failures.push(`${method} ${path} → ${r.status} (${cl.token.slice(-6)})`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('ruxsatli rollar 403 olmaydi (kassa, mijoz, katalog o\'qish)', async () => {
    const okCases: [string, string, Client][] = [
      ['GET', '/products', s.kassir],
      ['GET', '/products', s.buxgalter],
      ['GET', '/customers', s.kassir],
      ['POST', '/customers', s.kassir],
      ['GET', '/shifts/current', s.kassir],
      ['GET', '/sales', s.kassir],
      ['POST', '/sales/quote', s.kassir],
      ['GET', '/stock-levels', s.omborchi],
      ['POST', '/products', s.omborchi],
      ['GET', '/reports/dashboard', s.buxgalter],
      ['GET', '/expenses', s.buxgalter],
      ['GET', '/audit-logs', s.buxgalter],
      ['GET', '/settings', s.kassir],
      ['GET', '/branches', s.kassir],
      ['GET', '/auth/me', s.kassir],
    ];
    const failures: string[] = [];
    for (const [method, path, cl] of okCases) {
      const r = method === 'GET' ? await cl.get(path) : await cl.post(path, {}, { idem: false });
      if (r.status === 403 || r.status === 401) failures.push(`${method} ${path} → ${r.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('view_cost_price siz javobda tannarx/foyda maydonlari umuman yo\'q (null emas)', async () => {
    const body = JSON.stringify((await s.kassir.get('/products?pageSize=50')).body);
    expect(body).not.toMatch(/"costPrice"/);
    expect(body).not.toMatch(/"wholesalePrice"/);
    const sales = JSON.stringify((await s.kassir.get('/sales?pageSize=5')).body);
    expect(sales).not.toMatch(/"profit":\d/);
    expect(sales).not.toMatch(/"costPerBase":\d/);
  });
});
