import { INestApplication } from '@nestjs/common';
import { code, createApp, makeProduct, seeded, uniq, type Seeded } from './helpers.js';

describe('settings (TZ 7.2, 9.3)', () => {
  let app: INestApplication;
  let s: Seeded;
  const bundle = () => s.admin.get('/settings').then((r) => r.body);
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
  });
  afterAll(() => app.close());

  it('GET: barcha lug\'atlar bir javobda, seed qiymatlari', async () => {
    const d = await bundle();
    expect(d.store.name).toBe('OMBOR CONTROL');
    expect(d.rules).toMatchObject({ vatPct: 12, requireShift: true, cashierMaxDiscount: 0, defaultCreditDays: 30 });
    expect(d.units.map((u: { id: string }) => u.id)).toContain('meter');
    expect(d.categories.length).toBe(8);
    expect(d.sizePresets.length).toBe(13);
    expect(d.paymentMethods.map((m: { code: string }) => m.code).sort()).toEqual(['card', 'cash', 'debt', 'transfer']);
    expect(d.expenseCategories.length).toBe(8);
    // Kassir ham o'qiy oladi (kassa uchun), lekin yoza olmaydi
    expect((await s.kassir.get('/settings')).status).toBe(200);
    expect((await s.kassir.put('/settings', d)).status).toBe(403);
  });

  it('PUT: o\'zgarishsiz saqlash muvaffaqiyatli, versiyalar oshadi, audit yoziladi', async () => {
    const d = await bundle();
    const r = await s.admin.put('/settings', { ...d, store: { ...d.store, phone: '+998 71 200 00 00' }, rules: { ...d.rules, cashierMaxDiscount: 50000 } });
    expect(r.status).toBe(200);
    expect(r.body.store.phone).toBe('+998 71 200 00 00');
    expect(r.body.rules.cashierMaxDiscount).toBe(50000);
    expect(r.body.store.version).toBe(d.store.version + 1);
    const log = (await s.admin.get('/audit-logs?module=Sozlamalar&pageSize=1')).body.items[0];
    expect(log.action).toBe('edit');
    expect(log.branchId).toBeNull(); // umumiy amal
  });

  it('validatsiya: QQS 0–100, takror nomlar, oxirgi kategoriya, bo\'sh do\'kon nomi, nasiya bo\'lmagan usul yo\'q', async () => {
    const d = await bundle();
    expect((await s.admin.put('/settings', { ...d, rules: { ...d.rules, vatPct: 120 } })).status).toBe(400);
    expect((await s.admin.put('/settings', { ...d, store: { ...d.store, name: '' } })).status).toBe(400);
    const dupCat = await s.admin.put('/settings', { ...d, categories: [...d.categories, { ...d.categories[0], id: undefined, name: d.categories[0].name.toUpperCase() }] });
    expect(dupCat.status).toBe(422);
    expect(dupCat.body.error.message).toMatch(/takrorlangan/);
    expect((await s.admin.put('/settings', { ...d, categories: [] })).status).toBe(422);
    expect((await s.admin.put('/settings', { ...d, customerGroups: [] })).status).toBe(422);
    const noPlain = await s.admin.put('/settings', { ...d, paymentMethods: d.paymentMethods.map((m: { kind: string }) => ({ ...m, enabled: m.kind === 'debt' })) });
    expect(noPlain.status).toBe(422);
    const badConv = await s.admin.put('/settings', { ...d, categories: d.categories.map((c: { defaultBaseUnit: string }, i: number) => (i ? c : { ...c, defaultConversions: [{ unit: c.defaultBaseUnit, factor: 1 }] })) });
    expect(badConv.status).toBe(422);
    const unitFmt = await s.admin.put('/settings', { ...d, units: [...d.units, { id: 'Yomon Kod', name: 'x', short: 'x', precision: 0 }] });
    expect(unitFmt.status).toBe(400);
  });

  it('lug\'at qo\'shish/o\'zgartirish/o\'chirish id bo\'yicha; ishlatilayotgan birlik, kategoriya, guruh 409 in_use', async () => {
    const d = await bundle();
    // Yangi birlik va kategoriya qo'shamiz
    const unitId = uniq('u').toLowerCase().replace(/[^a-z0-9]/g, '');
    const r = await s.admin.put('/settings', {
      ...d,
      units: [...d.units, { id: unitId, name: 'Yangi birlik', short: uniq('yb'), precision: 1 }],
      categories: [...d.categories, { name: uniq('Kategoriya '), defaultBaseUnit: unitId, defaultIsDivisible: true, defaultConversions: [] }],
      customerGroups: [...d.customerGroups, { name: uniq('Guruh ') }],
      suppliers: [...d.suppliers, { name: uniq('Yetk '), phone: '123' }],
      expenseCategories: [...d.expenseCategories, { name: uniq('Xarajat ') }],
    });
    expect(r.status).toBe(200);
    const newCat = r.body.categories.find((c: { defaultBaseUnit: string }) => c.defaultBaseUnit === unitId);
    expect(newCat).toBeTruthy();
    // Shu birlik/kategoriyada mahsulot yaratamiz → o'chirish 409
    const p = await s.admin.post('/products', { name: uniq('P '), categoryId: newCat.id, baseUnit: unitId, isDivisible: true, conversions: [], retailPrice: 100, isVariable: false }, { idem: false });
    expect(p.status).toBe(201);
    const d2 = await bundle();
    // Birlik hali kategoriya shablonida → avval validatsiya (422); birlik + kategoriya birga → mahsulot ishlatmoqda (409)
    expect((await s.admin.put('/settings', { ...d2, units: d2.units.filter((u: { id: string }) => u.id !== unitId) })).status).toBe(422);
    const delBoth = await s.admin.put('/settings', { ...d2, units: d2.units.filter((u: { id: string }) => u.id !== unitId), categories: d2.categories.filter((c: { id: string }) => c.id !== newCat.id) });
    expect(delBoth.status).toBe(409);
    expect(code(delBoth)).toBe('in_use');
    const delCat = await s.admin.put('/settings', { ...d2, categories: d2.categories.filter((c: { id: string }) => c.id !== newCat.id) });
    expect(code(delCat)).toBe('in_use');
    // Guruhda mijoz bo'lsa 409
    const grp = d2.customerGroups[d2.customerGroups.length - 1];
    await s.admin.post('/customers', { name: 'G', phone: '+998 90 ' + String(Math.floor(1000000 + Math.random() * 8999999)), groupId: grp.id }, { idem: false });
    const delGrp = await s.admin.put('/settings', { ...d2, customerGroups: d2.customerGroups.filter((g: { id: string }) => g.id !== grp.id) });
    expect(code(delGrp)).toBe('in_use');
    // Mahsulotni o'chirgach birlik/kategoriya o'chadi
    await s.admin.del(`/products/${p.body.id}`);
    const d3 = await bundle();
    const ok = await s.admin.put('/settings', { ...d3, units: d3.units.filter((u: { id: string }) => u.id !== unitId), categories: d3.categories.filter((c: { id: string }) => c.id !== newCat.id) });
    expect(ok.status).toBe(200);
    expect(ok.body.units.some((u: { id: string }) => u.id === unitId)).toBe(false);
  });

  it('o\'lcham andozalari kategoriya bilan birga; nom o\'zgarganda id saqlanadi', async () => {
    const d = await bundle();
    const cat = d.categories[0];
    const r = await s.admin.put('/settings', { ...d, sizePresets: [...d.sizePresets, { categoryId: cat.id, name: uniq('Ø '), kgPerMeter: 0.5 }], categories: d.categories.map((c: { id: string; name: string }) => (c.id === cat.id ? { ...c, name: c.name + ' (yangi)' } : c)) });
    expect(r.status).toBe(200);
    expect(r.body.categories.find((c: { id: string }) => c.id === cat.id).name).toBe(cat.name + ' (yangi)');
    expect(r.body.sizePresets.length).toBe(d.sizePresets.length + 1);
    await s.admin.put('/settings', { ...r.body, categories: r.body.categories.map((c: { id: string }) => (c.id === cat.id ? { ...c, name: cat.name } : c)) });
  });

  describe('to\'lov usullari', () => {
    it('tizim usuli o\'chirilmaydi, turi o\'zgarmaydi; yangi usul qo\'shiladi; takror nom 422; debt turi faqat tizimda', async () => {
      const d = await bundle();
      const noCash = await s.admin.put('/settings', { ...d, paymentMethods: d.paymentMethods.filter((m: { code: string }) => m.code !== 'cash') });
      expect(code(noCash)).toBe('in_use');
      const r = await s.admin.put('/settings', { ...d, paymentMethods: [...d.paymentMethods.map((m: { code: string; kind: string }) => (m.code === 'card' ? { ...m, kind: 'other', label: 'Karta/terminal' } : m)), { label: 'Click', kind: 'other', enabled: true }] });
      expect(r.status).toBe(200);
      const card = r.body.paymentMethods.find((m: { code: string }) => m.code === 'card');
      expect(card).toMatchObject({ kind: 'card', label: 'Karta/terminal' }); // tur o'zgarmadi, nom o'zgardi
      const click = r.body.paymentMethods.find((m: { label: string }) => m.label === 'Click');
      expect(click).toMatchObject({ kind: 'other', system: false, enabled: true });
      expect((await s.admin.put('/settings', { ...r.body, paymentMethods: [...r.body.paymentMethods, { label: 'click', kind: 'other', enabled: true }] })).status).toBe(422);
      expect((await s.admin.put('/settings', { ...r.body, paymentMethods: [...r.body.paymentMethods, { label: 'Yana nasiya', kind: 'debt', enabled: true }] })).status).toBe(422);
      // Cheklarda ishlatilgan maxsus usul o'chirilmaydi (faqat o'chirib qo'yish)
      const p = await makeProduct(s.admin, s, { stock: 5, price: 1000 });
      await s.admin.post('/shifts/open', {});
      const sale = await s.admin.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 1 }], payments: [{ methodId: click.id, amount: 1000 }] });
      expect(sale.status).toBe(201);
      await s.admin.post('/shifts/close', {});
      const d2 = await bundle();
      const del = await s.admin.put('/settings', { ...d2, paymentMethods: d2.paymentMethods.filter((m: { id: string }) => m.id !== click.id) });
      expect(code(del)).toBe('in_use');
      const off = await s.admin.put('/settings', { ...d2, paymentMethods: d2.paymentMethods.map((m: { id: string }) => (m.id === click.id ? { ...m, enabled: false, kind: 'card' } : m)) });
      expect(off.status).toBe(200);
      expect(off.body.paymentMethods.find((m: { id: string }) => m.id === click.id)).toMatchObject({ enabled: false, kind: 'other' }); // ishlatilgan usulning turi o'zgarmaydi
      await s.admin.put('/settings', { ...off.body, paymentMethods: off.body.paymentMethods.map((m: { code: string }) => (m.code === 'card' ? { ...m, label: 'Plastik karta' } : m)) });
    });
  });

  it('reset: standart qiymatlar qaytadi, ishlatilayotgan maxsus yozuvlar saqlanadi', async () => {
    const d = await bundle();
    await s.admin.put('/settings', { ...d, store: { ...d.store, name: 'Boshqa nom' }, rules: { ...d.rules, vatPct: 15 } });
    const r = await s.admin.post('/settings/reset', {}, { idem: false });
    expect(r.status).toBe(201);
    expect(r.body.store.name).toBe('OMBOR CONTROL');
    expect(r.body.rules.vatPct).toBe(12);
    expect(r.body.paymentMethods.find((m: { code: string }) => m.code === 'cash').enabled).toBe(true);
    expect(r.body.paymentMethods.some((m: { label: string }) => m.label === 'Click')).toBe(true); // maxsus usul saqlandi
    expect((await s.admin.get('/audit-logs?action=settings_reset')).body.total).toBeGreaterThan(0);
  });
});
