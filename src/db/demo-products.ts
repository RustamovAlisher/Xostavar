/**
 * Demo (staging) katalog — real do'kon assortimenti asosida (2026-11 rasmlar): metall prokat, badiiy kovka,
 * setka/panjara, santexnika, elektr, metiz, sement, izolyatsiya, bo'yoq-kimyo, asbob.
 * kg/m qiymatlari GOST sortamentlaridan (armatura 5781, truba 8639/8645/3262, shveller 8240, balka 8239, ugolok 8509).
 * Narxlar taxminiy namuna (so'm, 2026) — haqiqiy narxlar kirim/tahrirlashda kiritiladi.
 * `variants[].kg` — 1 kg necha asosiy birlik (1 / kg-per-base), seed shundan kg konversiyasini yaratadi.
 */
export interface DemoVariant { name: string; sku: string; retailPrice: number; kg?: number }
export interface DemoProduct {
  name: string; category: string; sku: string; baseUnit: string; isDivisible: boolean; retailPrice?: number; barcodes?: string[];
  conversions?: { unit: string; factor: number; price?: number; barcode?: string }[];
  variants?: DemoVariant[];
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;
/** Og'irlikli variant: 1 asosiy birlik = kgPerBase kg; narx asosiy birlik uchun. */
const kgVar = (name: string, sku: string, kgPerBase: number, price: number): DemoVariant => ({ name, sku, retailPrice: price, kg: r4(1 / kgPerBase) });
const v = (name: string, sku: string, retailPrice: number): DemoVariant => ({ name, sku, retailPrice });
/** Metr narxi: kg/m × kg narxi, 100 so'mga yaxlitlangan. */
const perM = (kgPerM: number, kgPrice: number) => Math.round((kgPerM * kgPrice) / 100) * 100;
const STEEL = 12_800; // so'm/kg (qora prokat, namuna)

export const DEMO_PRODUCTS: DemoProduct[] = [
  // ───────── Armatura (metr, 11.7 m tayoq) ─────────
  { name: 'Armatura A500C rifli', category: 'Armatura', sku: 'ARM', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'piece', factor: 11.7 }],
    variants: [
      kgVar('Ø 8 mm A500C', 'ARM-8', 0.395, perM(0.395, STEEL)), kgVar('Ø 10 mm A500C', 'ARM-10', 0.617, perM(0.617, STEEL)),
      kgVar('Ø 12 mm A500C', 'ARM-12', 0.888, perM(0.888, STEEL)), kgVar('Ø 14 mm A500C', 'ARM-14', 1.208, perM(1.208, STEEL)),
      kgVar('Ø 16 mm A500C', 'ARM-16', 1.578, perM(1.578, STEEL)), kgVar('Ø 18 mm A500C', 'ARM-18', 1.998, perM(1.998, STEEL)),
      kgVar('Ø 20 mm A500C', 'ARM-20', 2.466, perM(2.466, STEEL)),
    ] },
  { name: 'Silliq prut (krug)', category: 'Armatura', sku: 'KRUG', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'piece', factor: 6 }],
    variants: [kgVar('Ø 6 mm', 'KRUG-6', 0.222, perM(0.222, STEEL)), kgVar('Ø 8 mm', 'KRUG-8', 0.395, perM(0.395, STEEL)), kgVar('Ø 10 mm', 'KRUG-10', 0.617, perM(0.617, STEEL)), kgVar('Ø 12 mm', 'KRUG-12', 0.888, perM(0.888, STEEL))] },
  { name: 'Armatura xomuti (tayyor, Ø6)', category: 'Armatura', sku: 'XOMUT', baseUnit: 'piece', isDivisible: false,
    variants: [v('15×15 cm', 'XOMUT-15', 1500), v('20×20 cm', 'XOMUT-20', 1800), v('25×25 cm', 'XOMUT-25', 2200)] },

  // ───────── Trubalar (metr, 6 m tayoq) ─────────
  { name: 'Profil truba kvadrat', category: 'Trubalar', sku: 'PTK', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'piece', factor: 6 }],
    variants: [
      kgVar('15×15×1.5 mm', 'PTK-15x15x1.5', 0.605, perM(0.605, STEEL)), kgVar('20×20×1.5 mm', 'PTK-20x20x1.5', 0.841, perM(0.841, STEEL)), kgVar('20×20×2 mm', 'PTK-20x20x2', 1.075, perM(1.075, STEEL)),
      kgVar('25×25×2 mm', 'PTK-25x25x2', 1.39, perM(1.39, STEEL)), kgVar('30×30×2 mm', 'PTK-30x30x2', 1.7, perM(1.7, STEEL)), kgVar('40×40×2 mm', 'PTK-40x40x2', 2.33, perM(2.33, STEEL)),
      kgVar('40×40×3 mm', 'PTK-40x40x3', 3.36, perM(3.36, STEEL)), kgVar('50×50×2 mm', 'PTK-50x50x2', 2.96, perM(2.96, STEEL)), kgVar('50×50×3 mm', 'PTK-50x50x3', 4.31, perM(4.31, STEEL)),
      kgVar('60×60×2 mm', 'PTK-60x60x2', 3.59, perM(3.59, STEEL)), kgVar('60×60×3 mm', 'PTK-60x60x3', 5.25, perM(5.25, STEEL)), kgVar('80×80×3 mm', 'PTK-80x80x3', 7.13, perM(7.13, STEEL)),
      kgVar('100×100×4 mm', 'PTK-100x100x4', 11.84, perM(11.84, STEEL)),
    ] },
  { name: "Profil truba to'rtburchak", category: 'Trubalar', sku: 'PTR', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'piece', factor: 6 }],
    variants: [
      kgVar('40×20×2 mm', 'PTR-40x20x2', 1.69, perM(1.69, STEEL)), kgVar('50×25×2 mm', 'PTR-50x25x2', 2.16, perM(2.16, STEEL)), kgVar('60×30×2 mm', 'PTR-60x30x2', 2.63, perM(2.63, STEEL)),
      kgVar('60×40×2 mm', 'PTR-60x40x2', 2.96, perM(2.96, STEEL)), kgVar('60×40×3 mm', 'PTR-60x40x3', 4.31, perM(4.31, STEEL)), kgVar('80×40×2 mm', 'PTR-80x40x2', 3.59, perM(3.59, STEEL)),
      kgVar('80×40×3 mm', 'PTR-80x40x3', 5.25, perM(5.25, STEEL)), kgVar('100×50×3 mm', 'PTR-100x50x3', 6.67, perM(6.67, STEEL)),
    ] },
  { name: 'Dumaloq truba VGP (GOST 3262)', category: 'Trubalar', sku: 'VGP', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'piece', factor: 6 }],
    variants: [
      kgVar('DN 15 (21.3×2.8)', 'VGP-15', 1.28, perM(1.28, STEEL)), kgVar('DN 20 (26.8×2.8)', 'VGP-20', 1.66, perM(1.66, STEEL)), kgVar('DN 25 (33.5×3.2)', 'VGP-25', 2.39, perM(2.39, STEEL)),
      kgVar('DN 32 (42.3×3.2)', 'VGP-32', 3.09, perM(3.09, STEEL)), kgVar('DN 40 (48×3.5)', 'VGP-40', 3.84, perM(3.84, STEEL)), kgVar('DN 50 (60×3.5)', 'VGP-50', 4.88, perM(4.88, STEEL)),
    ] },
  { name: 'Dumaloq truba elektropayvand', category: 'Trubalar', sku: 'ETR', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'piece', factor: 6 }],
    variants: [kgVar('Ø 57×3 mm', 'ETR-57', 3.99, perM(3.99, STEEL)), kgVar('Ø 76×3 mm', 'ETR-76', 5.4, perM(5.4, STEEL)), kgVar('Ø 89×3.5 mm', 'ETR-89', 7.38, perM(7.38, STEEL)), kgVar('Ø 108×4 mm', 'ETR-108', 10.26, perM(10.26, STEEL))] },

  // ───────── Shveller va balka (metr, 12 m tayoq) ─────────
  { name: 'Shveller (GOST 8240)', category: 'Shveller va balka', sku: 'SHV', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'piece', factor: 12 }],
    variants: [
      kgVar('№5 (50×32)', 'SHV-5', 4.84, perM(4.84, STEEL)), kgVar('№6.5 (65×36)', 'SHV-6.5', 5.9, perM(5.9, STEEL)), kgVar('№8 (80×40)', 'SHV-8', 7.05, perM(7.05, STEEL)),
      kgVar('№10 (100×46)', 'SHV-10', 8.59, perM(8.59, STEEL)), kgVar('№12 (120×52)', 'SHV-12', 10.4, perM(10.4, STEEL)), kgVar('№14 (140×58)', 'SHV-14', 12.3, perM(12.3, STEEL)),
      kgVar('№16 (160×64)', 'SHV-16', 14.2, perM(14.2, STEEL)), kgVar('№18 (180×70)', 'SHV-18', 16.3, perM(16.3, STEEL)), kgVar('№20 (200×76)', 'SHV-20', 18.4, perM(18.4, STEEL)),
    ] },
  { name: 'Balka dvutavr (GOST 8239)', category: 'Shveller va balka', sku: 'BAL', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'piece', factor: 12 }],
    variants: [kgVar('№10', 'BAL-10', 9.46, perM(9.46, STEEL)), kgVar('№12', 'BAL-12', 11.5, perM(11.5, STEEL)), kgVar('№14', 'BAL-14', 13.7, perM(13.7, STEEL)), kgVar('№16', 'BAL-16', 15.9, perM(15.9, STEEL)), kgVar('№18', 'BAL-18', 18.4, perM(18.4, STEEL)), kgVar('№20', 'BAL-20', 21.0, perM(21.0, STEEL))] },

  // ───────── Ugolok va polosa (metr, 6 m tayoq) ─────────
  { name: 'Ugolok teng tomonli (GOST 8509)', category: 'Ugolok va polosa', sku: 'UG', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'piece', factor: 6 }],
    variants: [
      kgVar('25×25×3 mm', 'UG-25x3', 1.12, perM(1.12, STEEL)), kgVar('32×32×3 mm', 'UG-32x3', 1.46, perM(1.46, STEEL)), kgVar('40×40×4 mm', 'UG-40x4', 2.42, perM(2.42, STEEL)),
      kgVar('50×50×5 mm', 'UG-50x5', 3.77, perM(3.77, STEEL)), kgVar('63×63×5 mm', 'UG-63x5', 4.81, perM(4.81, STEEL)), kgVar('75×75×6 mm', 'UG-75x6', 6.89, perM(6.89, STEEL)),
      kgVar('100×100×7 mm', 'UG-100x7', 10.79, perM(10.79, STEEL)),
    ] },
  { name: 'Polosa (yassi po\'lat)', category: 'Ugolok va polosa', sku: 'POL', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'piece', factor: 6 }],
    variants: [kgVar('20×4 mm', 'POL-20x4', 0.63, perM(0.63, STEEL)), kgVar('25×4 mm', 'POL-25x4', 0.785, perM(0.785, STEEL)), kgVar('40×4 mm', 'POL-40x4', 1.26, perM(1.26, STEEL)), kgVar('50×5 mm', 'POL-50x5', 1.96, perM(1.96, STEEL))] },

  // ───────── Listlar (dona 1250×2500; kg = qalinlik × 24.5) ─────────
  { name: 'Qora list 1250×2500', category: 'Listlar', sku: 'LST', baseUnit: 'piece', isDivisible: false,
    variants: [kgVar('1.0 mm', 'LST-1.0', 24.5, 340000), kgVar('1.5 mm', 'LST-1.5', 36.8, 505000), kgVar('2.0 mm', 'LST-2.0', 49.1, 670000), kgVar('3.0 mm', 'LST-3.0', 73.6, 1000000), kgVar('4.0 mm', 'LST-4.0', 98.1, 1330000), kgVar('5.0 mm', 'LST-5.0', 122.7, 1660000)] },
  { name: 'Rifli list 1250×2500', category: 'Listlar', sku: 'RLST', baseUnit: 'piece', isDivisible: false,
    variants: [kgVar('3 mm', 'RLST-3', 80, 1120000), kgVar('4 mm', 'RLST-4', 105, 1470000)] },
  { name: 'Rux qoplangan list 1250×2500', category: 'Listlar', sku: 'ZLST', baseUnit: 'piece', isDivisible: false,
    variants: [kgVar('0.5 mm', 'ZLST-0.5', 12.9, 230000), kgVar('0.7 mm', 'ZLST-0.7', 17.8, 310000)] },
  { name: 'Profnastil S8 rux 1200×2000 (0.4 mm)', category: 'Listlar', sku: 'PRF-S8', baseUnit: 'piece', isDivisible: false, retailPrice: 95000, conversions: [{ unit: 'm2', factor: 0.4167, price: 40000 }] },

  // ───────── Setka va panjara ─────────
  { name: 'Payvand setka (karta 1×2 m)', category: 'Setka va panjara', sku: 'SPK', baseUnit: 'piece', isDivisible: false, conversions: [{ unit: 'm2', factor: 0.5 }],
    variants: [kgVar('50×50×3 mm', 'SPK-50x3', 4.4, 55000), kgVar('100×100×4 mm', 'SPK-100x4', 4.0, 52000), kgVar('150×150×5 mm', 'SPK-150x5', 4.1, 54000)] },
  { name: 'Setka-rabitsa (rulon 1.5×10 m)', category: 'Setka va panjara', sku: 'RAB', baseUnit: 'roll', isDivisible: false, conversions: [{ unit: 'm2', factor: 0.0667 }],
    variants: [v('50×50×1.6 rux', 'RAB-50x1.6', 220000), v('50×50×1.8 rux', 'RAB-50x1.8', 260000), v('25×25×1.4 rux', 'RAB-25x1.4', 300000), v('50×50 PVX yashil', 'RAB-50-PVX', 290000)] },
  { name: '3D panjara paneli (PVX yashil, Ø4)', category: 'Setka va panjara', sku: '3DP', baseUnit: 'piece', isDivisible: false,
    variants: [v('1.53×2.5 m', '3DP-153', 480000), v('2.03×2.5 m', '3DP-203', 620000)] },
  { name: 'Plastik setka yashil (rulon 20 m)', category: 'Setka va panjara', sku: 'PSET', baseUnit: 'roll', isDivisible: false,
    variants: [v('1×20 m', 'PSET-1', 160000), v('1.5×20 m', 'PSET-1.5', 230000)] },
  { name: 'Shtaketnik metall rux', category: 'Setka va panjara', sku: 'SHT', baseUnit: 'piece', isDivisible: false,
    variants: [v('1.5 m', 'SHT-150', 32000), v('1.8 m', 'SHT-180', 38000), v('2.0 m', 'SHT-200', 42000)] },
  { name: 'Tayyor panjara seksiyasi (payvand, 2×2.5 m)', category: 'Setka va panjara', sku: 'PANJ-2x25', baseUnit: 'piece', isDivisible: false, retailPrice: 950000 },

  // ───────── Kovka elementlari (dona) ─────────
  { name: 'Volyuta (S-zavitok, 12×6)', category: 'Kovka elementlari', sku: 'KV-S', baseUnit: 'piece', isDivisible: false,
    variants: [v('100×50 mm', 'KV-S-100', 4500), v('150×75 mm', 'KV-S-150', 6500), v('200×100 mm', 'KV-S-200', 9000), v('300×150 mm', 'KV-S-300', 15000), v('400×200 mm', 'KV-S-400', 22000)] },
  { name: 'C-zavitok (12×6)', category: 'Kovka elementlari', sku: 'KV-C', baseUnit: 'piece', isDivisible: false,
    variants: [v('100×50 mm', 'KV-C-100', 4500), v('150×75 mm', 'KV-C-150', 6500), v('200×100 mm', 'KV-C-200', 9000)] },
  { name: 'Pika (nayza uchi)', category: 'Kovka elementlari', sku: 'KV-PIKA', baseUnit: 'piece', isDivisible: false,
    variants: [v('60 mm', 'KV-PIKA-60', 3500), v('80 mm', 'KV-PIKA-80', 4500), v('100 mm', 'KV-PIKA-100', 6000), v('120 mm', 'KV-PIKA-120', 8000)] },
  { name: 'Gul (rozetka)', category: 'Kovka elementlari', sku: 'KV-GUL', baseUnit: 'piece', isDivisible: false,
    variants: [v('Ø 60 mm', 'KV-GUL-60', 5000), v('Ø 80 mm', 'KV-GUL-80', 7000), v('Ø 100 mm', 'KV-GUL-100', 9500)] },
  { name: 'Metall shar (ichi bo\'sh)', category: 'Kovka elementlari', sku: 'KV-SHAR', baseUnit: 'piece', isDivisible: false,
    variants: [v('Ø 40 mm', 'KV-SHAR-40', 4000), v('Ø 50 mm', 'KV-SHAR-50', 5500), v('Ø 60 mm', 'KV-SHAR-60', 7500), v('Ø 80 mm', 'KV-SHAR-80', 12000), v('Ø 100 mm', 'KV-SHAR-100', 18000)] },
  { name: 'Ustun qalpog\'i', category: 'Kovka elementlari', sku: 'KV-QLP', baseUnit: 'piece', isDivisible: false,
    variants: [v('40×40 mm', 'KV-QLP-40', 8000), v('50×50 mm', 'KV-QLP-50', 10000), v('60×60 mm', 'KV-QLP-60', 13000), v('80×80 mm', 'KV-QLP-80', 20000), v('100×100 mm', 'KV-QLP-100', 28000)] },
  { name: 'Balyasina (12×12)', category: 'Kovka elementlari', sku: 'KV-BAL', baseUnit: 'piece', isDivisible: false,
    variants: [v('1000 mm', 'KV-BAL-1000', 45000), v('1200 mm', 'KV-BAL-1200', 55000)] },
  { name: 'Halqa (12×6)', category: 'Kovka elementlari', sku: 'KV-HLQ', baseUnit: 'piece', isDivisible: false,
    variants: [v('Ø 100 mm', 'KV-HLQ-100', 6000), v('Ø 150 mm', 'KV-HLQ-150', 9000), v('Ø 200 mm', 'KV-HLQ-200', 13000), v('Ø 300 mm', 'KV-HLQ-300', 20000)] },
  { name: 'Yurak (lira) elementi (12×6)', category: 'Kovka elementlari', sku: 'KV-LIRA', baseUnit: 'piece', isDivisible: false,
    variants: [v('200×400 mm', 'KV-LIRA-200', 25000), v('300×600 mm', 'KV-LIRA-300', 38000)] },
  { name: 'Burma polosa (vitaya, 12×6)', category: 'Kovka elementlari', sku: 'KV-BURMA', baseUnit: 'meter', isDivisible: true, retailPrice: 18000, conversions: [{ unit: 'piece', factor: 2 }] },
  { name: 'Kovka panjara paneli (naqshli, 1×2 m)', category: 'Kovka elementlari', sku: 'KV-PANEL', baseUnit: 'piece', isDivisible: false, retailPrice: 850000 },

  // ───────── Santexnika ─────────
  { name: 'PVX kanalizatsiya trubasi Ø50', category: 'Santexnika', sku: 'PVC50', baseUnit: 'piece', isDivisible: false,
    variants: [v('0.5 m', 'PVC50-05', 14000), v('1 m', 'PVC50-1', 22000), v('2 m', 'PVC50-2', 40000), v('3 m', 'PVC50-3', 58000)] },
  { name: 'PVX kanalizatsiya trubasi Ø110', category: 'Santexnika', sku: 'PVC110', baseUnit: 'piece', isDivisible: false,
    variants: [v('0.5 m', 'PVC110-05', 32000), v('1 m', 'PVC110-1', 55000), v('2 m', 'PVC110-2', 100000), v('3 m', 'PVC110-3', 145000)] },
  { name: 'PVX fitinglar Ø50', category: 'Santexnika', sku: 'PVCF50', baseUnit: 'piece', isDivisible: false,
    variants: [v('Tirsak 45°', 'PVCF50-45', 5000), v('Tirsak 90°', 'PVCF50-90', 5500), v('Troynik', 'PVCF50-T', 9000), v('Mufta', 'PVCF50-M', 4500)] },
  { name: 'PVX fitinglar Ø110', category: 'Santexnika', sku: 'PVCF110', baseUnit: 'piece', isDivisible: false,
    variants: [v('Tirsak 45°', 'PVCF110-45', 15000), v('Tirsak 90°', 'PVCF110-90', 16000), v('Troynik', 'PVCF110-T', 24000), v('Revizor', 'PVCF110-R', 28000)] },
  { name: 'PP truba VERO PN20 (4 m tayoq)', category: 'Santexnika', sku: 'PP', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'piece', factor: 4 }],
    variants: [v('Ø 20 mm', 'PP-20', 6500), v('Ø 25 mm', 'PP-25', 9500), v('Ø 32 mm', 'PP-32', 15000)] },
  { name: 'PP fitinglar', category: 'Santexnika', sku: 'PPF', baseUnit: 'piece', isDivisible: false,
    variants: [v('Mufta Ø20', 'PPF-M20', 1500), v('Tirsak Ø20', 'PPF-T20', 1800), v('Troynik Ø20', 'PPF-TR20', 2500), v('Mufta Ø25', 'PPF-M25', 2000), v('Tirsak Ø25', 'PPF-T25', 2500), v('Troynik Ø25', 'PPF-TR25', 3200), v('MRV Ø20×1/2"', 'PPF-MRV20', 9000)] },
  { name: 'PE truba (polietilen, g\'altak 100 m)', category: 'Santexnika', sku: 'PE', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'coil', factor: 100 }],
    variants: [v('Ø 20 PN10', 'PE-20', 4500), v('Ø 25 PN10', 'PE-25', 6000), v('Ø 32 PN10', 'PE-32', 9000)] },
  { name: 'Po\'lat otvod (payvand)', category: 'Santexnika', sku: 'OTV', baseUnit: 'piece', isDivisible: false,
    variants: [v('Ø 15', 'OTV-15', 3500), v('Ø 20', 'OTV-20', 4500), v('Ø 25', 'OTV-25', 6000), v('Ø 32', 'OTV-32', 8000), v('Ø 40', 'OTV-40', 11000), v('Ø 50', 'OTV-50', 15000)] },
  { name: 'Po\'lat mufta / sgon', category: 'Santexnika', sku: 'SGON', baseUnit: 'piece', isDivisible: false,
    variants: [v('Ø 15', 'SGON-15', 2500), v('Ø 20', 'SGON-20', 3000), v('Ø 25', 'SGON-25', 4000), v('Ø 32', 'SGON-32', 5500), v('Ø 50', 'SGON-50', 9000)] },
  { name: 'Latun sharli kran', category: 'Santexnika', sku: 'KRAN', baseUnit: 'piece', isDivisible: false,
    variants: [v('1/2"', 'KRAN-12', 28000), v('3/4"', 'KRAN-34', 38000), v('1"', 'KRAN-1', 60000)] },
  { name: 'Shlang xomuti (rux)', category: 'Santexnika', sku: 'XOM', baseUnit: 'piece', isDivisible: false,
    variants: [v('16–27 mm', 'XOM-16', 2000), v('25–40 mm', 'XOM-25', 2500), v('40–60 mm', 'XOM-40', 3500), v('60–80 mm', 'XOM-60', 4500), v('100–120 mm', 'XOM-100', 7000)] },
  { name: 'Suv hisoblagich Ø15', category: 'Santexnika', sku: 'SCH-15', baseUnit: 'piece', isDivisible: false, retailPrice: 120000 },
  { name: 'Sug\'orish shlangi Mirob 1/2" (rulon 50 m)', category: 'Santexnika', sku: 'SHL-12', baseUnit: 'meter', isDivisible: true, retailPrice: 4000, conversions: [{ unit: 'roll', factor: 50, price: 190000 }] },
  { name: 'Asbest-sement truba Ø150 (4 m)', category: 'Santexnika', sku: 'ACT-150', baseUnit: 'piece', isDivisible: false, retailPrice: 180000 },

  // ───────── Elektr tovarlar ─────────
  { name: 'LED lampa Beltims E27', category: 'Elektr tovarlar', sku: 'LED', baseUnit: 'piece', isDivisible: false,
    variants: [v('9W', 'LED-9', 12000), v('15W', 'LED-15', 18000), v('18W', 'LED-18', 22000), v('24W', 'LED-24', 30000), v('36W', 'LED-36', 45000), v('48W', 'LED-48', 60000)] },
  { name: 'LED panel Lucem (dumaloq)', category: 'Elektr tovarlar', sku: 'LPAN', baseUnit: 'piece', isDivisible: false,
    variants: [v('24W', 'LPAN-24', 48000), v('36W', 'LPAN-36', 65000)] },
  { name: 'LED projektor Lucem', category: 'Elektr tovarlar', sku: 'PRJ', baseUnit: 'piece', isDivisible: false,
    variants: [v('50W', 'PRJ-50', 75000), v('100W', 'PRJ-100', 120000), v('200W', 'PRJ-200', 220000)] },
  { name: 'Ko\'cha chirog\'i LED 150W Beltims', category: 'Elektr tovarlar', sku: 'STL-150', baseUnit: 'piece', isDivisible: false, retailPrice: 350000 },
  { name: 'Avtomat o\'chirgich CHNT 1P', category: 'Elektr tovarlar', sku: 'AVT1', baseUnit: 'piece', isDivisible: false,
    variants: [v('16A', 'AVT1-16', 22000), v('25A', 'AVT1-25', 22000), v('32A', 'AVT1-32', 24000), v('40A', 'AVT1-40', 26000), v('63A', 'AVT1-63', 32000)] },
  { name: 'Avtomat o\'chirgich DELIXI 2P', category: 'Elektr tovarlar', sku: 'AVT2', baseUnit: 'piece', isDivisible: false,
    variants: [v('25A', 'AVT2-25', 45000), v('32A', 'AVT2-32', 48000), v('40A', 'AVT2-40', 52000), v('63A', 'AVT2-63', 65000)] },
  { name: 'DIN-reyka 1 m', category: 'Elektr tovarlar', sku: 'DIN-1', baseUnit: 'piece', isDivisible: false, retailPrice: 9000 },
  { name: 'Rozetka va vyklyuchatel', category: 'Elektr tovarlar', sku: 'ROZ', baseUnit: 'piece', isDivisible: false,
    variants: [v('Rozetka 16A', 'ROZ-1', 12000), v('Ikki rozetka 16A', 'ROZ-2', 18000), v('Vyklyuchatel 1 klavish', 'VKL-1', 10000), v('Vyklyuchatel 2 klavish', 'VKL-2', 13000)] },
  { name: 'Podrozetnik Ø68', category: 'Elektr tovarlar', sku: 'PDR-68', baseUnit: 'piece', isDivisible: false, retailPrice: 1500, conversions: [{ unit: 'pack', factor: 10, price: 14000 }] },
  { name: 'Kabel PVS (g\'altak 100 m)', category: 'Elektr tovarlar', sku: 'PVS', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'coil', factor: 100 }],
    variants: [v('2×1.5 mm²', 'PVS-2x1.5', 4200), v('2×2.5 mm²', 'PVS-2x2.5', 6300), v('3×1.5 mm²', 'PVS-3x1.5', 6200), v('3×2.5 mm²', 'PVS-3x2.5', 9500)] },
  { name: 'Kabel VVG (g\'altak 100 m)', category: 'Elektr tovarlar', sku: 'VVG', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'coil', factor: 100 }],
    variants: [v('3×1.5 mm²', 'VVG-3x1.5', 6800), v('3×2.5 mm²', 'VVG-3x2.5', 10500), v('3×4 mm²', 'VVG-3x4', 16500)] },
  { name: 'Gofra truba PVX (rulon 100 m)', category: 'Elektr tovarlar', sku: 'GOF', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'roll', factor: 100 }],
    variants: [v('Ø 16', 'GOF-16', 1200), v('Ø 20', 'GOF-20', 1500), v('Ø 25', 'GOF-25', 2000)] },
  { name: 'Kabel-kanal (2 m)', category: 'Elektr tovarlar', sku: 'KK', baseUnit: 'piece', isDivisible: false,
    variants: [v('16×16', 'KK-16x16', 6000), v('25×16', 'KK-25x16', 8000), v('40×25', 'KK-40x25', 14000)] },
  { name: 'Izolenta PVX 19 mm', category: 'Elektr tovarlar', sku: 'IZL-19', baseUnit: 'piece', isDivisible: false, retailPrice: 4000, conversions: [{ unit: 'pack', factor: 10, price: 36000 }] },
  { name: 'Udlinitel (uzaytirgich)', category: 'Elektr tovarlar', sku: 'UDL', baseUnit: 'piece', isDivisible: false,
    variants: [v('3 m', 'UDL-3', 35000), v('5 m', 'UDL-5', 48000), v('10 m', 'UDL-10', 85000)] },
  { name: 'LED lenta 12V (rulon 5 m)', category: 'Elektr tovarlar', sku: 'LEDL', baseUnit: 'meter', isDivisible: true, retailPrice: 8000, conversions: [{ unit: 'roll', factor: 5, price: 38000 }] },

  // ───────── Xo'jalik mollari (metiz) ─────────
  { name: 'Samorez metall (rux)', category: "Xo'jalik mollari", sku: 'SAMM', baseUnit: 'kg', isDivisible: true,
    variants: [v('3.5×16 mm', 'SAMM-3.5x16', 24000), v('3.5×25 mm', 'SAMM-3.5x25', 23000), v('4.2×32 mm', 'SAMM-4.2x32', 22000), v('4.2×51 mm', 'SAMM-4.2x51', 21500), v('4.8×70 mm', 'SAMM-4.8x70', 21000)] },
  { name: 'Samorez gipsokarton (qora)', category: "Xo'jalik mollari", sku: 'SAMG', baseUnit: 'kg', isDivisible: true,
    variants: [v('3.5×25 mm', 'SAMG-3.5x25', 20000), v('3.5×35 mm', 'SAMG-3.5x35', 19500), v('3.5×45 mm', 'SAMG-3.5x45', 19000), v('3.5×55 mm', 'SAMG-3.5x55', 18500), v('4.2×65 mm', 'SAMG-4.2x65', 18000)] },
  { name: 'Qurilish mixi', category: "Xo'jalik mollari", sku: 'NAIL', baseUnit: 'kg', isDivisible: true, conversions: [{ unit: 'box', factor: 5 }],
    variants: [v('50 mm', 'NAIL-50', 24500), v('70 mm', 'NAIL-70', 24000), v('100 mm', 'NAIL-100', 22500), v('120 mm', 'NAIL-120', 23000), v('150 mm', 'NAIL-150', 23000)] },
  { name: 'Bolt + gayka (rux)', category: "Xo'jalik mollari", sku: 'BOLT', baseUnit: 'kg', isDivisible: true,
    variants: [v('M8', 'BOLT-M8', 25000), v('M10', 'BOLT-M10', 24000), v('M12', 'BOLT-M12', 23000), v('M16', 'BOLT-M16', 22000)] },
  { name: 'Shayba (rux)', category: "Xo'jalik mollari", sku: 'SHB', baseUnit: 'kg', isDivisible: true,
    variants: [v('M8', 'SHB-M8', 26000), v('M10', 'SHB-M10', 25000), v('M12', 'SHB-M12', 24000), v('M16', 'SHB-M16', 23000)] },
  { name: 'Dyubel plastik', category: "Xo'jalik mollari", sku: 'DUB', baseUnit: 'piece', isDivisible: false, conversions: [{ unit: 'pack', factor: 100 }],
    variants: [v('6×40 mm', 'DUB-6x40', 150), v('8×60 mm', 'DUB-8x60', 250), v('10×80 mm', 'DUB-10x80', 400)] },
  { name: 'Elektrod ARSE 6013 (pachka 2.5 kg)', category: "Xo'jalik mollari", sku: 'ELK', baseUnit: 'pack', isDivisible: false, conversions: [{ unit: 'kg', factor: 0.4 }],
    variants: [v('Ø 2.5 mm', 'ELK-2.5', 55000), v('Ø 3.2 mm', 'ELK-3.2', 55000)] },
  { name: 'Elektrod ATOM Premium (pachka 5 kg)', category: "Xo'jalik mollari", sku: 'ELKA', baseUnit: 'pack', isDivisible: false, conversions: [{ unit: 'kg', factor: 0.2 }],
    variants: [v('Ø 3 mm', 'ELKA-3', 110000), v('Ø 4 mm', 'ELKA-4', 110000)] },
  { name: 'Bog\'lash simi 1.2 mm (g\'altak 5 kg)', category: "Xo'jalik mollari", sku: 'PRV-1.2', baseUnit: 'kg', isDivisible: true, retailPrice: 14000, conversions: [{ unit: 'coil', factor: 5, price: 68000 }] },
  { name: 'Montaj lentasi perforatsiyali 20×0.7 (rulon 25 m)', category: "Xo'jalik mollari", sku: 'MLENT-20', baseUnit: 'roll', isDivisible: false, retailPrice: 35000, conversions: [{ unit: 'meter', factor: 0.04 }] },

  // ───────── Sement va aralashmalar (qop) ─────────
  { name: 'Sement Qizilqum M400 (50 kg)', category: 'Sement va aralashmalar', sku: 'SEM-M400-50', baseUnit: 'bag', isDivisible: false, retailPrice: 58000, conversions: [{ unit: 'kg', factor: 0.02, price: 1250 }] },
  { name: 'Sement Qizilqum M500 (50 kg)', category: 'Sement va aralashmalar', sku: 'SEM-M500-50', baseUnit: 'bag', isDivisible: false, retailPrice: 65000, barcodes: ['4780012345024'], conversions: [{ unit: 'kg', factor: 0.02, price: 1400 }] },
  { name: 'Izotop 520 shpaklyovka (25 kg)', category: 'Sement va aralashmalar', sku: 'IZT-520', baseUnit: 'bag', isDivisible: false, retailPrice: 42000 },
  { name: 'Alebastr (gips) 30 kg', category: 'Sement va aralashmalar', sku: 'GIPS-30', baseUnit: 'bag', isDivisible: false, retailPrice: 28000 },
  { name: 'Kafel yelimi (25 kg)', category: 'Sement va aralashmalar', sku: 'KY-25', baseUnit: 'bag', isDivisible: false, retailPrice: 35000 },

  // ───────── Izolyatsiya ─────────
  { name: 'Bazalt tosh paxta Bekobod (paket 1200×600)', category: 'Izolyatsiya materiallari', sku: 'BZT', baseUnit: 'piece', isDivisible: false,
    variants: [v('50 mm (4.32 m²)', 'BZT-50', 120000), v('100 mm (2.16 m²)', 'BZT-100', 125000)] },
  { name: 'Penofol 3 mm (rulon 1.2×30 m)', category: 'Izolyatsiya materiallari', sku: 'PNF-3', baseUnit: 'm2', isDivisible: true, retailPrice: 9000, conversions: [{ unit: 'roll', factor: 36, price: 310000 }] },
  { name: 'Izolon 5 mm (rulon 1×30 m)', category: 'Izolyatsiya materiallari', sku: 'IZN-5', baseUnit: 'm2', isDivisible: true, retailPrice: 11000, conversions: [{ unit: 'roll', factor: 30, price: 320000 }] },
  { name: 'Gepard gidroizolyatsiya (rulon 10 m²)', category: 'Izolyatsiya materiallari', sku: 'GPD-10', baseUnit: 'roll', isDivisible: false, retailPrice: 220000, conversions: [{ unit: 'm2', factor: 0.1 }] },

  // ───────── Kafel va pol (linoleum, gipsokarton) ─────────
  { name: 'Linoleum', category: 'Kafel va pol', sku: 'LIN', baseUnit: 'm2', isDivisible: true,
    variants: [v('eni 2 m, ofis', 'LIN-2', 45000), v('eni 3 m, uy', 'LIN-3', 52000)] },
  { name: 'Gipsokarton list 1200×2500', category: 'Kafel va pol', sku: 'GKL', baseUnit: 'piece', isDivisible: false, conversions: [{ unit: 'm2', factor: 0.3333 }],
    variants: [v('9.5 mm', 'GKL-9.5', 85000), v('12.5 mm', 'GKL-12.5', 95000)] },
  { name: 'Gipsokarton profili (3 m)', category: 'Kafel va pol', sku: 'GKP', baseUnit: 'piece', isDivisible: false,
    variants: [v('PP 60×27', 'GKP-PP60', 22000), v('PN 27×28', 'GKP-PN27', 15000), v('PS 50×50', 'GKP-PS50', 32000)] },

  // ───────── Bo'yoqlar va kimyo ─────────
  { name: 'Emal PF-115 (banka 2.8 kg)', category: "Bo'yoqlar", sku: 'PF115', baseUnit: 'kg', isDivisible: true, conversions: [{ unit: 'can', factor: 2.8, price: 100000 }],
    variants: [v('Oq', 'PF115-W', 38000), v('Ko\'k', 'PF115-B', 38000), v('Qizil', 'PF115-R', 38000), v('Yashil', 'PF115-G', 38000), v('Qora', 'PF115-K', 36000)] },
  { name: 'Hammer effekt bo\'yoq (0.75 l)', category: "Bo'yoqlar", sku: 'HAM', baseUnit: 'piece', isDivisible: false,
    variants: [v('Kulrang', 'HAM-GR', 85000), v('Jigarrang', 'HAM-BR', 85000), v('Ko\'k', 'HAM-BL', 85000), v('Yashil', 'HAM-GN', 85000)] },
  { name: 'Metallic bo\'yoq (0.75 l)', category: "Bo'yoqlar", sku: 'MET', baseUnit: 'piece', isDivisible: false,
    variants: [v('Kumush', 'MET-SL', 80000), v('Oltin', 'MET-GD', 85000), v('Bronza', 'MET-BZ', 85000)] },
  { name: 'Aerozol bo\'yoq 400 ml', category: "Bo'yoqlar", sku: 'AER', baseUnit: 'piece', isDivisible: false,
    variants: [v('Oq', 'AER-W', 25000), v('Qora', 'AER-K', 25000), v('Kumush', 'AER-SL', 27000), v('Qizil', 'AER-R', 25000)] },
  { name: 'Akfix 310 silikon germetik 280 ml', category: "Bo'yoqlar", sku: 'AK310', baseUnit: 'piece', isDivisible: false,
    variants: [v('Shaffof', 'AK310-C', 28000), v('Oq', 'AK310-W', 28000)] },
  { name: 'Akfix 805P montaj penasi 750 ml', category: "Bo'yoqlar", sku: 'AK805', baseUnit: 'piece', isDivisible: false, retailPrice: 45000, conversions: [{ unit: 'box', factor: 12, price: 520000 }] },
  { name: 'Akfix 905 poliuretan germetik', category: "Bo'yoqlar", sku: 'AK905', baseUnit: 'piece', isDivisible: false, retailPrice: 55000 },
  { name: 'Vero germetik va yelim', category: "Bo'yoqlar", sku: 'VERO', baseUnit: 'piece', isDivisible: false,
    variants: [v('Germetik universal', 'VERO-G', 22000), v('Yelim "suyuq mix"', 'VERO-K', 25000)] },
  { name: 'Erituvchi 646 (0.5 l)', category: "Bo'yoqlar", sku: 'R646', baseUnit: 'piece', isDivisible: false, retailPrice: 14000 },
  { name: 'Skotch shaffof 48 mm', category: "Bo'yoqlar", sku: 'SKT-48', baseUnit: 'piece', isDivisible: false, retailPrice: 9000, conversions: [{ unit: 'pack', factor: 6, price: 50000 }] },
  { name: 'Antifriz 5 kg', category: "Bo'yoqlar", sku: 'ANTF-5', baseUnit: 'piece', isDivisible: false, retailPrice: 65000 },

  // ───────── Asbob-uskunalar ─────────
  { name: 'Bolgarka Makute 125 mm 850W', category: 'Asbob-uskunalar', sku: 'MK-AG125', baseUnit: 'piece', isDivisible: false, retailPrice: 950000 },
  { name: 'Bolgarka Polwan 230 mm 2200W', category: 'Asbob-uskunalar', sku: 'PW-AG230', baseUnit: 'piece', isDivisible: false, retailPrice: 1450000 },
  { name: 'Drel Makute 550W', category: 'Asbob-uskunalar', sku: 'MK-DR550', baseUnit: 'piece', isDivisible: false, retailPrice: 520000 },
  { name: 'Perforator Makute 850W', category: 'Asbob-uskunalar', sku: 'MK-PRF850', baseUnit: 'piece', isDivisible: false, retailPrice: 1350000 },
  { name: 'Shurupovyort akkumulyatorli 12V', category: 'Asbob-uskunalar', sku: 'SHUR-12V', baseUnit: 'piece', isDivisible: false, retailPrice: 650000 },
  { name: 'Lobzik 600W', category: 'Asbob-uskunalar', sku: 'LOB-600', baseUnit: 'piece', isDivisible: false, retailPrice: 480000 },
  { name: 'Disk arra Makute 185 mm', category: 'Asbob-uskunalar', sku: 'MK-CS185', baseUnit: 'piece', isDivisible: false, retailPrice: 1150000 },
  { name: 'Payvandlash apparati Makute MMA-250NEO', category: 'Asbob-uskunalar', sku: 'MK-MMA250', baseUnit: 'piece', isDivisible: false, retailPrice: 1250000 },
  { name: 'Charxlash stanogi Makute 370W', category: 'Asbob-uskunalar', sku: 'MK-BG370', baseUnit: 'piece', isDivisible: false, retailPrice: 750000 },
  { name: 'Kompressor Makute AC1250', category: 'Asbob-uskunalar', sku: 'MK-AC1250', baseUnit: 'piece', isDivisible: false, retailPrice: 1650000 },
  { name: 'Generator benzinli TONI', category: 'Asbob-uskunalar', sku: 'GEN-TONI', baseUnit: 'piece', isDivisible: false,
    variants: [v('BG-3500I (3 kW)', 'GEN-3500', 5200000), v('BG-4500I (4 kW)', 'GEN-4500', 6800000)] },
  { name: 'Motokosa Liman LDG102', category: 'Asbob-uskunalar', sku: 'LIM-LDG102', baseUnit: 'piece', isDivisible: false, retailPrice: 1900000 },
  { name: 'Suv osti nasosi 750W', category: 'Asbob-uskunalar', sku: 'NAS-750', baseUnit: 'piece', isDivisible: false, retailPrice: 900000 },
  { name: 'Betonaralashtirgich 180 l', category: 'Asbob-uskunalar', sku: 'BTN-180', baseUnit: 'piece', isDivisible: false, retailPrice: 7500000 },
  { name: 'Kesuvchi disk (metall)', category: 'Asbob-uskunalar', sku: 'DISC', baseUnit: 'piece', isDivisible: false, conversions: [{ unit: 'box', factor: 25 }],
    variants: [v('125×1.2 mm', 'DISC-125', 9000), v('180×1.6 mm', 'DISC-180', 16000), v('230×2.0 mm', 'DISC-230', 22000)] },
  { name: 'Elmas disk', category: 'Asbob-uskunalar', sku: 'DDISC', baseUnit: 'piece', isDivisible: false,
    variants: [v('125 mm', 'DDISC-125', 45000), v('230 mm', 'DDISC-230', 120000)] },
  { name: 'Sim cho\'tka (chashka) 100 mm', category: 'Asbob-uskunalar', sku: 'BRUSH-100', baseUnit: 'piece', isDivisible: false, retailPrice: 25000 },
  { name: 'Shpatel', category: 'Asbob-uskunalar', sku: 'SHP', baseUnit: 'piece', isDivisible: false,
    variants: [v('100 mm', 'SHP-100', 12000), v('150 mm', 'SHP-150', 15000), v('200 mm', 'SHP-200', 18000), v('300 mm', 'SHP-300', 25000)] },
  { name: 'Kelma (mala)', category: 'Asbob-uskunalar', sku: 'KLM', baseUnit: 'piece', isDivisible: false, retailPrice: 28000 },
  { name: 'Bo\'yoq cho\'tkasi', category: 'Asbob-uskunalar', sku: 'CHT', baseUnit: 'piece', isDivisible: false,
    variants: [v('1"', 'CHT-1', 5000), v('2"', 'CHT-2', 8000), v('3"', 'CHT-3', 12000), v('4"', 'CHT-4', 16000)] },
  { name: 'Valik (rolik)', category: 'Asbob-uskunalar', sku: 'VLK', baseUnit: 'piece', isDivisible: false,
    variants: [v('180 mm', 'VLK-180', 22000), v('250 mm', 'VLK-250', 30000)] },
  { name: 'Ruletka', category: 'Asbob-uskunalar', sku: 'RUL', baseUnit: 'piece', isDivisible: false,
    variants: [v('5 m', 'RUL-5', 25000), v('10 m', 'RUL-10', 45000), v('20 m', 'RUL-20', 75000)] },
  { name: 'Uroven (vaterpas)', category: 'Asbob-uskunalar', sku: 'URV', baseUnit: 'piece', isDivisible: false,
    variants: [v('60 cm', 'URV-60', 45000), v('100 cm', 'URV-100', 70000)] },
  { name: 'Bolg\'a', category: 'Asbob-uskunalar', sku: 'MOL', baseUnit: 'piece', isDivisible: false,
    variants: [v('500 g', 'MOL-500', 45000), v('1 kg', 'MOL-1000', 65000), v('Kuvalda 3 kg', 'MOL-3000', 120000), v('Kuvalda 5 kg', 'MOL-5000', 170000)] },
  { name: 'Gayka kalitlari to\'plami 6–22', category: 'Asbob-uskunalar', sku: 'KALIT-6-22', baseUnit: 'set', isDivisible: false, retailPrice: 180000 },
  { name: 'Qo\'lqop', category: 'Asbob-uskunalar', sku: 'QLQ', baseUnit: 'pair', isDivisible: false, conversions: [{ unit: 'pack', factor: 12 }],
    variants: [v('Matoli (XB)', 'QLQ-XB', 3500), v('Rezina (to\'q sariq)', 'QLQ-RZ', 9000), v('PVX tomchili', 'QLQ-PVX', 6000)] },

  // ───────── Boshqa qurilish mollari ─────────
  { name: 'Taxta qarag\'ay 50×150×4000', category: 'Boshqa qurilish mollari', sku: 'TAX-50x150', baseUnit: 'piece', isDivisible: false, retailPrice: 95000, conversions: [{ unit: 'm3', factor: 33.33 }] },
  { name: 'Brus qarag\'ay 100×100×4000', category: 'Boshqa qurilish mollari', sku: 'BRUS-100', baseUnit: 'piece', isDivisible: false, retailPrice: 190000, conversions: [{ unit: 'm3', factor: 25 }] },
  { name: 'Lyuk qopqog\'i cho\'yan', category: 'Boshqa qurilish mollari', sku: 'LYUK', baseUnit: 'piece', isDivisible: false,
    variants: [v('Dumaloq Ø700 (T)', 'LYUK-R700', 450000), v('To\'rtburchak 600×600', 'LYUK-S600', 380000)] },
  { name: 'Beton halqa KS 10-9', category: 'Boshqa qurilish mollari', sku: 'BHAL-10-9', baseUnit: 'piece', isDivisible: false, retailPrice: 350000 },
  { name: 'Plastik chelak 12 l', category: 'Boshqa qurilish mollari', sku: 'CHLK-12', baseUnit: 'piece', isDivisible: false, retailPrice: 18000 },
];
