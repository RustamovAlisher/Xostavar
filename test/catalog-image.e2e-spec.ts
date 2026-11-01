import { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { code, createApp, seeded, uniq, type Seeded } from './helpers.js';

/** Test rasmi: 1600×900 to'q ko'k PNG (to'liq 1200px, eskiz 320px bo'lishi kerak). */
const png = (w = 1600, h = 900) => sharp({ create: { width: w, height: h, channels: 3, background: '#1d4ed8' } }).png().toBuffer();
const uploadDir = resolve(process.env.UPLOAD_DIR ?? './uploads');

describe('catalog: mahsulot rasmi', () => {
  let app: INestApplication;
  let s: Seeded;
  let productId: string;
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
    const r = await s.admin.post('/products', { name: uniq('Rasmli '), categoryId: s.cats['Armatura'], baseUnit: 'piece', isDivisible: false, conversions: [], retailPrice: 1000, isVariable: false }, { idem: false });
    expect(r.status).toBe(201);
    productId = r.body.id;
  });
  afterAll(() => app.close());

  const upload = (token: string, id: string, buf: Buffer, name = 'a.png', type = 'image/png') =>
    request(app.getHttpServer()).post(`/api/v1/products/${id}/image`).set('authorization', `Bearer ${token}`).attach('file', buf, { filename: name, contentType: type });

  it('yuklash: 1200px ga kichraytiriladi, eskiz 320px; URL /api/v1/uploads/ orqali ochiladi; audit yoziladi', async () => {
    const r = await upload(s.admin.token, productId, await png());
    expect(r.status).toBe(200);
    expect(r.body.imageUrl).toMatch(new RegExp(`^/api/v1/uploads/products/${productId}-\\d+\\.jpg$`));
    expect(r.body.thumbUrl).toMatch(/-thumb\.jpg$/);
    expect(r.body.version).toBe(1); // rasm versiyani oshirmaydi

    const full = await request(app.getHttpServer()).get(r.body.imageUrl);
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toMatch(/image\/jpeg/);
    expect(full.headers['cache-control']).toMatch(/max-age=2592000/);
    const meta = await sharp(full.body as Buffer).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 675]);
    const thumb = await request(app.getHttpServer()).get(r.body.thumbUrl);
    expect(thumb.status).toBe(200);
    expect((await sharp(thumb.body as Buffer).metadata()).width).toBe(320);

    expect((await s.admin.get(`/products/${productId}`)).body.imageUrl).toBe(r.body.imageUrl);
    const list = (await s.admin.get('/products?q=Rasmli')).body;
    expect(list.items.find((p: { id: string }) => p.id === productId).thumbUrl).toBe(r.body.thumbUrl);
    const logs = (await s.admin.get('/audit-logs?module=Mahsulotlar&action=edit&pageSize=20')).body;
    expect(logs.items.some((l: { targetId: string; details: string }) => l.targetId === productId && l.details.startsWith('Rasm yuklandi'))).toBe(true);
  });

  it('qayta yuklash eskisini diskdan o\'chiradi; DELETE rasmni olib tashlaydi', async () => {
    const first = (await s.admin.get(`/products/${productId}`)).body;
    const oldFile = join(uploadDir, first.imageUrl.replace('/api/v1/uploads/', ''));
    expect(existsSync(oldFile)).toBe(true);
    await new Promise((r) => setTimeout(r, 5)); // fayl nomidagi vaqt tamg'asi farq qilsin
    const r = await upload(s.admin.token, productId, await png(400, 400), 'b.jpg', 'image/jpeg');
    expect(r.status).toBe(200);
    expect(r.body.imageUrl).not.toBe(first.imageUrl);
    expect(existsSync(oldFile)).toBe(false);
    const newFile = join(uploadDir, r.body.imageUrl.replace('/api/v1/uploads/', ''));
    expect(existsSync(newFile)).toBe(true);

    const d = await s.admin.del(`/products/${productId}/image`);
    expect(d.status).toBe(200);
    expect(d.body.imageUrl).toBeUndefined();
    expect(d.body.thumbUrl).toBeUndefined();
    expect(existsSync(newFile)).toBe(false);
    expect((await request(app.getHttpServer()).get(r.body.imageUrl)).status).toBe(404);
  });

  it('rasm bo\'lmagan fayl, fayl yo\'q, katta fayl, yo\'q mahsulot, huquqsiz foydalanuvchi', async () => {
    expect(code(await upload(s.admin.token, productId, Buffer.from('salom, bu rasm emas'), 'x.png'))).toBe('validation_failed');
    expect(code(await upload(s.admin.token, productId, await png(10, 10), 'x.txt', 'text/plain'))).toBe('validation_failed');
    const empty = await request(app.getHttpServer()).post(`/api/v1/products/${productId}/image`).set('authorization', `Bearer ${s.admin.token}`);
    expect(code(empty)).toBe('validation_failed');
    const big = await upload(s.admin.token, productId, Buffer.alloc(8 * 1024 * 1024 + 1, 1));
    expect(big.status).toBe(413);
    expect((await upload(s.admin.token, '00000000-0000-4000-8000-000000000000', await png(10, 10))).status).toBe(404);
    expect((await upload(s.kassir.token, productId, await png(10, 10))).status).toBe(403);
    expect((await s.kassir.del(`/products/${productId}/image`)).status).toBe(403);
  });

  it('mahsulot o\'chirilganda rasm fayllari ham o\'chadi', async () => {
    const r = await upload(s.admin.token, productId, await png(300, 200));
    const file = join(uploadDir, r.body.imageUrl.replace('/api/v1/uploads/', ''));
    expect(existsSync(file)).toBe(true);
    expect((await s.admin.del(`/products/${productId}`)).status).toBe(204);
    expect(existsSync(file)).toBe(false);
  });
});
