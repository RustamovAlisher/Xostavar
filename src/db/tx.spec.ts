import { describe, expect, it, vi } from 'vitest';
import { runTx } from './tx.js';
import type { Db } from './db.module.js';

const deadlock = () => Object.assign(new Error('Failed query'), { cause: { code: '40P01' } });

describe('runTx — deadlock/serialization qayta urinish', () => {
  it('birinchi urinish muvaffaqiyatli bo\'lsa bir marta chaqiriladi', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const db = { transaction: (f: (tx: unknown) => Promise<unknown>) => f({}) } as unknown as Db;
    expect(await runTx(db, fn)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('deadlock → qayta uriniladi va muvaffaqiyatli natija qaytadi', async () => {
    let n = 0;
    const db = { transaction: async () => { if (++n < 3) throw deadlock(); return 'ok'; } } as unknown as Db;
    expect(await runTx(db, async () => 'x')).toBe('ok');
    expect(n).toBe(3);
  });
  it('urinishlar tugasa oxirgi xato tashlanadi', async () => {
    const db = { transaction: async () => { throw deadlock(); } } as unknown as Db;
    await expect(runTx(db, async () => 'x', 2)).rejects.toThrow('Failed query');
  });
  it('boshqa xatolar qayta urinilmaydi', async () => {
    let n = 0;
    const db = { transaction: async () => { n++; throw Object.assign(new Error('dup'), { cause: { code: '23505' } }); } } as unknown as Db;
    await expect(runTx(db, async () => 'x')).rejects.toThrow('dup');
    expect(n).toBe(1);
  });
});
