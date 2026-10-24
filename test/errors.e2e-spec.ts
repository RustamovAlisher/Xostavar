import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { code, createApp, seeded, uniq, type Seeded } from './helpers.js';

/** Global xato ishlovi (TZ 5.1, 5.2): har xato bitta formatda, o'zbekcha xabar, requestId. */
describe('error handling', () => {
  let app: INestApplication;
  let s: Seeded;
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
  });
  afterAll(() => app.close());

  it('buzuq JSON → 400 validation_failed, o\'zbekcha xabar, requestId', async () => {
    const r = await request(app.getHttpServer()).post('/api/v1/auth/login').set('content-type', 'application/json').send('{"login": "admin", ');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: 'validation_failed', message: expect.stringMatching(/JSON/) });
    expect(r.body.error.requestId).toBeTruthy();
    expect(r.headers['x-request-id']).toBe(r.body.error.requestId);
  });

  it('validatsiya: xabarlar o\'zbekcha, har maydon uchun details.errors (ichma-ich maydonlar ham)', async () => {
    const r = await s.admin.post('/sales', { lines: [{ productId: 'yoq', unit: 'Bad Unit', qty: -1 }], discountAmount: 'ko\'p' }, { idem: 'x' });
    expect(r.status).toBe(400);
    expect(code(r)).toBe('validation_failed');
    const fields = r.body.error.details.errors.map((e: { field: string }) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['lines.0.productId', 'lines.0.unit', 'lines.0.qty', 'discountAmount']));
    for (const e of r.body.error.details.errors as { message: string }[]) expect(e.message).not.toMatch(/must|should/);
    expect(r.body.error.details.errors.find((e: { field: string }) => e.field === 'lines.0.qty').message).toMatch(/kamida 0/);
    expect(r.body.error.details.errors.find((e: { field: string }) => e.field === 'lines.0.productId').message).toMatch(/UUID/);
    expect(r.body.error.message).toBe(r.body.error.details.errors[0].message);
  });

  it('dekoratorda berilgan o\'zbekcha xabar saqlanadi (login formati, kod formati)', async () => {
    const r = await s.admin.post('/users', { name: 'X', username: 'a b', roleId: '00000000-0000-4000-8000-000000000000', password: 'Parol-12345' }, { idem: false });
    expect(r.body.error.details.errors.find((e: { field: string }) => e.field === 'username').message).toMatch(/lotin harf/);
    const b = await s.admin.post('/branches', { name: 'X', code: 'kichik' }, { idem: false });
    expect(b.body.error.details.errors[0].message).toMatch(/katta lotin harf/);
  });

  it('noma\'lum maydonlar jimgina tashlab yuboriladi (whitelist), tip o\'zgartirilmaydi ("5" ≠ 5)', async () => {
    const r = await s.admin.post('/customers', { name: 'W', phone: '+998 90 ' + String(Math.floor(1000000 + Math.random() * 8999999)), creditLimit: '5000', hacker: true }, { idem: false });
    expect(r.status).toBe(400);
    const errs = r.body.error.details.errors as { field: string; message: string }[];
    expect(errs.every((e) => e.field === 'creditLimit')).toBe(true);
    expect(errs.some((e) => /butun son/.test(e.message))).toBe(true);
  });

  it('UUID parametri noto\'g\'ri → 400 o\'zbekcha; yo\'q yozuv → 404; yo\'q manzil → 404 "Manzil topilmadi"', async () => {
    const bad = await s.admin.get('/products/not-a-uuid');
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/UUID/);
    const nf = await s.admin.get('/products/00000000-0000-4000-8000-000000000000');
    expect(nf.status).toBe(404);
    expect(nf.body.error).toMatchObject({ code: 'not_found', message: 'Mahsulot topilmadi' });
    const route = await s.admin.get('/yoq-manzil');
    expect(route.status).toBe(404);
    expect(route.body.error).toMatchObject({ code: 'not_found', message: 'Manzil topilmadi' });
  });

  it('Postgres unikal indeksi (oldindan tekshiruvdan o\'tib ketgan poyga) → 409 duplicate_code, tushunarli xabar', async () => {
    const phone = '+998 90 ' + String(Math.floor(1000000 + Math.random() * 8999999));
    const rs = await Promise.all(Array.from({ length: 6 }, () => s.admin.post('/customers', { name: 'Race', phone }, { idem: false })));
    expect(rs.filter((r) => r.status === 201).length).toBe(1);
    const dups = rs.filter((r) => r.status !== 201);
    expect(dups.length).toBe(5);
    for (const d of dups) {
      expect(d.status).toBe(409);
      expect(code(d)).toBe('duplicate_code');
      expect(d.body.error.message).toMatch(/telefon/);
    }
    // Filial nomi poygasi
    const name = uniq('Poyga ');
    const bs = await Promise.all(Array.from({ length: 4 }, () => s.admin.post('/branches', { name }, { idem: false })));
    expect(bs.filter((r) => r.status === 201).length).toBe(1);
    expect(bs.filter((r) => r.status === 409).length).toBe(3);
  });

  it('biznes xatolari: kod + xabar + details (TZ 5.2 kodlari)', async () => {
    const r = await s.kassir.get('/branches/overview');
    expect(r.body.error).toMatchObject({ code: 'forbidden', message: "Bu amal uchun huquqingiz yo'q" });
    const u = await request(app.getHttpServer()).get('/api/v1/settings');
    expect(u.body.error).toMatchObject({ code: 'unauthorized', message: 'Tizimga kiring' });
    const t = await request(app.getHttpServer()).get('/api/v1/settings').set('authorization', 'Bearer eyJ.bad.token');
    expect(t.body.error.message).toMatch(/Token yaroqsiz/);
  });

  it('javobda ichki tafsilotlar (stack, SQL) chiqmaydi', async () => {
    const r = await s.admin.get('/products/not-a-uuid');
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(/stack|at \w+ \(|select |node_modules/i);
    expect(Object.keys(r.body)).toEqual(['error']);
    expect(Object.keys(r.body.error).sort()).toEqual(['code', 'message', 'requestId'].sort().concat(r.body.error.details !== undefined ? ['details'] : []).sort());
  });

  it('health: baza bilan aloqa', async () => {
    const r = await request(app.getHttpServer()).get('/health');
    expect(r.body).toMatchObject({ status: 'ok' });
  });
});
