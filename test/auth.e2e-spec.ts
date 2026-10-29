import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { as, client, code, createApp, login, seeded, uniq, type Seeded } from './helpers.js';

describe('auth (TZ 6)', () => {
  let app: INestApplication;
  let s: Seeded;
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
  });
  afterAll(() => app.close());

  const raw = () => request(app.getHttpServer());

  it('login: noto\'g\'ri parol → 401 unauthorized, bir xil xabar (login bor-yo\'qligini oshkor qilmaydi)', async () => {
    const a = await raw().post('/api/v1/auth/login').send({ login: 'admin', password: 'xato' });
    const b = await raw().post('/api/v1/auth/login').send({ login: 'yoqlogin', password: 'xato' });
    expect(a.status).toBe(401);
    expect(code(a)).toBe('unauthorized');
    expect(a.body.error.message).toBe(b.body.error.message);
    expect(a.body.error.requestId).toBeTruthy();
    expect(a.headers['x-request-id']).toBe(a.body.error.requestId);
  });

  it('login: email bilan ham, katta-kichik harf farqsiz; javobda user, huquqlar, filiallar', async () => {
    const r = await raw().post('/api/v1/auth/login').send({ login: 'ADMIN@temirbaza.uz', password: '1234' });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.refreshToken).toBeTruthy();
    expect(r.body.user).toMatchObject({ username: 'admin', roleName: 'Super Admin', allBranches: true });
    expect(r.body.user.permissions).toContain('manage_settings');
    expect(r.body.user).not.toHaveProperty('passwordHash');
  });

  it('kassir: allBranches=false, main filialga biriktirilgan', async () => {
    const { user } = await login(app, 'kassir');
    expect(user).toMatchObject({ allBranches: false, defaultBranchId: s.mainId });
    expect(user.permissions).toEqual(['view_pos', 'view_debts', 'give_debt']);
  });

  it('tokensiz → 401; yaroqsiz token → 401', async () => {
    expect((await raw().get('/api/v1/settings')).status).toBe(401);
    expect((await raw().get('/api/v1/settings').set('authorization', 'Bearer abc.def.ghi')).status).toBe(401);
  });

  it('validatsiya: bo\'sh body → 400 validation_failed', async () => {
    const r = await raw().post('/api/v1/auth/login').send({});
    expect(r.status).toBe(400);
    expect(code(r)).toBe('validation_failed');
  });

  it('me: foydalanuvchi va joriy filialdagi smena holati', async () => {
    const r = await s.admin.get('/auth/me');
    expect(r.status).toBe(200);
    expect(r.body.user.username).toBe('admin');
    expect(r.body).toHaveProperty('shift');
  });

  it('bloklash: 5 ta muvaffaqiyatsiz urinishdan keyin 429 (to\'g\'ri parol bilan ham)', async () => {
    const u = uniq('lock');
    await s.admin.post('/users', { name: 'Lock', username: u, roleId: (await s.admin.get('/roles')).body.find((r: { name: string }) => r.name === 'Kassir').id, password: 'Parol-12345' }, { idem: false });
    for (let i = 0; i < 5; i++) await raw().post('/api/v1/auth/login').send({ login: u, password: 'xato' });
    const r = await raw().post('/api/v1/auth/login').send({ login: u, password: 'Parol-12345' });
    expect(r.status).toBe(429);
    expect(code(r)).toBe('rate_limited');
  });

  describe('vaqtinchalik parol (majburiy almashtirish yo\'q)', () => {
    let token: string;
    let u: string;
    beforeAll(async () => {
      u = uniq('mcp');
      const roleId = (await s.admin.get('/roles')).body.find((r: { name: string }) => r.name === 'Kassir').id;
      const r = await s.admin.post('/users', { name: 'Yangi', username: u, roleId, password: 'Vaqtincha-1' }, { idem: false });
      expect(r.status).toBe(201);
      expect(r.body.mustChangePassword).toBe(false);
      token = (await login(app, u, 'Vaqtincha-1')).token;
    });
    it('parolni almashtirmasdan ham barcha endpointlar ochiq', async () => {
      const c = client(app, token);
      expect((await c.get('/products')).status).toBe(200);
      expect((await c.get('/auth/me')).status).toBe(200);
    });
    it('parol siyosati: 8 dan qisqa va oddiy parollar rad etiladi; joriy parol noto\'g\'ri → 422', async () => {
      const c = client(app, token);
      expect((await c.post('/auth/change-password', { currentPassword: 'Vaqtincha-1', newPassword: 'qisqa' }, { idem: false })).status).toBe(400);
      expect((await c.post('/auth/change-password', { currentPassword: 'Vaqtincha-1', newPassword: '12345678' }, { idem: false })).status).toBe(422);
      expect((await c.post('/auth/change-password', { currentPassword: 'xato', newPassword: 'Yangi-Parol-9' }, { idem: false })).status).toBe(422);
      expect((await c.post('/auth/change-password', { currentPassword: 'Vaqtincha-1', newPassword: 'Vaqtincha-1' }, { idem: false })).status).toBe(422);
    });
    it('almashtirgandan keyin kirish ochiladi, eski parol ishlamaydi', async () => {
      const c = client(app, token);
      expect((await c.post('/auth/change-password', { currentPassword: 'Vaqtincha-1', newPassword: 'Yangi-Parol-9' }, { idem: false })).status).toBe(204);
      expect((await c.get('/products')).status).toBe(200);
      expect((await raw().post('/api/v1/auth/login').send({ login: u, password: 'Vaqtincha-1' })).status).toBe(401);
      expect((await raw().post('/api/v1/auth/login').send({ login: u, password: 'Yangi-Parol-9' })).status).toBe(200);
    });
  });

  describe('refresh va sessiyalar', () => {
    it('refresh: yangi juftlik; eski refresh qayta ishlatilsa — butun oila bekor', async () => {
      const first = await login(app, 'kassir');
      const r1 = await raw().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken });
      expect(r1.status).toBe(200);
      expect(r1.body.refreshToken).not.toBe(first.refreshToken);
      // Eski token qayta → 401 va oilaning yangisi ham bekor
      expect((await raw().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken })).status).toBe(401);
      expect((await raw().post('/api/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken })).status).toBe(401);
      expect((await raw().post('/api/v1/auth/refresh').send({ refreshToken: 'yoq' })).status).toBe(401);
    });
    it('parallel refresh bir xil token bilan: faqat bittasi yutadi, qolgani 401 va oila bekor (atomik rotation)', async () => {
      const first = await login(app, 'kassir');
      const rs = await Promise.all([1, 2, 3].map(() => raw().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken })));
      const ok = rs.filter((r) => r.status === 200);
      expect(ok.length).toBeLessThanOrEqual(1);
      expect(rs.filter((r) => r.status === 401).length).toBeGreaterThanOrEqual(2);
      // Qayta ishlatish aniqlandi → yutgan sessiya ham bekor
      if (ok.length) expect((await raw().post('/api/v1/auth/refresh').send({ refreshToken: ok[0].body.refreshToken })).status).toBe(401);
    });
    it('sessions ro\'yxati, bittasini o\'chirish, logout-all', async () => {
      const a = await login(app, 'omborchi');
      const b = await login(app, 'omborchi');
      const ca = client(app, a.token);
      const list = await ca.get('/auth/sessions');
      expect(list.body.length).toBeGreaterThanOrEqual(2);
      // b sessiyasini a tomonidan bekor qilish → b refresh ishlamaydi
      const bSession = list.body.find((x: { id: string }) => x.id !== (a.user as { sessionId?: string }).sessionId);
      expect((await ca.del(`/auth/sessions/${bSession.id}`)).status).toBe(204);
      expect((await ca.post('/auth/logout-all', {}, { idem: false })).status).toBe(204);
      expect((await raw().post('/api/v1/auth/refresh').send({ refreshToken: b.refreshToken })).status).toBe(401);
      expect((await raw().post('/api/v1/auth/refresh').send({ refreshToken: a.refreshToken })).status).toBe(401);
    });
    it('logout: joriy sessiya refresh qila olmaydi', async () => {
      const a = await login(app, 'buxgalter');
      expect((await client(app, a.token).post('/auth/logout', {}, { idem: false })).status).toBe(204);
      expect((await raw().post('/api/v1/auth/refresh').send({ refreshToken: a.refreshToken })).status).toBe(401);
    });
  });

  it('nofaol foydalanuvchi kira olmaydi va sessiyasi darhol bekor bo\'ladi (TZ 3.3 (5))', async () => {
    const u = uniq('inact');
    const roleId = (await s.admin.get('/roles')).body.find((r: { name: string }) => r.name === 'Kassir').id;
    const created = await s.admin.post('/users', { name: 'Nofaol', username: u, roleId, password: 'Parol-12345' }, { idem: false });
    const c = await as(app, u, 'Parol-12345');
    expect((await c.get('/auth/me')).status).toBe(200);
    expect((await s.admin.post(`/users/${created.body.id}/toggle-active`, {}, { idem: false })).status).toBe(201);
    // Kesh 10 s — guard foydalanuvchini qayta yuklaydi (nofaol → 401)
    const r = await c.get('/auth/me');
    expect([401, 403]).toContain(r.status);
    expect((await raw().post('/api/v1/auth/login').send({ login: u, password: 'Parol-12345' })).status).toBe(403);
  });
});
