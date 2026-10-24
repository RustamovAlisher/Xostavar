import { roundTo } from './numbers.js';

/**
 * Birlik, narx va kesim hisobi (TZ 8.1, 8.2). Frontend `src/store.ts` `calcLine` va `lib/units.ts` bilan
 * bir xil kirishda bir xil natija beradi — golden-test shu faylga yoziladi.
 */

export interface Conv {
  unit: string;
  factor: number;
  price?: number | null;
}
export interface PriceTarget {
  baseUnit: string;
  isDivisible: boolean;
  /** Umumiy narx (variant yoki mahsulot), filial narxi bo'lsa chaqiruvchi almashtiradi. */
  retailPrice: number;
  /** Ota konversiyalari. */
  conversions: Conv[];
  /** Variant konversiyalari (otadagini ustidan yozadi). */
  variantConversions?: Conv[];
}
export interface Cut {
  lengthMeters: number;
  quantity: number;
}
export interface Rules {
  cutDeductionMode: 'net' | 'bars';
  pieceLengthMeters: number;
}

/** Ota va variant konversiyalarini birlashtiradi (variantdagisi ustun), asosiy birlik chiqarib tashlanadi. */
export function conversionsOf(t: PriceTarget): Conv[] {
  const map = new Map<string, Conv>();
  for (const c of t.conversions) if (c.unit !== t.baseUnit && c.factor > 0) map.set(c.unit, c);
  for (const c of t.variantConversions ?? []) if (c.unit !== t.baseUnit && c.factor > 0) map.set(c.unit, { ...map.get(c.unit), ...c });
  return [...map.values()];
}

/** 1 `unit` necha asosiy birlik. Asosiy birlik → 1. Topilmasa null. */
export function factorOf(t: PriceTarget, unit: string): number | null {
  if (unit === t.baseUnit) return 1;
  return conversionsOf(t).find((c) => c.unit === unit)?.factor ?? null;
}

/** Tanlangan birlik narxi (butun so'm): asosiy → retailPrice; boshqa → konversiya narxi yoki retail × factor. */
export function priceOf(t: PriceTarget, unit: string): number {
  if (unit === t.baseUnit) return Math.round(t.retailPrice);
  const c = conversionsOf(t).find((x) => x.unit === unit);
  if (!c) return 0;
  return Math.round(c.price && c.price > 0 ? c.price : t.retailPrice * c.factor);
}

export function sellableUnits(t: PriceTarget): string[] {
  return [t.baseUnit, ...conversionsOf(t).map((c) => c.unit)].filter((u) => priceOf(t, u) > 0);
}

export function pieceLengthOf(t: PriceTarget): number | null {
  if (t.baseUnit !== 'meter') return null;
  return conversionsOf(t).find((c) => c.unit === 'piece')?.factor ?? null;
}

export interface LineCalc {
  unit: string;
  qty: number;
  baseQty: number;
  unitPrice: number;
  lineTotal: number;
  cuts?: Cut[];
}

/**
 * Qator hisobi: miqdor, ombordan ayriladigan asosiy miqdor, narx, summa.
 * - bo'linmas tovar boshqa birlikda: ombordan butun dona ayriladi, miqdor shunga moslanadi;
 * - kesim (faqat meter/meter): mijoz sof metr uchun to'laydi, ombordan `net` yoki butun tayoqlar (`bars`).
 */
export function calcLine(t: PriceTarget, unit: string, qty: number, cuts: Cut[] | undefined, rules: Rules, unitPrecision: number): LineCalc {
  const factor = factorOf(t, unit) ?? 1;
  const unitPrice = priceOf(t, unit);
  const hasCuts = !!cuts?.length && unit === 'meter' && t.baseUnit === 'meter';
  const prec = unit === t.baseUnit && !t.isDivisible ? 0 : unitPrecision;
  let q = roundTo(Math.max(0, Number.isFinite(qty) ? qty : 0), prec);
  let baseQty = q * factor;

  if (!hasCuts && !t.isDivisible && unit !== t.baseUnit && q > 0) {
    const whole = Math.max(1, Math.round(baseQty));
    if (Math.abs(whole - baseQty) > 1e-9) {
      baseQty = whole;
      q = roundTo(whole / factor, 4);
    }
  }
  if (hasCuts) {
    const net = cuts!.reduce((a, c) => a + (Number(c.lengthMeters) || 0) * (Number(c.quantity) || 0), 0);
    q = roundTo(net, 2);
    baseQty = q;
    if (rules.cutDeductionMode === 'bars') {
      const bar = pieceLengthOf(t) ?? rules.pieceLengthMeters;
      const pieces: number[] = [];
      for (const c of cuts!) for (let i = 0; i < (Number(c.quantity) || 0); i++) pieces.push(Number(c.lengthMeters) || 0);
      pieces.sort((a, b) => b - a);
      const bars: number[] = [];
      let extraBars = 0;
      for (const len of pieces) {
        if (len > bar) {
          const whole = Math.floor(len / bar);
          const rest = roundTo(len - whole * bar, 4);
          extraBars += whole;
          if (rest <= 0) continue;
          const idx = bars.findIndex((r) => r >= rest);
          if (idx >= 0) bars[idx] -= rest;
          else bars.push(bar - rest);
          continue;
        }
        const idx = bars.findIndex((rest) => rest >= len);
        if (idx >= 0) bars[idx] -= len;
        else bars.push(bar - len);
      }
      baseQty = (bars.length + extraBars) * bar;
    }
  }
  return { unit, qty: q, baseQty: roundTo(baseQty, 4), unitPrice, lineTotal: Math.round(unitPrice * q), cuts: hasCuts ? cuts : undefined };
}

/** QQS narxga kiritilgan (TZ 8.4): faqat ko'rsatish uchun. */
export const vatIncluded = (total: number, vatPct: number) => (vatPct > 0 ? roundTo((total * vatPct) / (100 + vatPct), 2) : 0);

/** O'rtacha tannarx (TZ 8.6). costPerBase = 0 bo'lsa eski qoladi. */
export function averageCost(oldStock: number, oldCost: number | null, addQty: number, costPerBase: number): number | null {
  if (!(costPerBase > 0)) return oldCost;
  const s = Math.max(0, oldStock);
  if (oldCost == null || s <= 0) return roundTo(costPerBase, 2);
  return roundTo((s * oldCost + addQty * costPerBase) / (s + addQty), 2);
}
