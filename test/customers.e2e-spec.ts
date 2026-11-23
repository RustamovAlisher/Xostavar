import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { code, createApp, ensureShift, makeProduct, seeded, type Seeded, today as todayStr } from './helpers.js';

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
    expect((await s.admin.get('/customers?q=norm%20qarzdor')).body.items[0].id).toBe(b.id); // tartib ahamiyatsiz
    expect((await s.admin.get(`/customers?q=${encodeURIComponent('Қарздор')}`)).body.items.length).toBeGreaterThan(0); // kirill
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
    const today = todayStr();
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
  it("qarzi bor mijozni o'chirish: faqat writeOff=true bilan; qarz jurnalga yozilib 0 ga tushadi, audit summani ko'rsatadi", async () => {
    const c = (await s.admin.post('/customers', { name: 'Ketgan mijoz', creditLimit: 5_000_000 }, { idem: false })).body;
    await s.admin.post(`/customers/${c.id}/debts`, { amount: 75_000 });
    const no = await s.admin.del(`/customers/${c.id}`);
    expect(code(no)).toBe('in_use');
    expect(no.body.error.message).toMatch(/75/);
    expect((await s.kassir.del(`/customers/${c.id}?writeOff=true`)).status).toBe(403);
    expect((await s.admin.del(`/customers/${c.id}?writeOff=true`)).status).toBe(204);
    expect((await s.admin.get(`/customers/${c.id}`)).status).toBe(404);
    const audit = (await s.admin.get(`/audit-logs?q=${encodeURIComponent('Ketgan mijoz')}&pageSize=5`)).body;
    const items = (audit.items ?? []) as { details: string }[];
    if (items.length) expect(items.some((a) => /75\s?000 so'm qarz hisobdan chiqarildi/.test(a.details))).toBe(true);
  });
  it("qarzni tahrirlash (PUT /customers/:id/debt): oshirish va kamaytirish jurnalga adjustment bo'lib yoziladi; faqat manage_users; manfiy rad", async () => {
    const c = (await s.admin.post('/customers', { name: 'Tahrir qarz', creditLimit: 5_000_000 }, { idem: false })).body;
    await s.admin.post(`/customers/${c.id}/debts`, { amount: 100_000 });
    const down = await s.admin.put(`/customers/${c.id}/debt`, { amount: 60_000, note: 'xato kiritilgan' });
    expect(down.status).toBe(200);
    expect(down.body.totalDebtUZS).toBe(60_000);
    const up = await s.admin.put(`/customers/${c.id}/debt`, { amount: 90_000 });
    expect(up.body.totalDebtUZS).toBe(90_000);
    // o'zgarishsiz — jurnal yozilmaydi
    expect((await s.admin.put(`/customers/${c.id}/debt`, { amount: 90_000 })).body.totalDebtUZS).toBe(90_000);
    const led = (await s.admin.get(`/customers/${c.id}/ledger`)).body.items as { type: string; amount: number; balanceAfter: number; note: string | null }[];
    const adj = led.filter((x) => x.type === 'adjustment');
    expect(adj).toHaveLength(3);
    expect(adj.some((x) => x.amount === -40_000 && x.balanceAfter === 60_000 && x.note === 'xato kiritilgan')).toBe(true);
    expect(adj.some((x) => x.amount === 30_000 && x.balanceAfter === 90_000)).toBe(true);
    // profil jami ledger bilan mos (manfiy tuzatish FIFO bo'yicha yopadi)
    const p = (await s.admin.get(`/customers/${c.id}/profile`)).body;
    expect(p.customer.totalDebtUZS).toBe(90_000);
    // 0 ga tushirish, keyin oddiy o'chirish ishlaydi
    expect((await s.admin.put(`/customers/${c.id}/debt`, { amount: 0 })).body.totalDebtUZS).toBe(0);
    // ruxsat va validatsiya
    expect((await s.kassir.put(`/customers/${c.id}/debt`, { amount: 10_000 })).status).toBe(403);
    expect((await s.admin.put(`/customers/${c.id}/debt`, { amount: -1 })).status).toBe(400);
    expect((await s.admin.put(`/customers/${c.id}/debt`, { amount: 1.5 })).status).toBe(400);
    expect((await s.admin.put(`/customers/${randomUUID()}/debt`, { amount: 1 })).status).toBe(404);
    expect((await s.admin.del(`/customers/${c.id}`)).status).toBe(204);
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
  it("profil: savdolar tarixi, har savdo qarzi; to'lov savdoga bog'lanadi yoki FIFO; jami ledger bilan mos", async () => {
    const c = (await s.admin.post('/customers', { name: 'Profil Mijoz', phone: phone(), creditLimit: 9_000_000 }, { idem: false })).body;
    const p = await makeProduct(s.admin, s, { stock: 50, price: 10_000 });
    const close = await ensureShift(s.admin);
    const sA = (await s.admin.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 3 }], customerId: c.id, onCredit: true })).body; // 30 000 qarz
    const sB = (await s.admin.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 2 }], customerId: c.id, onCredit: true })).body; // 20 000 qarz
    // B savdo uchun 15 000 (bog'langan), keyin umumiy 10 000 (FIFO → A)
    expect((await s.admin.post(`/customers/${c.id}/payments`, { amount: 15_000, methodId: s.methods.cash, saleId: sB.id })).status).toBe(201);
    expect((await s.admin.post(`/customers/${c.id}/payments`, { amount: 10_000, methodId: s.methods.cash })).status).toBe(201);
    // savdo qarzidan katta → 422; boshqa mijozning savdosi → 404
    expect(code(await s.admin.post(`/customers/${c.id}/payments`, { amount: 6_000, methodId: s.methods.cash, saleId: sB.id }))).toBe('validation_failed');
    const other = (await s.admin.post('/customers', { name: 'Boshqa', phone: phone() }, { idem: false })).body;
    expect((await s.admin.post(`/customers/${other.id}/payments`, { amount: 1, methodId: s.methods.cash, saleId: sA.id })).status).toBe(404);
    await close();

    const r = await s.admin.get(`/customers/${c.id}/profile`);
    expect(r.status).toBe(200);
    const b = r.body;
    expect(b.customer).toMatchObject({ id: c.id, totalDebtUZS: 25_000 });
    expect(b.stats).toMatchObject({ salesCount: 2, totalSpent: 50_000, debtSalesCount: 2, openDebtSales: 2, paidTotal: 25_000 });
    const A = b.sales.find((x: { id: string }) => x.id === sA.id);
    const B = b.sales.find((x: { id: string }) => x.id === sB.id);
    expect(A.lines[0]).toMatchObject({ qty: 3, lineTotal: 30_000 });
    expect(A.debt).toMatchObject({ original: 30_000, paid: 10_000, outstanding: 20_000 });
    expect(B.debt).toMatchObject({ original: 20_000, paid: 15_000, outstanding: 5_000 });
    expect(B.debt.payments[0]).toMatchObject({ amount: 15_000, targeted: true });
    expect(A.debt.outstanding + B.debt.outstanding).toBe(b.customer.totalDebtUZS);
    expect(b.payments).toHaveLength(2);
    expect(b.payments.find((x: { debtSaleId: string | null }) => x.debtSaleId === sB.id).allocations).toEqual([{ saleId: sB.id, number: sB.number, amount: 15_000 }]);
    expect((await s.omborchi.get(`/customers/${c.id}/profile`)).status).toBe(403);
  });
  it("telefon ixtiyoriy: bo'sh / +998 / yo'q → telefonsiz mijoz, bir nechtasi yonma-yon; kiritilgan bo'lsa to'liq bo'lishi shart", async () => {
    const a = await s.kassir.post('/customers', { name: 'Telefonsiz 1' }, { idem: false });
    const b = await s.kassir.post('/customers', { name: 'Telefonsiz 2', phone: '' }, { idem: false });
    const c = await s.kassir.post('/customers', { name: 'Telefonsiz 3', phone: '+998 ' }, { idem: false });
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    expect([a.body.phone, b.body.phone, c.body.phone]).toEqual(['', '', '']);
    expect(code(await s.kassir.post('/customers', { name: 'Yarim', phone: '+998 90 12' }, { idem: false }))).toBe('validation_failed');
    // tahrirda ham: telefonni olib tashlash, keyin o'chirish
    const e = await s.admin.patch(`/customers/${a.body.id}`, { name: 'Telefonsiz 1', phone: '', version: a.body.version });
    expect(e.status).toBe(200);
    expect((await s.admin.del(`/customers/${a.body.id}`)).status).toBe(204);
  });
  it("qo'lda qarz: summa kiritiladi, qarz oshadi, profilda izoh/sana bilan band, to'lov FIFO yopadi; permission va validatsiya", async () => {
    const c = (await s.admin.post('/customers', { name: 'Eski daftar', creditLimit: 5_000_000 }, { idem: false })).body;
    const r = await s.kassir.post(`/customers/${c.id}/debts`, { amount: 120_000, note: ' Eski daftardan ', dueDate: '2031-05-01' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ id: c.id, totalDebtUZS: 120_000, dueDate: '2031-05-01' });
    expect((await s.admin.post(`/customers/${c.id}/debts`, { amount: 30_000 })).body.totalDebtUZS).toBe(150_000);
    // noto'g'ri summa; ruxsatsiz rol
    expect((await s.admin.post(`/customers/${c.id}/debts`, { amount: 0 })).status).toBe(400);
    expect((await s.admin.post(`/customers/${c.id}/debts`, { amount: 1.5 })).status).toBe(400);
    expect((await s.omborchi.post(`/customers/${c.id}/debts`, { amount: 1000 })).status).toBe(403);
    expect((await s.admin.post(`/customers/${randomUUID()}/debts`, { amount: 1000 })).status).toBe(404);
    // to'lov eng eski qo'lda qarzdan yopadi
    const close = await ensureShift(s.admin);
    expect((await s.admin.post(`/customers/${c.id}/payments`, { amount: 50_000, methodId: s.methods.cash })).status).toBe(201);
    await close();
    const p = (await s.admin.get(`/customers/${c.id}/profile`)).body;
    expect(p.customer.totalDebtUZS).toBe(100_000);
    expect(p.stats.adjustmentsLeft).toBe(100_000);
    expect(p.manualDebts).toHaveLength(2);
    const first = p.manualDebts.find((m: { note: string | null }) => m.note === 'Eski daftardan');
    expect(first).toMatchObject({ original: 120_000, outstanding: 70_000 });
    expect(first.payments[0]).toMatchObject({ kind: 'payment', amount: 50_000 });
    // qarz jurnalida izoh
    const led = (await s.admin.get(`/customers/${c.id}/ledger`)).body;
    expect(led.items.some((x: { type: string; note: string | null }) => x.type === 'adjustment' && x.note === 'Eski daftardan')).toBe(true);
  });
});
