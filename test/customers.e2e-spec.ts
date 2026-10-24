import { INestApplication } from '@nestjs/common';
import { code, createApp, ensureShift, makeProduct, seeded, type Seeded } from './helpers.js';

const phone = () => '+998 9' + String(Math.floor(10000000 + Math.random() * 89999999));

describe('customers (TZ 7.5, 8.8, 9.8)', () => {
  let app: INestApplication;
  let s: Seeded;
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
  });
  afterAll(() => app.close());

  it('yaratish: telefon normalizatsiya (9 raqam → 998), standart limit/muddat/guruh (biznes qoidalari), frontend shakli', async () => {
    const ph = phone();
    const r = await s.kassir.post('/customers', { name: ' Akmal Prorab ', phone: ph.slice(5) }, { idem: false });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'Akmal Prorab', phone: ph.replace(/\D/g, ''), totalDebtUZS: 0, creditLimitUZS: s.settings.rules.defaultCreditLimit, role: 'Chakana', overdue: false });
    expect(r.body.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.body.version).toBe(1);
  });
  it('takror telefon (formati har xil) → 409; yaroqsiz telefon → 422; bo\'sh nom → 400', async () => {
    const ph = phone();
    await s.admin.post('/customers', { name: 'A', phone: ph }, { idem: false });
    const dup = await s.admin.post('/customers', { name: 'B', phone: ph.replace(/\D/g, '').slice(3) }, { idem: false });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/allaqachon/);
    expect(code(await s.admin.post('/customers', { name: 'C', phone: '12345' }, { idem: false }))).toBe('validation_failed');
    expect((await s.admin.post('/customers', { name: '', phone: ph }, { idem: false })).status).toBe(400);
  });
  it('tahrirlash: give_debt yoki manage_users; totalDebt o\'zgarmaydi; version conflict; limitni qarzdan kichik qilish mumkin', async () => {
    const c = (await s.admin.post('/customers', { name: 'X', phone: phone(), creditLimit: 1_000_000 }, { idem: false })).body;
    const r = await s.kassir.patch(`/customers/${c.id}`, { name: 'X2', phone: c.phone, creditLimit: 10, dueDate: '2030-01-01', version: c.version });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'X2', creditLimitUZS: 10, dueDate: '2030-01-01', totalDebtUZS: 0, version: 2 });
    expect(code(await s.admin.patch(`/customers/${c.id}`, { name: 'X3', phone: c.phone, version: 1 }))).toBe('version_conflict');
    expect((await s.omborchi.patch(`/customers/${c.id}`, { name: 'Y', phone: c.phone })).status).toBe(403);
  });
  it('ro\'yxat: nom/telefon qidiruv, hasDebt va overdue filtrlari, tartib (muddati o\'tganlar oldin, keyin qarz bo\'yicha)', async () => {
    const a = (await s.admin.post('/customers', { name: 'Qarzdor Overdue', phone: phone(), creditLimit: 9_000_000, dueDate: '2020-01-01' }, { idem: false })).body;
    const b = (await s.admin.post('/customers', { name: 'Qarzdor Normal', phone: phone(), creditLimit: 9_000_000 }, { idem: false })).body;
    const p = await makeProduct(s.admin, s, { stock: 100, price: 100_000 });
    const close = await ensureShift(s.admin);
    // a: 300 000 qarz (muddat o'tgan), b: 500 000 qarz
    expect((await s.admin.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 3 }], customerId: a.id, onCredit: true })).status).toBe(201);
    expect((await s.admin.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 5 }], customerId: b.id, onCredit: true })).status).toBe(201);
    // Nasiyadan keyin o'tgan muddat yangilanadi (TZ 8.8) — muddati o'tgan holatni qo'lda qaytaramiz
    const av = (await s.admin.get(`/customers/${a.id}`)).body;
    expect(av.dueDate > '2020-01-01').toBe(true);
    await s.admin.patch(`/customers/${a.id}`, { name: av.name, phone: av.phone, dueDate: '2020-01-01', version: av.version });
    const hasDebt = (await s.admin.get('/customers?hasDebt=true&pageSize=500')).body.items as { id: string; totalDebtUZS: number; overdue: boolean; dueDate: string }[];
    const ia = hasDebt.findIndex((x) => x.id === a.id);
    const ib = hasDebt.findIndex((x) => x.id === b.id);
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(hasDebt.find((x) => x.id === a.id)).toMatchObject({ totalDebtUZS: 300_000, overdue: true, dueDate: '2020-01-01' });
    expect(ia).toBeLessThan(ib); // muddati o'tgan oldinda
    expect(hasDebt.every((x) => x.totalDebtUZS > 0)).toBe(true);
    const overdue = (await s.admin.get('/customers?overdue=true&pageSize=500')).body.items as { id: string }[];
    expect(overdue.some((x) => x.id === a.id)).toBe(true);
    expect(overdue.some((x) => x.id === b.id)).toBe(false);
    expect((await s.admin.get(`/customers?q=${a.phone.slice(-6)}`)).body.items[0].id).toBe(a.id);
    expect((await s.admin.get('/customers?q=qarzdor%20norm')).body.items[0].id).toBe(b.id);
    await close();
  });
  it('nasiya muddati: muddat o\'tgan mijozga nasiya berilsa yangi muddat = bugun + N; o\'tmagan va uzoqroq bo\'lsa saqlanadi', async () => {
    const far = (await s.admin.post('/customers', { name: 'Uzoq muddat', phone: phone(), creditLimit: 9_000_000, dueDate: '2030-06-01' }, { idem: false })).body;
    const past = (await s.admin.post('/customers', { name: 'O\'tgan muddat', phone: phone(), creditLimit: 9_000_000, dueDate: '2021-01-01' }, { idem: false })).body;
    const p = await makeProduct(s.admin, s, { stock: 10, price: 1000 });
    const close = await ensureShift(s.admin);
    await s.admin.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 1 }], customerId: far.id, onCredit: true });
    await s.admin.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 1 }], customerId: past.id, onCredit: true });
    await close();
    expect((await s.admin.get(`/customers/${far.id}`)).body.dueDate).toBe('2030-06-01');
    const today = new Date().toISOString().slice(0, 10);
    expect((await s.admin.get(`/customers/${past.id}`)).body.dueDate > today).toBe(true);
  });
  it('o\'chirish: faqat manage_users va qarz 0; yumshoq (telefon bo\'shaydi)', async () => {
    const c = (await s.admin.post('/customers', { name: 'Del', phone: phone() }, { idem: false })).body;
    expect((await s.kassir.del(`/customers/${c.id}`)).status).toBe(403);
    expect((await s.admin.del(`/customers/${c.id}`)).status).toBe(204);
    expect((await s.admin.get(`/customers/${c.id}`)).status).toBe(404);
    expect((await s.admin.post('/customers', { name: 'Del2', phone: c.phone }, { idem: false })).status).toBe(201);
    const debtor = (await s.admin.get('/customers?hasDebt=true&pageSize=1')).body.items[0];
    expect(code(await s.admin.del(`/customers/${debtor.id}`))).toBe('in_use');
  });
  it('ledger: har harakat balance_after bilan; customers.total_debt = oxirgi balance_after (TZ 18.6)', async () => {
    const c = (await s.admin.post('/customers', { name: 'Ledger', phone: phone(), creditLimit: 9_000_000 }, { idem: false })).body;
    const p = await makeProduct(s.admin, s, { stock: 10, price: 10_000 });
    const close = await ensureShift(s.admin);
    await s.admin.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 2 }], customerId: c.id, onCredit: true });
    await s.admin.post(`/customers/${c.id}/payments`, { amount: 5000, methodId: s.methods.cash });
    await close();
    const l = (await s.admin.get(`/customers/${c.id}/ledger`)).body.items as { type: string; amount: number; balanceAfter: number }[];
    expect(l.map((x) => [x.type, x.amount, x.balanceAfter])).toEqual([['payment', -5000, 15000], ['sale_debt', 20000, 20000]]);
    expect((await s.admin.get(`/customers/${c.id}`)).body).toMatchObject({ totalDebtUZS: 15000 });
    expect((await s.kassir.get(`/customers/${c.id}/ledger`)).status).toBe(200); // view_debts
    expect((await s.omborchi.get(`/customers/${c.id}/ledger`)).status).toBe(403);
  });
});
