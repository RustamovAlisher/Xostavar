import { describe, expect, it } from 'vitest';
import { averageCost, calcLine, conversionsOf, factorOf, priceOf, sellableUnits, vatIncluded, type PriceTarget } from './pricing.js';

/** Armatura Ø12 (TZ 21, Ilova B): asosiy birlik metr, 12 500 so'm/m, 1 kg = 1.1261 m, 1 tayoq = 11.7 m. */
const arm: PriceTarget = {
  baseUnit: 'meter',
  isDivisible: true,
  retailPrice: 12500,
  conversions: [{ unit: 'piece', factor: 11.7 }],
  variantConversions: [{ unit: 'kg', factor: 1.1261 }],
};
/** Sement: qop, bo'linmas, 65 000/qop; 1 kg = 0.02 qop, kg narxi alohida 1 400. */
const cement: PriceTarget = { baseUnit: 'bag', isDivisible: false, retailPrice: 65000, conversions: [{ unit: 'kg', factor: 0.02, price: 1400 }] };
/** Tunuka list: dona, bo'linmas, 925 000; 1 kg = 0.02 dona (50 kg list), kg narxi yo'q. */
const sheet: PriceTarget = { baseUnit: 'piece', isDivisible: false, retailPrice: 925000, conversions: [{ unit: 'kg', factor: 0.02 }] };
const rules = { cutDeductionMode: 'net' as const, pieceLengthMeters: 11.7 };

describe('konversiyalar va narx (TZ 8.1)', () => {
  it('variant konversiyasi otadagini ustidan yozadi, asosiy birlik ro\'yxatga kirmaydi', () => {
    const t: PriceTarget = { ...arm, conversions: [{ unit: 'piece', factor: 11.7 }, { unit: 'kg', factor: 1 }, { unit: 'meter', factor: 5 }] };
    expect(conversionsOf(t).map((c) => [c.unit, c.factor])).toEqual([['piece', 11.7], ['kg', 1.1261]]);
  });
  it('factorOf: asosiy → 1, konversiya → factor, noma\'lum → null', () => {
    expect(factorOf(arm, 'meter')).toBe(1);
    expect(factorOf(arm, 'piece')).toBe(11.7);
    expect(factorOf(arm, 'kg')).toBe(1.1261);
    expect(factorOf(arm, 'box')).toBeNull();
  });
  it('priceOf: retail × factor yaxlitlanadi; alohida narx ustun; noma\'lum birlik 0', () => {
    expect(priceOf(arm, 'meter')).toBe(12500);
    expect(priceOf(arm, 'piece')).toBe(146250);
    expect(priceOf(arm, 'kg')).toBe(14076); // 12500 × 1.1261 = 14076.25
    expect(priceOf(cement, 'kg')).toBe(1400);
    expect(priceOf(cement, 'box')).toBe(0);
  });
  it('sellableUnits: narxi > 0 bo\'lganlar; narxsiz mahsulot sotilmaydi', () => {
    expect(sellableUnits(arm)).toEqual(['meter', 'piece', 'kg']);
    expect(sellableUnits({ ...arm, retailPrice: 0 })).toEqual([]);
    expect(sellableUnits({ ...cement, retailPrice: 0 })).toEqual(['kg']); // kg uchun alohida narx bor
  });
});

describe('calcLine (frontend calcLine bilan bir xil natija)', () => {
  it('TZ 21: 1 tayoq → 11.7 m, 146 250 so\'m', () => {
    expect(calcLine(arm, 'piece', 1, undefined, rules, 0)).toMatchObject({ qty: 1, baseQty: 11.7, unitPrice: 146250, lineTotal: 146250 });
  });
  it('TZ 21: 10 kg → 11.261 m, 14 076/kg, 140 760', () => {
    expect(calcLine(arm, 'kg', 10, undefined, rules, 3)).toMatchObject({ qty: 10, baseQty: 11.261, unitPrice: 14076, lineTotal: 140760 });
  });
  it('miqdor birlik aniqligiga yaxlitlanadi; manfiy va NaN → 0', () => {
    expect(calcLine(arm, 'meter', 2.567, undefined, rules, 2).qty).toBe(2.57);
    expect(calcLine(arm, 'kg', 1.23456, undefined, rules, 3).qty).toBe(1.235);
    expect(calcLine(arm, 'meter', -5, undefined, rules, 2).qty).toBe(0);
    expect(calcLine(arm, 'meter', NaN, undefined, rules, 2).lineTotal).toBe(0);
  });
  it('bo\'linmas tovar asosiy birlikda butun songa yaxlitlanadi', () => {
    expect(calcLine(cement, 'bag', 2.7, undefined, rules, 0).qty).toBe(3);
  });
  it('bo\'linmas tovar boshqa birlikda: ombordan butun dona ayriladi, miqdor moslanadi (10 kg list → 1 dona = 50 kg)', () => {
    const r = calcLine(sheet, 'kg', 10, undefined, rules, 3);
    expect(r.baseQty).toBe(1);
    expect(r.qty).toBe(50);
    expect(r.lineTotal).toBe(Math.round(priceOf(sheet, 'kg') * 50));
    // 120 kg → 2.4 dona → 2 dona = 100 kg
    expect(calcLine(sheet, 'kg', 120, undefined, rules, 3)).toMatchObject({ baseQty: 2, qty: 100 });
    // Butun karra bo'lsa o'zgarmaydi: 100 kg = 2 dona
    expect(calcLine(sheet, 'kg', 100, undefined, rules, 3)).toMatchObject({ baseQty: 2, qty: 100 });
  });
  it('yaxlitlash faqat qator darajasida: lineTotal = round(unitPrice × qty)', () => {
    const r = calcLine(arm, 'kg', 0.333, undefined, rules, 3);
    expect(r.lineTotal).toBe(Math.round(14076 * 0.333));
  });
});

describe('kesim (TZ 8.2)', () => {
  const cuts = [{ lengthMeters: 6, quantity: 2 }, { lengthMeters: 3.5, quantity: 1 }];
  it('net: mijoz sof metr uchun to\'laydi, ombordan sof metr ayriladi', () => {
    const r = calcLine(arm, 'meter', 999, cuts, rules, 2);
    expect(r.qty).toBe(15.5);
    expect(r.baseQty).toBe(15.5);
    expect(r.lineTotal).toBe(12500 * 15.5);
    expect(r.cuts).toBe(cuts);
  });
  it('bars: birinchi-sig\'adigan usul — 6+6+3.5 → 2 tayoq (23.4 m), narx sof metr uchun', () => {
    const r = calcLine(arm, 'meter', 0, cuts, { ...rules, cutDeductionMode: 'bars' }, 2);
    expect(r.qty).toBe(15.5);
    expect(r.baseQty).toBe(23.4);
    expect(r.lineTotal).toBe(12500 * 15.5);
  });
  it('bars: 3 × 6 m → 3 tayoq (11.7 m tayoqqa ikkita 6 m sig\'maydi)', () => {
    const r = calcLine(arm, 'meter', 0, [{ lengthMeters: 6, quantity: 3 }], { ...rules, cutDeductionMode: 'bars' }, 2);
    expect(r.baseQty).toBe(35.1);
    expect(r.qty).toBe(18);
  });
  it('bars: 2 × 5 m bitta tayoqqa sig\'adi → 1 tayoq', () => {
    expect(calcLine(arm, 'meter', 0, [{ lengthMeters: 5, quantity: 2 }], { ...rules, cutDeductionMode: 'bars' }, 2).baseQty).toBe(11.7);
  });
  it('bars: tayoqdan uzun bo\'lak (15 m) → 1 butun tayoq + 3.3 m bo\'lak', () => {
    const r = calcLine(arm, 'meter', 0, [{ lengthMeters: 15, quantity: 1 }, { lengthMeters: 6, quantity: 1 }], { ...rules, cutDeductionMode: 'bars' }, 2);
    // 15 = 11.7 + 3.3; 6 va 3.3 bitta tayoqqa sig'adi → jami 2 tayoq
    expect(r.baseQty).toBe(23.4);
    expect(r.qty).toBe(21);
  });
  it('bars: tayoq uzunligi mahsulotda bo\'lmasa qoidadan olinadi', () => {
    const t: PriceTarget = { ...arm, conversions: [] };
    const r = calcLine(t, 'meter', 0, [{ lengthMeters: 5, quantity: 1 }], { cutDeductionMode: 'bars', pieceLengthMeters: 6 }, 2);
    expect(r.baseQty).toBe(6);
  });
  it('kesim faqat meter/meter: boshqa birlikda yoki metrsiz mahsulotda e\'tiborsiz', () => {
    expect(calcLine(arm, 'piece', 2, cuts, rules, 0)).toMatchObject({ qty: 2, baseQty: 23.4, cuts: undefined });
    expect(calcLine(cement, 'bag', 1, cuts, rules, 0)).toMatchObject({ qty: 1, baseQty: 1, cuts: undefined });
  });
});

describe('QQS va o\'rtacha tannarx', () => {
  it('QQS narxga kiritilgan: 480 000 × 12 / 112', () => {
    expect(vatIncluded(480000, 12)).toBe(51428.57);
    expect(vatIncluded(480000, 0)).toBe(0);
  });
  it('averageCost (TZ 8.6): og\'irlikli o\'rtacha; 0 tannarx eski qiymatni saqlaydi; qoldiq 0 → yangi tannarx', () => {
    expect(averageCost(1170, 11965.81, 585, 14017.09)).toBe(12649.57);
    expect(averageCost(100, 5000, 50, 0)).toBe(5000);
    expect(averageCost(0, 5000, 50, 7000)).toBe(7000);
    expect(averageCost(-3, 5000, 50, 7000)).toBe(7000); // manfiy qoldiq 0 deb olinadi
    expect(averageCost(10, null, 5, 100)).toBe(100);
    expect(averageCost(10, null, 5, 0)).toBeNull();
  });
});
