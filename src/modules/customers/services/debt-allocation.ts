/**
 * Qarzni savdolar bo'yicha taqsimlash (sof funksiya, bazaga tegmaydi).
 *
 * Manba — `debt_ledger` (mijoz qarzining yagona haqiqati). Yozuvlar `seq` tartibida qayta o'ynaladi:
 *  - `sale_debt` (+)      → shu savdo uchun qarz bandi ochiladi;
 *  - `adjustment` (+)     → savdosiz qarz bandi (qo'lda tuzatish);
 *  - `payment` (−)        → avval to'lov ko'rsatgan savdoga (`debt_sale_id`), ortig'i eng eski qarzga (FIFO);
 *  - `sale_void` (−)      → avval bekor qilingan savdoning o'ziga, ortig'i FIFO;
 *  - `adjustment` (−)     → FIFO.
 * Natija: har bandning boshlang'ich qarzi, kim/qachon qancha yopgani va qoldig'i. Qoldiqlar yig'indisi doim
 * `customers.total_debt` ga teng (ledger manfiy summalari qarzdan oshmaydi — applyDebt kafolatlaydi).
 * Ma'lumot ko'chirish (backfill) kerak emas: eski to'lovlar avtomatik FIFO bo'yicha taqsimlanadi.
 */

export interface LedgerEvent {
  id: string;
  seq: number;
  type: 'sale_debt' | 'payment' | 'adjustment' | 'sale_void';
  amount: number;
  refId: string | null;
  createdAt: Date;
}

export interface Allocation {
  /** To'lov cheki id (payment), bekor qilingan chek id (sale_void) yoki ledger id (adjustment). */
  sourceId: string;
  kind: 'payment' | 'void' | 'adjustment';
  amount: number;
  at: Date;
}

export interface DebtItem {
  /** Savdo id yoki `adj:<ledgerId>` (savdosiz tuzatish). */
  key: string;
  saleId: string | null;
  original: number;
  outstanding: number;
  at: Date;
  allocations: Allocation[];
}

export interface AllocationResult {
  items: DebtItem[];
  /** sourceId → qaysi bandlarga qancha ketgan. */
  bySource: Map<string, { key: string; saleId: string | null; amount: number }[]>;
}

export function allocateDebt(events: readonly LedgerEvent[], targetOf: (paymentSaleId: string) => string | null | undefined): AllocationResult {
  const items: DebtItem[] = [];
  const byKey = new Map<string, DebtItem>();
  const bySource = new Map<string, { key: string; saleId: string | null; amount: number }[]>();

  const take = (item: DebtItem, want: number, src: Omit<Allocation, 'amount'>) => {
    const a = Math.min(item.outstanding, want);
    if (a <= 0) return 0;
    item.outstanding -= a;
    item.allocations.push({ ...src, amount: a });
    const list = bySource.get(src.sourceId) ?? [];
    list.push({ key: item.key, saleId: item.saleId, amount: a });
    bySource.set(src.sourceId, list);
    return a;
  };

  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.amount > 0) {
      const key = e.type === 'sale_debt' && e.refId ? e.refId : `adj:${e.id}`;
      const existing = byKey.get(key);
      if (existing) { existing.original += e.amount; existing.outstanding += e.amount; continue; }
      const item: DebtItem = { key, saleId: e.type === 'sale_debt' ? e.refId : null, original: e.amount, outstanding: e.amount, at: e.createdAt, allocations: [] };
      items.push(item);
      byKey.set(key, item);
      continue;
    }
    let left = -e.amount;
    const kind: Allocation['kind'] = e.type === 'payment' ? 'payment' : e.type === 'sale_void' ? 'void' : 'adjustment';
    const sourceId = (e.type === 'adjustment' ? e.id : e.refId) ?? e.id;
    const src = { sourceId, kind, at: e.createdAt };
    const target = e.type === 'payment' && e.refId ? targetOf(e.refId) : e.type === 'sale_void' ? e.refId : null;
    if (target) { const t = byKey.get(target); if (t) left -= take(t, left, src); }
    for (const it of items) {
      if (left <= 0) break;
      left -= take(it, left, src);
    }
  }
  return { items, bySource };
}
