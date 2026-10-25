import type { PriceTarget } from '../../../common/utils/pricing.js';
import type { AuditLogRow, ConversionRow, LevelKey, LockedLevelRow, ProductRow, StockLevelRow, StockReceiptLineRow, StockReceiptRow, VariantRow } from '../repositories/inventory.repository.js';

/** Tranzaksiya ichida qulflangan qoldiq; `applyMovement` dan keyin `stock`/`costPrice` joyida yangilanadi. */
export interface LockedLevel {
  id: string;
  stock: number;
  costPrice: number | null;
  minStock: number | null;
}

/** Narx/birlik hisobi uchun mahsulot + variant + konversiyalar. */
export interface Target {
  product: ProductRow;
  variant: VariantRow | null;
  target: PriceTarget;
}

/** (product, variant) juftligi kaliti — xaritalarda hamma joyda shu. */
export const levelKey = (k: { productId: string; variantId?: string | null }) => `${k.productId}|${k.variantId ?? ''}`;

/** Mahsulot nomi variant bilan: "Mahsulot — Variant". */
export const displayName = (product: ProductRow, variant: VariantRow | null) => (variant ? `${product.name} — ${variant.name}` : product.name);

export const toLockedLevel = (row: LockedLevelRow): LockedLevel => ({ id: row.id, stock: Number(row.stock), costPrice: row.costPrice != null ? Number(row.costPrice) : null, minStock: row.minStock != null ? Number(row.minStock) : null });

/** Batch qatorlardan kalit → Target xaritasi; o'chirilgan/topilmagan mahsulot yoki variant tashlab ketiladi. */
export function toTargets(keys: LevelKey[], ps: ProductRow[], vs: VariantRow[], cs: ConversionRow[]): Map<string, Target> {
  const out = new Map<string, Target>();
  for (const k of keys) {
    const product = ps.find((p) => p.id === k.productId);
    if (!product) continue;
    const variant = k.variantId ? (vs.find((v) => v.id === k.variantId && v.productId === product.id) ?? null) : null;
    if (k.variantId && !variant) continue;
    const conv = (vid: string | null) => cs.filter((c) => c.productId === product.id && (vid ? c.variantId === vid : !c.variantId)).map((c) => ({ unit: c.unit, factor: c.factor, price: c.price }));
    out.set(levelKey(k), {
      product, variant,
      target: { baseUnit: product.baseUnit, isDivisible: product.isDivisible, retailPrice: variant ? variant.retailPrice : product.retailPrice, conversions: conv(null), variantConversions: variant ? conv(variant.id) : undefined },
    });
  }
  return out;
}

export const toReceiptView = (r: StockReceiptRow, lines: StockReceiptLineRow[]) => ({ ...r, lines });

/** Ro'yxat: har hujjatga o'z qatorlari (bitta batch so'rovdan filtrlab). */
export const toReceiptList = (items: StockReceiptRow[], lines: StockReceiptLineRow[]) => items.map((r) => toReceiptView(r, lines.filter((l) => l.receiptId === r.id)));

/** PATCH /stock-levels javobi: numeric ustunlar son sifatida. */
export const toLevelView = (row: StockLevelRow) => ({ ...row, stock: Number(row.stock), minStock: row.minStock != null ? Number(row.minStock) : null, costPrice: row.costPrice != null ? Number(row.costPrice) : null });

type LevelAcrossRow = { branchId: string; branch: string; variantId: string | null; stock: number; minStock: number | null; costPrice: number | null; id: string };
/** Filiallar bo'yicha qoldiq; tannarx faqat `withCost` (view_cost_price) bo'lsa. */
export const toLevelsAcrossBranches = (rows: LevelAcrossRow[], withCost: boolean) => rows.map((r) => ({ ...r, stock: Number(r.stock), minStock: r.minStock != null ? Number(r.minStock) : null, costPrice: withCost && r.costPrice != null ? Number(r.costPrice) : undefined }));

/** Mahsulot tarixi (TZ 9.4): kirim qatorlari tekis ko'rinishda (tannarx faqat `withCost`) + audit. */
export function toProductHistory(receipts: { line: StockReceiptLineRow; receipt: StockReceiptRow }[], logs: AuditLogRow[], withCost: boolean) {
  return {
    receipts: receipts.map(({ line, receipt }) => ({
      id: line.id, receiptId: receipt.id, number: receipt.number, branchId: receipt.branchId, date: receipt.date, createdAt: receipt.createdAt,
      productName: line.productName, sku: line.sku, variantId: line.variantId, unit: line.unit, qty: Number(line.qty), qtyBase: Number(line.qtyBase),
      costPerUnit: withCost ? Number(line.costPerUnit) : undefined, totalCost: withCost ? Number(line.totalCost) : undefined,
      supplier: receipt.supplierName, invoice: receipt.invoice, userName: receipt.userName,
    })),
    logs,
  };
}
