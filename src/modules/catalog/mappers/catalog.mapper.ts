import type { BarcodeInsert, BarcodeRow, ConversionInsert, ConversionRow, ProductChildren, ProductRow } from '../repositories/catalog.repository.js';
import type { ProductDto, VariantDto } from '../dto/catalog.dto.js';

/** Frontend `Product` bilan bir xil shakl (TZ 9.4, 14.3). */
export interface ProductView {
  id: string;
  name: string;
  categoryId: string;
  sku: string;
  barcodes: string[];
  description?: string;
  baseUnit: string;
  isDivisible: boolean;
  conversions: { unit: string; factor: number; price?: number; barcode?: string }[];
  retailPrice: number;
  wholesalePrice?: number;
  costPrice?: number;
  stock: number;
  minStock?: number;
  isVariable: boolean;
  variants?: VariantView[];
  /** Joriy filial omborida bormi (stock_levels qatori). */
  inBranch: boolean;
  version: number;
  createdAt: Date;
}
export interface VariantView {
  id: string;
  name: string;
  sku: string;
  barcodes: string[];
  retailPrice: number;
  wholesalePrice?: number;
  costPrice?: number;
  stock: number;
  minStock?: number;
  conversions?: { unit: string; factor: number; price?: number; barcode?: string }[];
}

const key = (p: string, v: string | null) => `${p}|${v ?? ''}`;
const group = <T extends { productId: string }>(list: T[]) => {
  const m = new Map<string, T[]>();
  for (const x of list) m.set(x.productId, [...(m.get(x.productId) ?? []), x]);
  return m;
};
const convView = (list: ConversionRow[], codesFor: BarcodeRow[]) =>
  list.map((c) => {
    const bc = codesFor.find((b) => b.unit === c.unit)?.barcode;
    return { unit: c.unit, factor: c.factor, ...(c.price != null ? { price: c.price } : {}), ...(bc ? { barcode: bc } : {}) };
  });

/**
 * Mahsulot qatorlari + batch yuklangan bolalardan to'liq `ProductView` lar.
 * `withCost` — view_cost_price bo'lmasa ulgurji va tannarx yashiriladi; filial narxi (branch_prices) umumiy narxni ustidan yozadi.
 */
export function toProductViews(rows: ProductRow[], ch: ProductChildren, withCost: boolean): ProductView[] {
  const vByP = group(ch.variants);
  const cByP = group(ch.convs);
  const bByP = group(ch.codes);
  const lvl = new Map(ch.levels.map((l) => [key(l.productId, l.variantId), l]));
  const prc = new Map(ch.prices.map((p) => [key(p.productId, p.variantId), p]));

  return rows.map((p) => {
    const pConvs = (cByP.get(p.id) ?? []).filter((c) => !c.variantId);
    const pCodes = (bByP.get(p.id) ?? []).filter((b) => !b.variantId);
    const l = lvl.get(key(p.id, null));
    const bp = prc.get(key(p.id, null));
    const vs = (vByP.get(p.id) ?? []).map((v): VariantView => {
      const vl = lvl.get(key(p.id, v.id));
      const vp = prc.get(key(p.id, v.id));
      const vConvs = (cByP.get(p.id) ?? []).filter((c) => c.variantId === v.id);
      const vCodes = (bByP.get(p.id) ?? []).filter((b) => b.variantId === v.id);
      return {
        id: v.id, name: v.name, sku: v.sku, barcodes: vCodes.filter((b) => !b.unit).map((b) => b.barcode),
        retailPrice: vp?.retailPrice ?? v.retailPrice,
        ...(withCost ? { wholesalePrice: vp?.wholesalePrice ?? v.wholesalePrice ?? undefined, costPrice: vl?.costPrice != null ? Number(vl.costPrice) : undefined } : {}),
        stock: vl ? Number(vl.stock) : 0, minStock: vl?.minStock != null ? Number(vl.minStock) : undefined,
        conversions: vConvs.length ? convView(vConvs, vCodes) : undefined,
      };
    });
    const inBranch = !!l || vs.some((v) => lvl.has(key(p.id, v.id)));
    return {
      id: p.id, name: p.name, categoryId: p.categoryId, sku: p.sku, barcodes: pCodes.filter((b) => !b.unit).map((b) => b.barcode),
      description: p.description ?? undefined, baseUnit: p.baseUnit, isDivisible: p.isDivisible,
      conversions: convView(pConvs, pCodes), retailPrice: bp?.retailPrice ?? p.retailPrice,
      ...(withCost ? { wholesalePrice: bp?.wholesalePrice ?? p.wholesalePrice ?? undefined, costPrice: l?.costPrice != null ? Number(l.costPrice) : undefined } : {}),
      stock: p.isVariable ? vs.reduce((a, v) => a + v.stock, 0) : l ? Number(l.stock) : 0,
      minStock: l?.minStock != null ? Number(l.minStock) : undefined,
      isVariable: p.isVariable, variants: p.isVariable ? vs : undefined, inBranch, version: p.version, createdAt: p.createdAt,
    };
  });
}

/** DTO dan `products` qatori ustunlari (yaratish va tahrirlashda bir xil). */
export function toProductColumns(dto: ProductDto, sku: string) {
  return {
    name: dto.name.trim(), categoryId: dto.categoryId, sku, description: dto.description?.trim() || null, baseUnit: dto.baseUnit, isDivisible: dto.isDivisible,
    retailPrice: dto.isVariable ? 0 : (dto.retailPrice ?? 0), wholesalePrice: dto.isVariable ? null : (dto.wholesalePrice ?? null), isVariable: dto.isVariable,
  };
}

/** DTO dan `product_variants` qatori ustunlari; `i` — tartib. */
export const toVariantColumns = (v: VariantDto, i: number) => ({ name: v.name.trim(), sku: v.sku!, retailPrice: v.retailPrice, wholesalePrice: v.wholesalePrice ?? null, sortOrder: i });

/** Barcha kodlar (SKU, shtrix-kod, qadoq shtrix-kodi) — unikallik tekshiruvi uchun. */
export function allCodes(sku: string, dto: ProductDto, variants: VariantDto[]) {
  return [sku, ...(dto.barcodes ?? []), ...dto.conversions.map((c) => c.barcode ?? ''), ...variants.flatMap((v) => [v.sku!, ...(v.barcodes ?? []), ...(v.conversions ?? []).map((c) => c.barcode ?? '')])].filter(Boolean);
}

/** Konversiya va shtrix-kod qatorlari (mahsulot + variantlar); `variantIds` — DTO dagi indeks → saqlangan variant id. */
export function toChildRows(productId: string, dto: ProductDto, variants: VariantDto[], variantIds: Map<number, string>) {
  const convRows: ConversionInsert[] = dto.conversions.map((c) => ({ productId, variantId: null, unit: c.unit, factor: c.factor, price: c.price ?? null }));
  const codeRows: BarcodeInsert[] = [
    ...(dto.barcodes ?? []).map((b) => ({ productId, barcode: b.trim() })),
    ...dto.conversions.filter((c) => c.barcode?.trim()).map((c) => ({ productId, unit: c.unit, barcode: c.barcode!.trim() })),
  ];
  for (const [i, v] of variants.entries()) {
    const variantId = variantIds.get(i)!;
    for (const c of v.conversions ?? []) convRows.push({ productId, variantId, unit: c.unit, factor: c.factor, price: c.price ?? null });
    for (const b of v.barcodes ?? []) codeRows.push({ productId, variantId, barcode: b.trim() });
    for (const c of (v.conversions ?? []).filter((c) => c.barcode?.trim())) codeRows.push({ productId, variantId, unit: c.unit, barcode: c.barcode!.trim() });
  }
  return { convRows, codeRows };
}

/** Audit `diff` uchun qisqa ko'rinish. */
export function productSummary(dto: ProductDto, sku: string) {
  return {
    nomi: dto.name, sku, kategoriya: dto.categoryId, asosiyBirlik: dto.baseUnit,
    narx: dto.isVariable ? undefined : dto.retailPrice,
    birliklar: (dto.conversions ?? []).map((c) => `${c.unit}=${c.factor}${c.price ? ` (${c.price})` : ''}`).join(', '),
    variantlar: dto.variants?.map((v) => `${v.name}: ${v.retailPrice}`).join('; '),
  };
}
