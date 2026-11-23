import { allocateCredits } from './supplier-allocation.js';

describe('allocateCredits (FIFO)', () => {
  const items = [
    { key: 'b', at: '2026-02-01', amount: 500 },
    { key: 'a', at: '2026-01-01', amount: 300 },
    { key: 'c', at: '2026-03-01', amount: 200 },
  ];

  it("to'lov eng eski qarzdan yopadi", () => {
    const r = allocateCredits(items, 400);
    expect(r.get('a')).toEqual({ settled: 300, left: 0 });
    expect(r.get('b')).toEqual({ settled: 100, left: 400 });
    expect(r.get('c')).toEqual({ settled: 0, left: 200 });
  });

  it("to'lov yo'q — hammasi qolgan; to'lov ortiqcha — hammasi yopiq", () => {
    const none = allocateCredits(items, 0);
    expect([none.get('a')?.left, none.get('b')?.left, none.get('c')?.left]).toEqual([300, 500, 200]);
    expect([...allocateCredits(items, 5000).values()].every((x) => x.left === 0)).toBe(true);
  });

  it("sana teng bo'lsa berilgan tartib saqlanadi; manfiy/0 summalar e'tiborsiz", () => {
    const r = allocateCredits([{ key: 'x', at: '2026-01-01', amount: 100 }, { key: 'y', at: '2026-01-01', amount: 100 }, { key: 'z', at: '2026-01-02', amount: -5 }], 150);
    expect(r.get('x')?.left).toBe(0);
    expect(r.get('y')?.left).toBe(50);
    expect(r.get('z')).toEqual({ settled: 0, left: 0 });
  });
});
