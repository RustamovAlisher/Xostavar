import { INestApplication } from '@nestjs/common';
import { as, code, createApp, seeded, uniq, type Client, type Seeded } from './helpers.js';

describe('expenses (TZ 7.11, 9.12)', () => {
  let app: INestApplication;
  let s: Seeded;
  let branch: string;
  let c: Client;
  const today = new Date().toISOString().slice(0, 10);
  let cat: string;
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
    branch = (await s.admin.post('/branches', { name: uniq('Xarajat ') }, { idem: false })).body.id;
    c = s.admin.at(branch);
    cat = s.settings.expenseCategories.find((x: { name: string }) => x.name === 'Ijara').id;
  });
  afterAll(() => app.close());

  it('boshqa manbadan xarajat; validatsiya (summa ≥ 1, sana formati, kategoriya, usul); nasiya usuli bilan bo\'lmaydi', async () => {
    const r = await c.post('/expenses', { date: today, categoryId: cat, amount: 1_500_000, methodId: s.methods.card, source: 'other', note: ' oktyabr ' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ branchId: branch, amount: 1500000, source: 'other', shiftId: null, note: 'oktyabr', createdByName: 'Alisher Navoiy' });
    expect((await c.post('/expenses', { date: today, categoryId: cat, amount: 0, methodId: s.methods.card, source: 'other' })).status).toBe(400);
    expect((await c.post('/expenses', { date: '24.10.2026', categoryId: cat, amount: 1, methodId: s.methods.card, source: 'other' })).status).toBe(400);
    expect((await c.post('/expenses', { date: today, categoryId: '00000000-0000-4000-8000-000000000000', amount: 1, methodId: s.methods.card, source: 'other' })).status).toBe(404);
    expect(code(await c.post('/expenses', { date: today, categoryId: cat, amount: 1, methodId: s.methods.debt, source: 'other' }))).toBe('payment_method_disabled');
    expect((await c.post('/expenses', { date: today, categoryId: cat, amount: 1, methodId: s.methods.card, source: 'other' }, { idem: false })).status).toBe(400);
  });

  it('kassadan chiqim: smena shart (shift_required), faqat naqd, boshqa xodim smenasida faqat admin; smena jamlariga kiradi', async () => {
    expect(code(await c.post('/expenses', { date: today, categoryId: cat, amount: 1000, methodId: s.methods.cash, source: 'cash_register' }))).toBe('shift_required');
    await c.post('/shifts/open', { openingCash: 100000 });
    expect(code(await c.post('/expenses', { date: today, categoryId: cat, amount: 1000, methodId: s.methods.card, source: 'cash_register' }))).toBe('validation_failed');
    const r = await c.post('/expenses', { date: today, categoryId: cat, amount: 40000, methodId: s.methods.cash, source: 'cash_register' });
    expect(r.status).toBe(201);
    expect(r.body.shiftId).toBeTruthy();
    const cur = (await c.get('/shifts/current')).body;
    expect(cur.totals.cashOut).toBe(40000);
    const closed = await c.post('/shifts/close', {});
    expect(closed.body.expectedCash).toBe(60000);
  });

  it('huquqlar: buxgalter yozadi (manage_expenses), kassir ko\'ra olmaydi (view_expenses yo\'q); boshqa xodim yozganini faqat admin o\'chiradi', async () => {
    const bux = (await as(app, 'buxgalter')).at(s.mainId);
    const e = await bux.post('/expenses', { date: today, categoryId: cat, amount: 5000, methodId: s.methods.card, source: 'other' });
    expect(e.status).toBe(201);
    expect((await s.kassir.get('/expenses')).status).toBe(403);
    expect((await s.kassir.post('/expenses', { date: today, categoryId: cat, amount: 1, methodId: s.methods.card, source: 'other' })).status).toBe(403);
    // Filial admini rolidagi boshqa xodim buxgalterning yozuvini o'chira olmaydi
    const roleId = (await s.admin.get('/roles')).body.find((r: { name: string }) => r.name === 'Filial admini').id;
    const u = (await s.admin.post('/users', { name: 'FA', username: uniq('fa'), roleId, password: 'Parol-12345', branchIds: [s.mainId] }, { idem: false })).body;
    const fa = await as(app, u.username, 'Parol-12345');
    await fa.post('/auth/change-password', { currentPassword: 'Parol-12345', newPassword: 'Filial-Admin-7' }, { idem: false });
    // Filial adminida manage_users bor → boshqaniki o'chiriladi; demak omborchi (manage_expenses yo'q) 403, buxgalter o'ziniki 201
    expect((await s.omborchi.post(`/expenses/${e.body.id}/void`, {})).status).toBe(403);
    expect((await fa.post(`/expenses/${e.body.id}/void`, {})).status).toBe(201);
    expect(code(await bux.post(`/expenses/${e.body.id}/void`, {}))).toBe('already_voided');
  });

  it('PATCH: sana/kategoriya/izoh; summa o\'zgarmaydi (whitelist); boshqa filial xarajati 403', async () => {
    const e = (await c.post('/expenses', { date: today, categoryId: cat, amount: 7000, methodId: s.methods.card, source: 'other' })).body;
    const other = s.settings.expenseCategories.find((x: { name: string }) => x.name === 'Reklama').id;
    const r = await c.patch(`/expenses/${e.id}`, { categoryId: other, note: 'banner', amount: 1 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ categoryId: other, note: 'banner', amount: 7000 });
    expect(code(await s.admin.patch(`/expenses/${e.id}`, { note: 'x' }))).toBe('branch_forbidden');
  });

  it('ro\'yxat: davr, kategoriya, manba filtrlari; kategoriya bo\'yicha jami; o\'chirilganlar chiqmaydi; egasi branchId=all', async () => {
    const r = (await c.get(`/expenses?from=${today}&to=${today}`)).body;
    expect(r.total).toBeGreaterThanOrEqual(3);
    expect(r.items[0]).toHaveProperty('category');
    expect(r.items.every((x: { voidedAt: string | null }) => !x.voidedAt)).toBe(true);
    expect(r.summary.sum).toBe(r.items.reduce((a: number, x: { amount: number }) => a + x.amount, 0));
    expect(r.summary.fromRegister).toBe(40000);
    expect(r.summary.byCategory.find((x: { name: string }) => x.name === 'Ijara').sum).toBeGreaterThan(0);
    expect((await c.get('/expenses?source=cash_register')).body.items.every((x: { source: string }) => x.source === 'cash_register')).toBe(true);
    expect((await c.get(`/expenses?categoryId=${cat}`)).body.items.every((x: { categoryId: string }) => x.categoryId === cat)).toBe(true);
    const all = (await c.get('/expenses?branchId=all')).body;
    expect(all.total).toBeGreaterThan(r.total); // buxgalterning main dagi yozuvi ham
    const bux = (await as(app, 'buxgalter')).at(s.mainId);
    expect((await bux.get('/expenses?branchId=all')).body.items.every((x: { branchId: string }) => x.branchId === s.mainId)).toBe(true); // all faqat egasi uchun
  });
});
