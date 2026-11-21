import { describe, expect, it } from 'vitest';
import { allocateDebt, type LedgerEvent } from './debt-allocation.js';

let seq = 0;
const ev = (type: LedgerEvent['type'], amount: number, refId: string | null): LedgerEvent => ({ id: `l${++seq}`, seq, type, amount, refId, createdAt: new Date(2026, 0, seq) });
const left = (r: ReturnType<typeof allocateDebt>) => Object.fromEntries(r.items.map((i) => [i.key, i.outstanding]));

describe('allocateDebt', () => {
  it('umumiy to\'lov FIFO: eng eski qarz birinchi yopiladi', () => {
    const r = allocateDebt([ev('sale_debt', 100, 'A'), ev('sale_debt', 50, 'B'), ev('payment', -120, 'P1')], () => null);
    expect(left(r)).toEqual({ A: 0, B: 30 });
    expect(r.bySource.get('P1')).toEqual([{ key: 'A', saleId: 'A', amount: 100 }, { key: 'B', saleId: 'B', amount: 20 }]);
  });
  it('savdoga bog\'langan to\'lov avval shu savdoni yopadi', () => {
    const r = allocateDebt([ev('sale_debt', 100, 'A'), ev('sale_debt', 50, 'B'), ev('payment', -50, 'P1')], (p) => (p === 'P1' ? 'B' : null));
    expect(left(r)).toEqual({ A: 100, B: 0 });
  });
  it('bog\'langan to\'lov ortig\'i FIFO ga o\'tadi', () => {
    const r = allocateDebt([ev('sale_debt', 100, 'A'), ev('sale_debt', 50, 'B'), ev('payment', -70, 'P1')], () => 'B');
    expect(left(r)).toEqual({ A: 80, B: 0 });
  });
  it('storno avval o\'z savdosini, ortig\'i boshqasini kamaytiradi; jami ledger bilan mos', () => {
    const events = [ev('sale_debt', 100, 'A'), ev('sale_debt', 50, 'B'), ev('payment', -80, 'P1'), ev('sale_void', -70, 'A')];
    const r = allocateDebt(events, () => null);
    expect(left(r)).toEqual({ A: 0, B: 0 });
    const total = events.reduce((a, e) => a + e.amount, 0);
    expect(r.items.reduce((a, i) => a + i.outstanding, 0)).toBe(total);
  });
  it('qo\'lda tuzatish: + savdosiz band, − FIFO', () => {
    const r = allocateDebt([ev('adjustment', 40, null), ev('sale_debt', 60, 'A'), ev('adjustment', -50, null)], () => null);
    expect(r.items.map((i) => [i.saleId, i.outstanding])).toEqual([[null, 0], ['A', 50]]);
  });
});
