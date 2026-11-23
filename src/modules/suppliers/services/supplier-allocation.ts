/**
 * To'lovlarni qarz yozuvlari bo'yicha taqsimlash: eng eski qarz birinchi yopiladi (FIFO).
 * `items` — qarz yozuvlari (kirimdan qolgan qarz, qo'lda qo'shilgan eski qarz); `credits` — jami to'langan summa.
 */
export interface DebtItem {
  key: string;
  /** Sana (YYYY-MM-DD): eskisi birinchi. Teng bo'lsa — berilgan tartib. */
  at: string;
  amount: number;
}

export interface Allocated {
  /** Shu qarzdan yopilgan summa. */
  settled: number;
  /** Qolgan qarz. */
  left: number;
}

export function allocateCredits(items: DebtItem[], credits: number): Map<string, Allocated> {
  const order = items.map((it, i) => ({ it, i })).sort((a, b) => (a.it.at < b.it.at ? -1 : a.it.at > b.it.at ? 1 : a.i - b.i));
  let pool = Math.max(0, credits);
  const out = new Map<string, Allocated>();
  for (const { it } of order) {
    const amount = Math.max(0, it.amount);
    const settled = Math.min(pool, amount);
    pool -= settled;
    out.set(it.key, { settled, left: amount - settled });
  }
  return out;
}
