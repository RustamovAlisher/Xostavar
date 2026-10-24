import { INestApplication } from '@nestjs/common';
import { as, createApp, makeProduct, seeded, uniq, type Seeded } from './helpers.js';

describe('audit (TZ 7.8, 9.10, 11)', () => {
  let app: INestApplication;
  let s: Seeded;
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
  });
  afterAll(() => app.close());

  it('ro\'yxat: sahifalash, filtrlar (module, action, userId, q, from/to), facets.byAction; faqat view_audit_logs', async () => {
    const name = uniq('Audit Tovar ');
    await makeProduct(s.admin, s, { name, stock: 3 });
    const r = (await s.admin.get(`/audit-logs?q=${encodeURIComponent(name)}`)).body;
    expect(r.total).toBeGreaterThanOrEqual(2); // add + stock_in
    expect(r.facets.byAction).toMatchObject({ add: 1, stock_in: 1 });
    expect(r.items[0]).toMatchObject({ userName: 'Alisher Navoiy', userRole: 'Super Admin' });
    expect((await s.admin.get('/audit-logs?module=Mahsulotlar&action=stock_in&pageSize=5')).body.items.every((l: { action: string; module: string }) => l.action === 'stock_in' && l.module === 'Mahsulotlar')).toBe(true);
    const me = (await s.admin.get('/auth/me')).body.user;
    expect((await s.admin.get(`/audit-logs?userId=${me.id}&pageSize=3`)).body.items.every((l: { userId: string }) => l.userId === me.id)).toBe(true);
    expect((await s.admin.get('/audit-logs?from=2099-01-01')).body.total).toBe(0);
    expect((await s.admin.get('/audit-logs?to=2000-01-01')).body.total).toBe(0);
    expect((await s.admin.get('/audit-logs?page=2&pageSize=1')).body).toMatchObject({ page: 2, pageSize: 1 });
    expect((await s.kassir.get('/audit-logs')).status).toBe(403);
    expect((await s.buxgalter.get('/audit-logs')).status).toBe(200);
  });

  it('umumiy amallar (katalog, sozlamalar, filiallar) branchId=null; kirim/sotuv filialga bog\'langan', async () => {
    const name = uniq('Global ');
    await makeProduct(s.admin, s, { name, stock: 1 });
    const logs = (await s.admin.get(`/audit-logs?q=${encodeURIComponent(name)}`)).body.items as { action: string; branchId: string | null }[];
    expect(logs.find((l) => l.action === 'add')!.branchId).toBeNull();
    expect(logs.find((l) => l.action === 'stock_in')!.branchId).toBe(s.mainId);
    const b = await s.admin.post('/branches', { name: uniq('Audit ') }, { idem: false });
    expect((await s.admin.get(`/audit-logs?module=Filiallar&pageSize=1`)).body.items[0]).toMatchObject({ targetId: b.body.id, branchId: null });
  });

  it('filial admini faqat o\'z filiali yozuvlarini ko\'radi (branchId bo\'sh yozuvlar ham ko\'rinmaydi); boshqa filialni so\'rasa ham o\'ziniki', async () => {
    const other = (await s.admin.post('/branches', { name: uniq('Boshqa ') }, { idem: false })).body.id;
    const roleId = (await s.admin.get('/roles')).body.find((r: { name: string }) => r.name === 'Filial admini').id;
    const u = (await s.admin.post('/users', { name: 'FA', username: uniq('fa'), roleId, password: 'Parol-12345', branchIds: [other] }, { idem: false })).body;
    const fa = await as(app, u.username, 'Parol-12345');
    await fa.post('/auth/change-password', { currentPassword: 'Parol-12345', newPassword: 'Filial-Admin-5' }, { idem: false });
    const p = await makeProduct(s.admin, s, { stock: 2 }); // main ga kirim
    await s.admin.at(other).post('/stock-in', { lines: [{ productId: p.id, unit: 'piece', qty: 7 }] });
    const mine = (await fa.get('/audit-logs?pageSize=200')).body;
    expect(mine.total).toBeGreaterThan(0);
    expect(mine.items.every((l: { branchId: string }) => l.branchId === other)).toBe(true);
    expect((await fa.get(`/audit-logs?branchId=${s.mainId}&pageSize=200`)).body.items.every((l: { branchId: string }) => l.branchId === other)).toBe(true);
    // egasi: barcha, yoki filtr bilan bitta filial, yoki faqat umumiy (none)
    expect((await s.admin.get(`/audit-logs?branchId=${other}&pageSize=200`)).body.items.every((l: { branchId: string }) => l.branchId === other)).toBe(true);
    expect((await s.admin.get('/audit-logs?branchId=none&pageSize=50')).body.items.every((l: { branchId: string | null }) => l.branchId === null)).toBe(true);
  });

  it('muvaffaqiyatsiz kirish Xavfsizlik moduliga yoziladi; diff tahrirlarda', async () => {
    await as(app, 'admin', 'xato-parol').catch(() => undefined);
    const sec = (await s.admin.get('/audit-logs?module=Xavfsizlik&pageSize=1')).body.items[0];
    expect(sec).toMatchObject({ action: 'login_failed', targetName: 'admin', userName: 'Tizim' });
    const d = (await s.admin.get('/settings')).body;
    const b = (await s.admin.post('/branches', { name: uniq('Diff ') }, { idem: false })).body;
    await s.admin.patch(`/branches/${b.id}`, { name: b.name + ' 2' });
    const log = (await s.admin.get('/audit-logs?module=Filiallar&action=edit&pageSize=1')).body.items[0];
    expect(log.diff).toEqual({ before: { nomi: b.name, manzil: null, telefon: null }, after: { nomi: b.name + ' 2', manzil: null, telefon: null } });
    void d;
  });
});
