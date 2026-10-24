import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { as, code, createApp, seeded, uniq, type Seeded } from './helpers.js';

describe('branches (TZ 7.0, 7.0.1, 9.0)', () => {
  let app: INestApplication;
  let s: Seeded;
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
  });
  afterAll(() => app.close());

  it('yaratish: kod nomdan, takror nom (harf farqsiz) 409, kod formati tekshiriladi', async () => {
    const name = uniq('Yunusobod ');
    const r = await s.admin.post('/branches', { name, address: ' Toshkent ', phone: '' }, { idem: false });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ code: 'YUNUSOBOD', name, address: 'Toshkent', phone: null, active: true, isMain: false });
    expect((await s.admin.post('/branches', { name: name.toUpperCase() }, { idem: false })).status).toBe(409);
    expect((await s.admin.post('/branches', { name: uniq(), code: 'abc' }, { idem: false })).status).toBe(400);
    const dupCode = await s.admin.post('/branches', { name: uniq('X '), code: 'YUNUSOBOD' }, { idem: false });
    expect(code(dupCode)).toBe('duplicate_code');
    // Ikkinchi "Yunusobod ..." → YUNUSOBOD2
    const r2 = await s.admin.post('/branches', { name: uniq('Yunusobod ') }, { idem: false });
    expect(r2.body.code).toBe('YUNUSOBOD2');
  });

  it('faqat manage_branches: kassir va filial admini yarata olmaydi', async () => {
    expect((await s.kassir.post('/branches', { name: 'x' }, { idem: false })).status).toBe(403);
    expect((await s.kassir.get('/branches/overview')).status).toBe(403);
  });

  it('ro\'yxat: egasi hammasini, kassir faqat o\'zinikini', async () => {
    const all = (await s.admin.get('/branches')).body;
    expect(all.length).toBeGreaterThan(1);
    const mine = (await s.kassir.get('/branches')).body;
    expect(mine.map((b: { id: string }) => b.id)).toEqual([s.mainId]);
  });

  it('tahrirlash: version conflict; nom boshqa filial bilan to\'qnashsa 409', async () => {
    const b = (await s.admin.post('/branches', { name: uniq('B ') }, { idem: false })).body;
    const upd = await s.admin.patch(`/branches/${b.id}`, { address: 'Manzil', receiptFooter: 'Rahmat', version: b.version });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ address: 'Manzil', receiptFooter: 'Rahmat', version: b.version + 1 });
    expect(code(await s.admin.patch(`/branches/${b.id}`, { name: 'Z', version: b.version }))).toBe('version_conflict');
    expect((await s.admin.patch(`/branches/${b.id}`, { name: 'Asosiy filial' })).status).toBe(409);
  });

  describe('nofaol qilish qoidalari', () => {
    it('kamida bitta faol filial qolishi shart', async () => {
      const list = (await s.admin.get('/branches')).body as { id: string; active: boolean }[];
      const others = list.filter((x) => x.active && x.id !== s.mainId);
      try {
        for (const b of others) {
          const cur = await s.admin.at(b.id).get('/shifts/current');
          if (cur.body?.id) await s.admin.at(b.id).post('/shifts/close', {});
          expect((await s.admin.post(`/branches/${b.id}/deactivate`, {}, { idem: false })).status).toBe(201);
        }
        const r = await s.admin.post(`/branches/${s.mainId}/deactivate`, {}, { idem: false });
        expect(r.status).toBe(409);
        expect(code(r)).toBe('in_use');
      } finally {
        for (const b of others) await s.admin.post(`/branches/${b.id}/activate`, {}, { idem: false });
        await s.admin.post(`/branches/${s.mainId}/activate`, {}, { idem: false });
      }
    });
    it('ochiq smenasi bor filial nofaol qilinmaydi', async () => {
      const b = (await s.admin.post('/branches', { name: uniq('Smena ') }, { idem: false })).body;
      await s.admin.at(b.id).post('/shifts/open', { openingCash: 0 });
      const r = await s.admin.post(`/branches/${b.id}/deactivate`, {}, { idem: false });
      expect(r.status).toBe(409);
      await s.admin.at(b.id).post('/shifts/close', {});
      expect((await s.admin.post(`/branches/${b.id}/deactivate`, {}, { idem: false })).body.active).toBe(false);
      expect((await s.admin.post(`/branches/${b.id}/activate`, {}, { idem: false })).body.active).toBe(true);
    });
    it('nofaol filialga biriktirilgan xodim kira olmaydi (branch_inactive); nofaol filial konteksti 403', async () => {
      const b = (await s.admin.post('/branches', { name: uniq('Nofaol ') }, { idem: false })).body;
      const roleId = (await s.admin.get('/roles')).body.find((r: { name: string }) => r.name === 'Kassir').id;
      const u = (await s.admin.post('/users', { name: 'K', username: uniq('k'), roleId, password: 'Parol-12345', branchIds: [b.id] }, { idem: false })).body;
      const c = await as(app, u.username, 'Parol-12345');
      await c.post('/auth/change-password', { currentPassword: 'Parol-12345', newPassword: 'Kassir-Parol-1' }, { idem: false });
      await s.admin.post(`/branches/${b.id}/deactivate`, {}, { idem: false });
      const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ login: u.username, password: 'Kassir-Parol-1' });
      expect(login.status).toBe(403);
      expect(code(login)).toBe('branch_inactive');
      const r = await s.admin.at(b.id).get('/shifts/current');
      expect(code(r)).toBe('branch_inactive');
    });
  });

  it('X-Branch-Id: kassir boshqa filialga 403 branch_forbidden; mavjud bo\'lmagan id 403; egasi istalgan faol filialga', async () => {
    const other = (await s.admin.get('/branches')).body.find((b: { id: string; active: boolean }) => b.id !== s.mainId && b.active);
    expect(code(await s.kassir.at(other.id).get('/shifts/current'))).toBe('branch_forbidden');
    expect(code(await s.kassir.at('00000000-0000-4000-8000-000000000000').get('/shifts/current'))).toBe('branch_forbidden');
    expect((await s.admin.at(other.id).get('/shifts/current')).status).toBe(200);
  });

  it('overview: har filial bo\'yicha ko\'rsatkichlar va jami; tannarxsiz foydalanuvchida stockValue yo\'q', async () => {
    const r = await s.admin.get('/branches/overview');
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThan(1);
    const main = r.body.items.find((b: { id: string }) => b.id === s.mainId);
    expect(main).toMatchObject({ code: 'MAIN', staff: expect.any(Number), shift: { open: false } });
    expect(main).toHaveProperty('stockValue');
    expect(r.body.totals).toMatchObject({ branches: r.body.items.length, activeBranches: r.body.items.filter((b: { active: boolean }) => b.active).length });
  });
});
