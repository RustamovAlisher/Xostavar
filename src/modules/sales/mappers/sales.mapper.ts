import type { LineCalc } from '../../../common/utils/pricing.js';
import type { SaleLineRow, SalePaymentRow, SaleRow } from '../repositories/sales.repository.js';

/** Hisoblangan savat qatori (server narxi, qoldiq, tannarx). */
export interface QuotedLine extends LineCalc {
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  sku: string;
  categoryId: string;
  available: number | null;
  costPerBase: number | null;
}

export interface QuoteWarning {
  code: string;
  message: string;
  productId: string;
}

export interface QuoteTotals {
  lines: QuotedLine[];
  subtotal: number;
  discount: number;
  total: number;
  vat: number;
  profit: number;
}

/** POST /sales/quote javobi: tannarx va foyda faqat `view_cost_price` bilan (TZ 8.7). */
export function toQuoteView(q: QuoteTotals, withCost: boolean, warnings: QuoteWarning[]) {
  return {
    lines: q.lines.map(({ available, costPerBase, ...l }) => ({ ...l, available, ...(withCost ? { costPerBase } : {}) })),
    subtotal: q.subtotal, discountAmount: q.discount, totalAmount: q.total, vatIncluded: q.vat, ...(withCost ? { profit: q.profit } : {}), warnings,
  };
}

/** Chek javobi: numeric → son; foyda va tannarx faqat `view_cost_price` bilan. */
export function toSaleView(s: SaleRow, lines: SaleLineRow[], pays: SalePaymentRow[], withCost: boolean) {
  return {
    ...s, vatIncluded: Number(s.vatIncluded), ...(withCost ? {} : { profit: undefined }),
    lines: lines.map((l) => ({ ...l, qty: Number(l.qty), baseQty: Number(l.baseQty), costPerBase: withCost && l.costPerBase != null ? Number(l.costPerBase) : undefined })),
    payments: pays.map((p) => ({ method: p.methodCode, methodId: p.methodId, kind: p.kind, amount: p.amount, ref: p.ref })),
  };
}

export type SaleView = ReturnType<typeof toSaleView>;

/** Ro'yxat: har chekka o'z qatorlari va to'lovlari biriktiriladi. */
export const toSaleList = (items: SaleRow[], lines: SaleLineRow[], pays: SalePaymentRow[], withCost: boolean) =>
  items.map((s) => toSaleView(s, lines.filter((l) => l.saleId === s.id), pays.filter((p) => p.saleId === s.id), withCost));
