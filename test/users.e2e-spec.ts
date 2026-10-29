import { INestApplication } from '@nestjs/common';
import { as, code, createApp, rawDb, seeded, uniq, type Client, type Seeded } from './helpers.js';

describe('users & roles (TZ 3, 7.1, 8.12)', () => {
  let app: INestApplication;
  let s: Seeded;
  let roles: Record<string, string>;
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
    roles = Object.fromEntries((await s.admin.get('/roles')).body.map((r: { name: string; id: string }) => [r.name, r.id]));
  });
  afterAll(() => app.close());

  const newUser = (c: Client, extra: Record<string, unknown> = {}) =>
    c.post('/users', { name: 'Test', username: uniq('u'), roleId: roles['Kassir'], password: 'Parol-12345', ...extra }, { idem: false });

  describe('yaratish va tahrirlash', () => {
    it('rol shablonidan huquqlar, mustChangePassword=false, filial = so\'rovdagi', async () => {
      const r = await newUser(s.admin, { branchIds: [s.mainId] });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ role: 'Kassir', permissions: ['view_pos', 'view_debts', 'give_debt'], mustChangePassword: false, active: true, branchIds: [s.mainId], defaultBranchId: s.mainId });
      expect(r.body).not.toHaveProperty('passwordHash');
    });
    it('login formati, parol siyosati, takror login/email → 409', async () => {
      expect((await newUser(s.admin, { username: 'ab' })).status).toBe(400);
      expect((await newUser(s.admin, { username: 'bo sh' })).status).toBe(400);
      expect((await newUser(s.admin, { password: '1234567' })).status).toBe(400);
      expect(code(await newUser(s.admin, { password: 'password' }))).toBe('validation_failed');
      const dup = await newUser(s.admin, { username: 'ADMIN' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.message).toMatch(/login band/i);
      const dupE = await newUser(s.admin, { email: 'Admin@temirbaza.uz' });
      expect(dupE.status).toBe(409);
      expect(dupE.body.error.message).toMatch(/email band/i);
      expect((await newUser(s.admin, { email: 'notanemail' })).status).toBe(400);
    });
    it('bo\'sh email null saqlanadi (soxta email yasalmaydi)', async () => {
      const r = await newUser(s.admin, { email: '' });
      expect(r.body.email).toBeNull();
    });
    it('PATCH: rol o\'zgarsa huquqlar faqat resetPermissionsToRole bilan yangilanadi; version conflict 409', async () => {
      const u = (await newUser(s.admin)).body;
      const keep = await s.admin.patch(`/users/${u.id}`, { roleId: roles['Omborchi'], version: u.version });
      expect(keep.status).toBe(200);
      expect(keep.body.role).toBe('Omborchi');
      expect(keep.body.permissions).toEqual(['view_pos', 'view_debts', 'give_debt']);
      const reset = await s.admin.patch(`/users/${u.id}`, { roleId: roles['Kassir'], resetPermissionsToRole: true, version: keep.body.version });
      expect(reset.body.permissions).toEqual(['view_pos', 'view_debts', 'give_debt']);
      const stale = await s.admin.patch(`/users/${u.id}`, { name: 'X', version: u.version });
      expect(stale.status).toBe(409);
      expect(code(stale)).toBe('version_conflict');
    });
    it('admin parol bersa xodim yangi parol bilan darhol ishlaydi va eski sessiyalari bekor bo\'ladi', async () => {
      const u = (await newUser(s.admin)).body;
      const c = await as(app, u.username, 'Parol-12345');
      await c.post('/auth/change-password', { currentPassword: 'Parol-12345', newPassword: 'Yangi-Parol-1' }, { idem: false });
      const r = await s.admin.post(`/users/${u.id}/reset-password`, { password: 'Tiklangan-99' }, { idem: false });
      expect(r.status).toBe(204);
      const again = await as(app, u.username, 'Tiklangan-99');
      expect((await again.get('/products')).status).toBe(200); // majburiy parol almashtirish yo'q
      expect((await c.get('/auth/me')).status).toBe(401); // eski sessiya bekor
    });
  });

  describe('o\'z-o\'zini o\'zgartirish taqiqlari (TZ 3.3 (3))', () => {
    it('o\'z huquqi, holati, o\'zini o\'chirish → 403 self_action_forbidden', async () => {
      const me = (await s.admin.get('/auth/me')).body.user;
      expect(code(await s.admin.put(`/users/${me.id}/permissions`, { permissions: ['view_pos'] }))).toBe('self_action_forbidden');
      expect(code(await s.admin.post(`/users/${me.id}/toggle-active`, {}, { idem: false }))).toBe('self_action_forbidden');
      expect(code(await s.admin.del(`/users/${me.id}`))).toBe('self_action_forbidden');
    });
    it('PATCH o\'zini: ism o\'zgaradi, active/permissions e\'tiborsiz', async () => {
      const me = (await s.admin.get('/auth/me')).body.user;
      const r = await s.admin.patch(`/users/${me.id}`, { name: 'Alisher Navoiy', active: false });
      expect(r.status).toBe(200);
      expect(r.body.active).toBe(true);
    });
  });

  describe('oxirgi administrator (TZ 3.3 (4))', () => {
    /**
     * Aktyor manage_users ga ega bo'lgani uchun oddiy holatda "oxirgi admin"ni kamsita olmaydi (o'zi ham sanaladi),
     * huquqi olingan aktyorning keshi darhol bekor qilinadi (403). Qoida boshqa instansiya bazani o'zgartirgan holat uchun:
     * uni to'g'ridan-to'g'ri SQL bilan taqlid qilamiz — A hali 10 s keshda admin, bazada emas.
     */
    /** Bazada `exceptId` dan boshqa hamma faol admindan manage_users olib qo'yiladi (boshqa test fayllari yaratgan adminlar ham) — qaytarish funksiyasi qaytadi. */
    const stripAdminInDb = async (exceptId: string) => {
      const db = rawDb();
      const { rows } = await db.query(`select id, permissions from users where id <> $1 and 'manage_users' = any(permissions)`, [exceptId]);
      await db.query(`update users set permissions = array_remove(permissions, 'manage_users') where id <> $1 and 'manage_users' = any(permissions)`, [exceptId]);
      await db.end();
      return async () => {
        const d2 = rawDb();
        for (const r of rows) await d2.query('update users set permissions = $2 where id = $1', [r.id, r.permissions]);
        await d2.end();
      };
    };

    it('B huquqini olsa: bazada faol manage_users qolmaydi → 409 last_admin, tranzaksiya orqaga qaytadi', async () => {
      const b = (await newUser(s.admin, { roleId: roles['Super Admin'] })).body;
      const restore = await stripAdminInDb(b.id);
      try {
        const rs = [
          await s.admin.put(`/users/${b.id}/permissions`, { permissions: ['view_pos'] }),
          await s.admin.post(`/users/${b.id}/toggle-active`, {}, { idem: false }),
          await s.admin.del(`/users/${b.id}`),
          await s.admin.patch(`/users/${b.id}`, { active: false }),
        ];
        expect(rs.map((r) => [r.status, r.body?.error?.code ?? 'ok'])).toEqual([[409, 'last_admin'], [409, 'last_admin'], [409, 'last_admin'], [409, 'last_admin']]);
        expect((await s.admin.get(`/users/${b.id}`)).body).toMatchObject({ active: true });
        expect((await s.admin.get(`/users/${b.id}`)).body.permissions).toContain('manage_users');
      } finally {
        await restore();
      }
      expect((await s.admin.del(`/users/${b.id}`)).status).toBe(204);
    });
    it('huquqi olingan adminning keshi darhol bekor bo\'ladi (403), ikki admin bo\'lsa birini nofaol qilish mumkin, tokeni o\'ladi', async () => {
      const b = (await newUser(s.admin, { roleId: roles['Super Admin'] })).body;
      const cb = await as(app, b.username, 'Parol-12345');
      await cb.post('/auth/change-password', { currentPassword: 'Parol-12345', newPassword: 'B-Admin-Parol-3' }, { idem: false });
      const a = (await s.admin.get('/auth/me')).body.user;
      try {
        expect((await cb.put(`/users/${a.id}/permissions`, { permissions: ['view_pos'] })).status).toBe(200);
        expect((await s.admin.get('/users')).status).toBe(403); // kesh bekor, bazadagi holat
      } finally {
        await cb.put(`/users/${a.id}/permissions`, { permissions: a.permissions });
      }
      expect((await s.admin.get('/users')).status).toBe(200);
      expect((await s.admin.post(`/users/${b.id}/toggle-active`, {}, { idem: false })).body.active).toBe(false);
      expect((await cb.get('/auth/me')).status).toBe(401);
      await s.admin.del(`/users/${b.id}`);
    });
  });

  describe('filial admini doirasi (TZ 3.3 (8), 8.12)', () => {
    let branchB: string;
    let badmin: Client;
    let badminId: string;
    beforeAll(async () => {
      branchB = (await s.admin.post('/branches', { name: uniq('Filial ') }, { idem: false })).body.id;
      const r = await newUser(s.admin, { roleId: roles['Filial admini'], branchIds: [branchB], name: 'Filial admini' });
      badminId = r.body.id;
      badmin = await as(app, r.body.username, 'Parol-12345');
      await badmin.post('/auth/change-password', { currentPassword: 'Parol-12345', newPassword: 'Filial-Admin-1' }, { idem: false });
    });
    it('faqat o\'z filiali xodimlarini ko\'radi (egasi va main xodimlari ko\'rinmaydi)', async () => {
      const list = (await badmin.get('/users')).body as { username: string; branchIds: string[]; allBranches: boolean }[];
      expect(list.every((u) => !u.allBranches && u.branchIds.includes(branchB))).toBe(true);
      expect(list.some((u) => u.username === 'admin' || u.username === 'kassir')).toBe(false);
    });
    it('yaratgan xodimi majburan o\'z filialiga; branchIds e\'tiborsiz', async () => {
      const r = await newUser(badmin, { branchIds: [s.mainId] });
      expect(r.status).toBe(201);
      expect(r.body.branchIds).toEqual([branchB]);
    });
    it('egaga xos rol (Super Admin) va huquqlarni (manage_settings) bera olmaydi; o\'zida yo\'q huquqni bera olmaydi', async () => {
      expect((await newUser(badmin, { roleId: roles['Super Admin'] })).status).toBe(403);
      const r = await newUser(badmin, { permissions: ['view_pos', 'manage_settings', 'manage_branches', 'add_product'] });
      expect(r.status).toBe(201);
      // manage_settings/manage_branches — egaga xos; add_product — o'zida yo'q → tushib qoladi
      expect(r.body.permissions).toEqual(['view_pos']);
      const put = await badmin.put(`/users/${r.body.id}/permissions`, { permissions: ['view_pos', 'stock_in', 'manage_settings'] });
      expect(put.body.permissions.sort()).toEqual(['stock_in', 'view_pos']);
    });
    it('boshqa filial xodimini ko\'ra/tahrirlay olmaydi → 403', async () => {
      const kassir = (await s.admin.get('/users')).body.find((u: { username: string }) => u.username === 'kassir');
      expect((await badmin.get(`/users/${kassir.id}`)).status).toBe(403);
      expect((await badmin.patch(`/users/${kassir.id}`, { name: 'X' })).status).toBe(403);
      expect((await badmin.post(`/users/${kassir.id}/toggle-active`, {}, { idem: false })).status).toBe(403);
      expect((await badmin.del(`/users/${kassir.id}`)).status).toBe(403);
    });
    it('egasi filial adminini boshqa filialga o\'tkaza oladi, filial admini o\'zini o\'tkaza olmaydi', async () => {
      const r = await badmin.put(`/users/${badminId}/branches`, { branchIds: [s.mainId] });
      expect(r.status).toBe(200);
      expect(r.body.branchIds).toEqual([branchB]); // majburan o'z filiali
      const owner = await s.admin.put(`/users/${badminId}/branches`, { branchIds: [branchB, s.mainId], defaultBranchId: branchB });
      expect(owner.body.branchIds.sort()).toEqual([branchB, s.mainId].sort());
      expect(owner.body.defaultBranchId).toBe(branchB);
    });
    it('kassir xodimlar ro\'yxatini ko\'ra olmaydi (view_users yo\'q); buxgalter ham', async () => {
      expect((await s.kassir.get('/users')).status).toBe(403);
      expect((await s.buxgalter.get('/users')).status).toBe(403);
    });
  });

  describe('rollar', () => {
    it('CRUD, takror nom 409, manage_settings faqat allBranches rolida (TZ 3.3 (9)), ishlatilayotgan rol o\'chirilmaydi', async () => {
      const name = uniq('Rol ');
      const r = await s.admin.post('/roles', { name, permissions: ['view_pos', 'manage_settings'] }, { idem: false });
      expect(r.status).toBe(422);
      const ok = await s.admin.post('/roles', { name, permissions: ['view_pos', 'view_inventory'] }, { idem: false });
      expect(ok.status).toBe(201);
      expect((await s.admin.post('/roles', { name: name.toUpperCase(), permissions: [] }, { idem: false })).status).toBe(409);
      const upd = await s.admin.patch(`/roles/${ok.body.id}`, { name: name + ' 2', permissions: ['view_pos'], version: ok.body.version });
      expect(upd.status).toBe(200);
      expect((await s.admin.patch(`/roles/${ok.body.id}`, { name, permissions: [], version: ok.body.version })).status).toBe(409);
      const u = (await newUser(s.admin, { roleId: ok.body.id })).body;
      const del = await s.admin.del(`/roles/${ok.body.id}`);
      expect(del.status).toBe(409);
      expect(code(del)).toBe('in_use');
      await s.admin.del(`/users/${u.id}`);
      expect((await s.admin.del(`/roles/${ok.body.id}`)).status).toBe(204);
      expect((await s.kassir.post('/roles', { name: 'x', permissions: [] }, { idem: false })).status).toBe(403);
    });
  });
});
