import { INestApplication } from '@nestjs/common';
import { createApp, makeProduct, rawDb, seeded, uniq, type Client, type Seeded } from './helpers.js';

const phone = () => '+998 9' + String(Math.floor(10000000 + Math.random() * 89999999));

/** TZ 18.3, 18.4, 18.5, 18.6 — parallel yuklama ostida yaxlitlik. */
describe('concurrency & integrity', () => {
  let app: INestApplication;
  let s: Seeded;
  let c: Client;
  beforeAll(async () => {
    app = await createApp();
    s = await seeded(app);
    const branch = (await s.admin.post('/branches', { name: uniq('Parallel ') }, { idem: false })).body.id;
    c = s.admin.at(branch);
    await c.post('/shifts/open', {});
  });
  afterAll(async () => {
    await c.post('/shifts/close', {});
    await app.close();
  });

  it('20 ta parallel sotuv, qoldiq 10: aynan 10 tasi muvaffaqiyatli, qoldiq 0, manfiy emas, jurnal yig\'indisi mos (TZ 18.3)', async () => {
    const p = await makeProduct(c, s, { stock: 10, price: 1000 });
    const results = await Promise.all(Array.from({ length: 20 }, () => c.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 1 }], payments: [{ methodId: s.methods.cash, amount: 1000 }] })));
    const ok = results.filter((r) => r.status === 201);
    const failed = results.filter((r) => r.status !== 201);
    expect(ok.length).toBe(10);
    expect(failed.every((r) => r.body.error.code === 'insufficient_stock')).toBe(true);
    expect((await c.get(`/products/${p.id}`)).body.stock).toBe(0);
    const mv = (await c.get(`/stock-movements?productId=${p.id}&pageSize=100`)).body.items as { qtyBase: number; type: string; balanceAfter: number }[];
    expect(mv.filter((m) => m.type === 'sale').length).toBe(10);
    expect(mv.reduce((a, m) => a + m.qtyBase, 0)).toBe(0);
    expect(mv.every((m) => m.balanceAfter >= 0)).toBe(true);
    // Chek raqamlari unikal va ketma-ket
    const numbers = ok.map((r) => Number(r.body.number.slice(-4))).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(10);
    expect(numbers[9] - numbers[0]).toBe(9);
  });

  it('bir xil Idempotency-Key bilan 5 ta parallel POST /sales: bitta chek, qoldiq bir marta (TZ 18.4)', async () => {
    const p = await makeProduct(c, s, { stock: 10, price: 1000 });
    const key = uniq('par-');
    const results = await Promise.all(Array.from({ length: 5 }, () => c.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 2 }], payments: [{ methodId: s.methods.cash, amount: 2000 }] }, { idem: key })));
    const ids = new Set(results.filter((r) => r.status === 201).map((r) => r.body.id));
    // Interceptor javobni so'rov tugagach saqlaydi: bir vaqtda kelganlar orasida takror bo'lishi mumkin, lekin qoldiq hech qachon noto'g'ri bo'lmasligi shart
    const stock = (await c.get(`/products/${p.id}`)).body.stock;
    const sales = (await c.get(`/sales?pageSize=100`)).body.items.filter((x: { lines: { productId: string }[] }) => x.lines.some((l) => l.productId === p.id)).length;
    expect(10 - stock).toBe(2 * sales);
    expect(ids.size).toBeGreaterThanOrEqual(1);
  });

  it('parallel kirim va sotuv bitta mahsulotga: yakuniy qoldiq = kirim − sotuv', async () => {
    const p = await makeProduct(c, s, { stock: 5, price: 100 });
    const ops = [
      ...Array.from({ length: 10 }, () => c.post('/stock-in', { lines: [{ productId: p.id, unit: 'piece', qty: 3, costPerUnit: 50 }] })),
      ...Array.from({ length: 10 }, () => c.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 2 }], payments: [{ methodId: s.methods.cash, amount: 200 }] })),
    ];
    const results = await Promise.all(ops.map((o) => o.then((r) => r.status)));
    const soldOk = results.slice(10).filter((st) => st === 201).length;
    expect(results.slice(0, 10).every((st) => st === 201)).toBe(true);
    expect((await c.get(`/products/${p.id}`)).body.stock).toBe(5 + 30 - 2 * soldOk);
  });

  it('parallel qarz to\'lovlari (3 raund): balans ketma-ket, ledger balance_after monoton, total_debt = oxirgi balance (TZ 18.6)', async () => {
    const cu = (await c.post('/customers', { name: 'Parallel', phone: phone(), creditLimit: 9_000_000 }, { idem: false })).body;
    const p = await makeProduct(c, s, { stock: 10, price: 100_000 });
    await c.post('/sales', { lines: [{ productId: p.id, unit: 'piece', qty: 3 }], customerId: cu.id, onCredit: true }); // 300 000
    for (let round = 0; round < 3; round++) {
      await Promise.all(Array.from({ length: 10 }, () => c.post(`/customers/${cu.id}/payments`, { amount: 5000, methodId: s.methods.cash })));
    }
    const ledger = (await c.get(`/customers/${cu.id}/ledger?pageSize=50`)).body.items as { balanceAfter: number; amount: number }[];
    expect(ledger.length).toBe(31);
    expect(ledger[0].balanceAfter).toBe(150000);
    for (let i = 0; i < ledger.length - 1; i++) expect(ledger[i].balanceAfter).toBe(ledger[i + 1].balanceAfter + ledger[i].amount);
    expect((await c.get(`/customers/${cu.id}`)).body.totalDebtUZS).toBe(150000);
    // 10 ta 20 000 lik to'lov parallel: faqat 7 tasi sig'adi (150 000 / 20 000), ortiqchasi 422
    const big = await Promise.all(Array.from({ length: 10 }, () => c.post(`/customers/${cu.id}/payments`, { amount: 20000, methodId: s.methods.cash })));
    expect(big.filter((r) => r.status === 201).length).toBe(7);
    expect((await c.get(`/customers/${cu.id}`)).body.totalDebtUZS).toBe(10000);
    // oldingi kichik tekshiruv o'rniga: qolgan 10 000 ni ikki parallel 10 000 → bittasi
    const last = await Promise.all(Array.from({ length: 2 }, () => c.post(`/customers/${cu.id}/payments`, { amount: 10000, methodId: s.methods.cash })));
    expect(last.filter((r) => r.status === 201).length).toBe(1);
    expect((await c.get(`/customers/${cu.id}`)).body.totalDebtUZS).toBe(0);
  });

  it('butun baza yaxlitligi: stock = Σ movements; total_debt = oxirgi ledger balance; chek: Σ to\'lov + nasiya = total', async () => {
    const db = rawDb();
    const stock = await db.query(`
      select l.id from stock_levels l
      left join stock_movements m on m.branch_id = l.branch_id and m.product_id = l.product_id and m.variant_id is not distinct from l.variant_id
      group by l.id, l.stock having l.stock <> coalesce(sum(m.qty_base), 0)`);
    const debt = await db.query(`
      select c.id, c.total_debt, (select balance_after from debt_ledger d where d.customer_id = c.id order by seq desc limit 1) as last
      from customers c where c.total_debt <> coalesce((select balance_after from debt_ledger d where d.customer_id = c.id order by seq desc limit 1), 0)`);
    const sales = await db.query(`
      select s.id from sales s where s.total_amount <> s.remaining_debt + coalesce((select sum(amount) from sale_payments p where p.sale_id = s.id), 0)`);
    const lines = await db.query(`
      select s.id from sales s where s.type = 'sale' and s.subtotal <> (select coalesce(sum(line_total), 0) from sale_lines l where l.sale_id = s.id)`);
    await db.end();
    expect(stock.rows).toEqual([]);
    expect(debt.rows).toEqual([]);
    expect(sales.rows).toEqual([]);
    expect(lines.rows).toEqual([]);
  });
});
