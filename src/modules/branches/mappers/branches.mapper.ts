import type { BranchRow } from '../repositories/branches.repository.js';

type SalesAgg = { branchId: string; salesToday: number; receiptsToday: number; sales30: number };
type StockAgg = { branchId: string; items: number; value: number };
type OpenShift = { branchId: string; openedByName: string; openedAt: Date };
type StaffAgg = { branchId: string; n: number };

/** Bosh admin sahifasidagi bitta filial qatori; `stockValue` faqat `view_cost_price` bilan. */
export type BranchOverviewItem = BranchRow & {
  salesToday: number;
  receiptsToday: number;
  sales30: number;
  stockItems: number;
  stockValue: number | undefined;
  shift: { open: true; openedByName: string; openedAt: Date } | { open: false };
  staff: number;
};

const by = <T extends { branchId: string }>(rows: T[]) => new Map(rows.map((r) => [r.branchId, r]));

/** GROUP BY qatorlarini filiallarga yoyadi va umumiy jamlarni hisoblaydi (TZ 9.0). */
export function toBranchOverview(list: BranchRow[], salesAgg: SalesAgg[], stockAgg: StockAgg[], openShifts: OpenShift[], staff: StaffAgg[], withCost: boolean) {
  const s = by(salesAgg);
  const st = by(stockAgg);
  const sh = by(openShifts);
  const su = by(staff);
  const items: BranchOverviewItem[] = list.map((b) => ({
    ...b,
    salesToday: s.get(b.id)?.salesToday ?? 0,
    receiptsToday: s.get(b.id)?.receiptsToday ?? 0,
    sales30: s.get(b.id)?.sales30 ?? 0,
    stockItems: st.get(b.id)?.items ?? 0,
    stockValue: withCost ? (st.get(b.id)?.value ?? 0) : undefined,
    shift: sh.get(b.id) ? { open: true, openedByName: sh.get(b.id)!.openedByName, openedAt: sh.get(b.id)!.openedAt } : { open: false },
    staff: su.get(b.id)?.n ?? 0,
  }));
  return {
    items,
    totals: {
      salesToday: items.reduce((a, b) => a + b.salesToday, 0),
      sales30: items.reduce((a, b) => a + b.sales30, 0),
      stockValue: withCost ? items.reduce((a, b) => a + (b.stockValue ?? 0), 0) : undefined,
      activeBranches: items.filter((b) => b.active).length,
      branches: items.length,
    },
  };
}
