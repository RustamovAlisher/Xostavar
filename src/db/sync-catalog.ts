import 'dotenv/config';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../entities/index.js';
import { DEFAULT_SETTINGS } from '../modules/settings/constants/settings.defaults.js';
import { DEMO_PRODUCTS, type DemoProduct } from './demo-products.js';

/**
 * Katalogni standart lug'atlar bilan MOSLASHTIRISH (o'chirib qayta yaratmasdan):
 *   - birliklar, kategoriyalar, o'lcham andozalari, yetkazib beruvchilar, mijoz guruhlari: yetishmayotgani qo'shiladi,
 *     noto'g'ri parametr (kg/m, tavsif, standart birlik) tuzatiladi, eski seed'dan qolgan keraksiz andozalar o'chiriladi;
 *   - `--products` bilan demo mahsulotlar ham: mavjudlari SKU bo'yicha yangilanadi (narxlar saqlanadi), variantlar nomi/o'lchami
 *     bo'yicha moslanadi, yetishmayotgani qo'shiladi, eski seed namunalari o'chiriladi (tarixi bo'lsa arxivlanadi, qoldig'i bo'lsa tegilmaydi).
 *     Foydalanuvchi o'zi kiritgan mahsulotlarga tegilmaydi.
 *
 *   node dist/db/sync-catalog.js [--products] [--apply]      (--apply bo'lmasa quruq rejim: hisobot, hech narsa saqlanmaydi)
 */
const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const WITH_PRODUCTS = args.has('--products');
const D = DEFAULT_SETTINGS;

/** Eski seed'dan qolgan, yangi katalogda boshqa nom/SKU bilan ifodalangan namunalar (foydalanuvchi mahsulotlari bu ro'yxatda yo'q). */
const RETIRED_SKUS = ['PT', 'TL-2.0-1250', 'SAM-3.5x35', 'DISC-125', 'MAK-GA5030', 'PF115-W', 'TILE-3060-GR'];
/** Eski seed andozalari — yangi ro'yxatda yo'q (nomi o'zgargan). */
const RETIRED_PRESET_NAMES = ['Ø 16 mm 25G2S'];

const lower = (s: string) => s.trim().toLowerCase();
/** Variant nomini taqqoslash kaliti: "Ø 12 mm A500C" → "12", "40×20×2 mm" → "40x20x2", "70 mm" → "70". */
const vkey = (s: string) =>
  lower(s).replace(/[×x]/g, 'x').replace(/ø/g, '').replace(/\b(mm|a500c|25g2s|rux)\b/g, '').replace(/[\s()]/g, '');
const num = (x: unknown) => (x == null ? null : Number(x));
/** Birlik shablonini tartibdan qat'i nazar solishtirish. */
const sameConversions = (a: { unit: string; factor: number }[], b: { unit: string; factor: number }[]) => {
  const key = (l: { unit: string; factor: number }[]) => [...l].map((c) => `${c.unit}=${Number(c.factor)}`).sort().join('|');
  return key(a) === key(b);
};

const log: string[] = [];
const stat = { add: 0, upd: 0, del: 0, warn: 0 };
const add = (m: string) => { stat.add++; log.push(`+ ${m}`); };
const upd = (m: string) => { stat.upd++; log.push(`~ ${m}`); };
const del = (m: string) => { stat.del++; log.push(`- ${m}`); };
const warn = (m: string) => { stat.warn++; log.push(`! ${m}`); };

class DryRun extends Error {}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function syncUnits(tx: Tx) {
  const units = await tx.select().from(schema.units);
  const byId = new Map(units.map((u) => [u.id, u]));
  const byShort = new Set(units.map((u) => lower(u.short)));
  for (const [i, u] of D.units.entries()) {
    const cur = byId.get(u.id);
    if (!cur) {
      // Qisqartma band bo'lsa ham birlik qo'shiladi (mahsulot/konversiyalar unga tayanadi — FK), qisqartma sifatida id ishlatiladi
      const short = byShort.has(lower(u.short)) ? u.id : u.short;
      if (short !== u.short) warn(`birlik ${u.id}: "${u.short}" qisqartmasi boshqa birlikda band — "${short}" bilan qo'shildi, sozlamalarda tuzating`);
      await tx.insert(schema.units).values({ ...u, short, sortOrder: i });
      byShort.add(lower(short));
      add(`birlik ${u.id} (${u.name})`);
    } else if (cur.sortOrder !== i) {
      await tx.update(schema.units).set({ sortOrder: i }).where(eq(schema.units.id, u.id));
    }
  }
}

async function syncCategories(tx: Tx) {
  const cats = await tx.select().from(schema.categories);
  const byName = new Map(cats.map((c) => [lower(c.name), c]));
  for (const [i, c] of D.categories.entries()) {
    const cur = byName.get(lower(c.name));
    if (!cur) {
      const [row] = await tx.insert(schema.categories).values({ ...c, sortOrder: i }).returning();
      byName.set(lower(c.name), row);
      add(`kategoriya "${c.name}"`);
      continue;
    }
    const diff: string[] = [];
    const set: Partial<typeof cur> = {};
    // Belgi va tavsif — egasi o'zgartirgan bo'lishi mumkin: faqat bo'sh bo'lsa to'ldiriladi
    if (!cur.icon?.trim() && c.icon) { set.icon = c.icon; diff.push('belgi'); }
    if (!cur.description?.trim() && c.description) { set.description = c.description; diff.push('tavsif'); }
    if (cur.defaultBaseUnit !== c.defaultBaseUnit) { set.defaultBaseUnit = c.defaultBaseUnit; diff.push(`asosiy birlik ${cur.defaultBaseUnit}→${c.defaultBaseUnit}`); }
    if (cur.defaultIsDivisible !== c.defaultIsDivisible) { set.defaultIsDivisible = c.defaultIsDivisible; diff.push('kasr miqdor'); }
    if (!sameConversions(cur.defaultConversions ?? [], c.defaultConversions)) { set.defaultConversions = c.defaultConversions; diff.push('birlik shabloni'); }
    if (cur.sortOrder !== i) { set.sortOrder = i; diff.push('tartib'); }
    if (diff.length) {
      await tx.update(schema.categories).set(set).where(eq(schema.categories.id, cur.id));
      upd(`kategoriya "${c.name}": ${diff.join(', ')}`);
    }
  }
  return byName;
}

async function syncPresets(tx: Tx, catByName: Map<string, { id: string; name: string }>) {
  const all = await tx.select().from(schema.sizePresets);
  const retired = new Set(RETIRED_PRESET_NAMES.map(lower));
  const byCat = new Map<string, typeof D.sizePresets>();
  for (const s of D.sizePresets) byCat.set(s.category, [...(byCat.get(s.category) ?? []), s]);
  for (const [catName, want] of byCat) {
    const cat = catByName.get(lower(catName));
    if (!cat) { warn(`andozalar: "${catName}" kategoriyasi yo'q`); continue; }
    const existing = all.filter((p) => p.categoryId === cat.id);
    for (const [i, s] of want.entries()) {
      const cur = existing.find((p) => lower(p.name) === lower(s.name));
      const kg = s.kgPerMeter ?? null;
      if (!cur) {
        await tx.insert(schema.sizePresets).values({ categoryId: cat.id, name: s.name, kgPerMeter: kg, sortOrder: i });
        add(`andoza ${catName} / ${s.name}${kg != null ? ` (${kg} kg/m)` : ''}`);
      } else if (num(cur.kgPerMeter) !== kg || cur.sortOrder !== i) {
        await tx.update(schema.sizePresets).set({ kgPerMeter: kg, sortOrder: i }).where(eq(schema.sizePresets.id, cur.id));
        if (num(cur.kgPerMeter) !== kg) upd(`andoza ${catName} / ${s.name}: kg/m ${num(cur.kgPerMeter) ?? '—'} → ${kg ?? '—'}`);
      }
    }
    for (const p of existing) {
      if (retired.has(lower(p.name))) {
        await tx.delete(schema.sizePresets).where(eq(schema.sizePresets.id, p.id));
        del(`andoza ${catName} / ${p.name} (eski seed, yangi ro'yxatda yo'q)`);
      }
    }
  }
}

async function syncNameLists(tx: Tx) {
  const sup = new Set((await tx.select().from(schema.suppliers)).map((s) => lower(s.name)));
  for (const name of D.suppliers) if (!sup.has(lower(name))) { await tx.insert(schema.suppliers).values({ name }); add(`yetkazib beruvchi "${name}"`); }
  const groups = await tx.select().from(schema.customerGroups);
  const gset = new Set(groups.map((g) => lower(g.name)));
  for (const [i, name] of D.customerGroups.entries()) if (!gset.has(lower(name))) { await tx.insert(schema.customerGroups).values({ name, sortOrder: groups.length + i }); add(`mijoz guruhi "${name}"`); }
}

async function hasHistory(tx: Tx, productId: string) {
  const [sold] = await tx.select({ id: schema.saleLines.id }).from(schema.saleLines).where(eq(schema.saleLines.productId, productId)).limit(1);
  if (sold) return true;
  const [rec] = await tx.select({ id: schema.stockReceiptLines.id }).from(schema.stockReceiptLines).where(eq(schema.stockReceiptLines.productId, productId)).limit(1);
  if (rec) return true;
  const [mv] = await tx.select({ id: schema.stockMovements.id }).from(schema.stockMovements).where(eq(schema.stockMovements.productId, productId)).limit(1);
  return !!mv;
}
async function stockedAnywhere(tx: Tx, productId: string) {
  const [row] = await tx.select({ stock: schema.stockLevels.stock }).from(schema.stockLevels).where(and(eq(schema.stockLevels.productId, productId), sql`${schema.stockLevels.stock} <> 0`)).limit(1);
  return !!row;
}
/** CatalogRepository.softDeleteProduct bilan bir xil: kodlar bo'shatiladi, tarix saqlanadi. */
async function softDelete(tx: Tx, id: string) {
  const tag = sql`'#del#' || extract(epoch from now())::bigint`;
  await tx.update(schema.products).set({ deletedAt: new Date(), sku: sql`${schema.products.sku} || ${tag}` }).where(eq(schema.products.id, id));
  await tx.update(schema.productVariants).set({ deletedAt: new Date(), sku: sql`${schema.productVariants.sku} || ${tag}` }).where(and(eq(schema.productVariants.productId, id), isNull(schema.productVariants.deletedAt)));
  await tx.delete(schema.productBarcodes).where(eq(schema.productBarcodes.productId, id));
  await tx.delete(schema.stockLevels).where(eq(schema.stockLevels.productId, id));
}

async function syncProducts(tx: Tx, catByName: Map<string, { id: string; name: string }>) {
  const prods = await tx.select().from(schema.products);
  const bySku = new Map(prods.filter((p) => !p.deletedAt).map((p) => [lower(p.sku), p]));
  const demoSkus = new Set(DEMO_PRODUCTS.map((d) => lower(d.sku)));

  // 1) Eski seed namunalarini olib tashlash (qator qulflanadi — parallel kirim qoldig'ini o'tkazib yubormaslik uchun)
  const kept: ProductRow[] = [];
  for (const sku of RETIRED_SKUS) {
    const p = bySku.get(lower(sku));
    if (!p || demoSkus.has(lower(sku))) continue;
    await tx.execute(sql`select 1 from ${schema.products} where ${schema.products.id} = ${p.id} for update`);
    if (await stockedAnywhere(tx, p.id)) { warn(`${p.sku} "${p.name}": omborda qoldig'i bor — o'chirilmadi (avval qoldiqni 0 ga keltiring)`); kept.push(p); continue; }
    if (await hasHistory(tx, p.id)) { await softDelete(tx, p.id); del(`${p.sku} "${p.name}" arxivlandi (tarixi bor)`); }
    else { await tx.delete(schema.products).where(eq(schema.products.id, p.id)); del(`${p.sku} "${p.name}" o'chirildi`); }
    bySku.delete(lower(sku));
  }

  // Band kodlar — 1-qadamdan KEYIN: faol mahsulot SKU ∪ faol variant SKU ∪ shtrix-kodlar (CatalogRepository.findCodeHit bilan bir xil nom maydoni)
  const allVariants = (await tx.select().from(schema.productVariants)).filter((v) => !v.deletedAt);
  const taken = new Set<string>([
    ...[...bySku.keys()],
    ...allVariants.map((v) => lower(v.sku)),
    ...(await tx.select().from(schema.productBarcodes)).map((b) => lower(b.barcode)),
  ]);
  for (const p of kept) for (const d of DEMO_PRODUCTS) for (const v of d.variants ?? []) if (lower(v.sku) === lower(p.sku)) warn(`${p.sku}: qolgan eski mahsulot SKU'si yangi ${d.sku} / ${v.name} variantini bloklaydi — eskisini o'chirgach qayta ishga tushiring`);

  // 2) Demo katalog: yangilash yoki qo'shish
  for (const d of DEMO_PRODUCTS) {
    const cat = catByName.get(lower(d.category));
    if (!cat) { warn(`${d.sku}: "${d.category}" kategoriyasi yo'q`); continue; }
    const cur = bySku.get(lower(d.sku));
    if (!cur) { await insertProduct(tx, d, cat.id, taken); continue; }
    await updateProduct(tx, cur, d, cat.id, allVariants.filter((v) => v.productId === cur.id), taken);
  }
}

async function insertProduct(tx: Tx, d: DemoProduct, categoryId: string, taken: Set<string>) {
  if (taken.has(lower(d.sku))) { warn(`${d.sku} "${d.name}": SKU boshqa mahsulot varianti yoki shtrix-kodi sifatida band — qo'shilmadi`); return; }
  taken.add(lower(d.sku));
  const barcodes = taken;
  const variantSkus = taken;
  const [p] = await tx.insert(schema.products)
    .values({ name: d.name, categoryId, sku: d.sku, baseUnit: d.baseUnit, isDivisible: d.isDivisible, retailPrice: d.retailPrice ?? 0, isVariable: !!d.variants })
    .returning({ id: schema.products.id });
  for (const c of d.conversions ?? []) {
    await tx.insert(schema.unitConversions).values({ productId: p.id, unit: c.unit, factor: c.factor, price: c.price ?? null });
    if (c.barcode && !barcodes.has(lower(c.barcode))) { await tx.insert(schema.productBarcodes).values({ productId: p.id, unit: c.unit, barcode: c.barcode }); barcodes.add(lower(c.barcode)); }
  }
  for (const b of d.barcodes ?? []) if (!barcodes.has(lower(b))) { await tx.insert(schema.productBarcodes).values({ productId: p.id, barcode: b }); barcodes.add(lower(b)); }
  let skipped = 0;
  for (const [i, v] of (d.variants ?? []).entries()) {
    if (variantSkus.has(lower(v.sku))) { skipped++; warn(`${d.sku} / ${v.name}: variant SKU ${v.sku} band — qo'shilmadi`); continue; }
    const [row] = await tx.insert(schema.productVariants).values({ productId: p.id, name: v.name, sku: v.sku, retailPrice: v.retailPrice, sortOrder: i }).returning({ id: schema.productVariants.id });
    variantSkus.add(lower(v.sku));
    if (v.kg != null) await tx.insert(schema.unitConversions).values({ productId: p.id, variantId: row.id, unit: 'kg', factor: v.kg });
  }
  add(`${d.sku} "${d.name}"${d.variants ? ` (${d.variants.length - skipped} variant)` : ''}`);
}

type ProductRow = typeof schema.products.$inferSelect;
type VariantRow = typeof schema.productVariants.$inferSelect;

async function updateProduct(tx: Tx, cur: ProductRow, d: DemoProduct, categoryId: string, variants: VariantRow[], taken: Set<string>) {
  const barcodes = taken;
  const variantSkus = taken;
  const diff: string[] = [];
  const set: Partial<ProductRow> = {};
  if (cur.name !== d.name) { set.name = d.name; diff.push(`nom "${cur.name}" → "${d.name}"`); }
  if (cur.categoryId !== categoryId) { set.categoryId = categoryId; diff.push(`kategoriya → ${d.category}`); }
  if (cur.isDivisible !== d.isDivisible) { set.isDivisible = d.isDivisible; diff.push('kasr miqdor'); }
  if (cur.baseUnit !== d.baseUnit) {
    if (await hasHistory(tx, cur.id) || await stockedAnywhere(tx, cur.id)) warn(`${cur.sku}: asosiy birlik ${cur.baseUnit}→${d.baseUnit} o'zgartirilmadi (harakatlari/qoldig'i bor)`);
    else { set.baseUnit = d.baseUnit; diff.push(`asosiy birlik ${cur.baseUnit}→${d.baseUnit}`); }
  }
  let syncVariants = !!d.variants;
  if (!!d.variants && !cur.isVariable) {
    if (await stockedAnywhere(tx, cur.id)) { warn(`${cur.sku}: variantli ko'rinishga o'tkazilmadi — asosiy qatorda qoldiq bor (avval 0 ga keltiring); variantlar qo'shilmadi`); syncVariants = false; }
    else { set.isVariable = true; set.retailPrice = 0; diff.push('variantli'); }
  }
  if (!d.variants && cur.retailPrice === 0 && d.retailPrice) { set.retailPrice = d.retailPrice; diff.push(`narx ${d.retailPrice}`); }

  // Mahsulot darajasidagi konversiyalar (narx saqlanadi, koeffitsient tuzatiladi)
  const convs = await tx.select().from(schema.unitConversions).where(and(eq(schema.unitConversions.productId, cur.id), isNull(schema.unitConversions.variantId)));
  for (const c of d.conversions ?? []) {
    const ex = convs.find((x) => x.unit === c.unit);
    if (!ex) { await tx.insert(schema.unitConversions).values({ productId: cur.id, unit: c.unit, factor: c.factor, price: c.price ?? null }); diff.push(`+${c.unit} = ${c.factor}`); }
    else if (num(ex.factor) !== c.factor) { await tx.update(schema.unitConversions).set({ factor: c.factor }).where(eq(schema.unitConversions.id, ex.id)); diff.push(`${c.unit} ${num(ex.factor)}→${c.factor}`); }
  }
  for (const b of d.barcodes ?? []) if (!barcodes.has(lower(b))) { await tx.insert(schema.productBarcodes).values({ productId: cur.id, barcode: b }); barcodes.add(lower(b)); diff.push(`shtrix ${b}`); }

  // Variantlar: SKU, bo'lmasa nom kaliti bo'yicha moslanadi; narx saqlanadi, kg koeffitsienti tuzatiladi
  const vconvs = await tx.select().from(schema.unitConversions).where(and(eq(schema.unitConversions.productId, cur.id), eq(schema.unitConversions.unit, 'kg')));
  let added = 0;
  for (const [i, v] of (syncVariants ? d.variants ?? [] : []).entries()) {
    const match = variants.find((x) => lower(x.sku) === lower(v.sku)) ?? variants.find((x) => vkey(x.name) === vkey(v.name));
    if (!match) {
      if (variantSkus.has(lower(v.sku))) { warn(`${cur.sku} / ${v.name}: variant SKU ${v.sku} band — qo'shilmadi`); continue; }
      const [row] = await tx.insert(schema.productVariants).values({ productId: cur.id, name: v.name, sku: v.sku, retailPrice: v.retailPrice, sortOrder: i }).returning({ id: schema.productVariants.id });
      variantSkus.add(lower(v.sku));
      if (v.kg != null) await tx.insert(schema.unitConversions).values({ productId: cur.id, variantId: row.id, unit: 'kg', factor: v.kg });
      added++;
      continue;
    }
    const vset: Partial<VariantRow> = {};
    if (match.name !== v.name) { vset.name = v.name; diff.push(`variant "${match.name}" → "${v.name}"`); }
    if (lower(match.sku) !== lower(v.sku)) {
      if (variantSkus.has(lower(v.sku))) warn(`${cur.sku} / ${v.name}: SKU ${match.sku}→${v.sku} o'zgartirilmadi (band)`);
      else { vset.sku = v.sku; variantSkus.delete(lower(match.sku)); variantSkus.add(lower(v.sku)); diff.push(`variant SKU ${match.sku}→${v.sku}`); }
    }
    if (match.sortOrder !== i) vset.sortOrder = i;
    if (Object.keys(vset).length) await tx.update(schema.productVariants).set(vset).where(eq(schema.productVariants.id, match.id));
    if (v.kg != null) {
      const kc = vconvs.find((x) => x.variantId === match.id);
      if (!kc) { await tx.insert(schema.unitConversions).values({ productId: cur.id, variantId: match.id, unit: 'kg', factor: v.kg }); diff.push(`${v.name}: +kg`); }
      else if (Math.abs(num(kc.factor)! - v.kg) > 1e-6) { await tx.update(schema.unitConversions).set({ factor: v.kg }).where(eq(schema.unitConversions.id, kc.id)); diff.push(`${v.name}: kg ${num(kc.factor)}→${v.kg}`); }
    }
  }
  if (added) diff.push(`+${added} variant`);
  // Har qanday o'zgarishda versiya oshadi — ochiq turgan eski forma saqlanganda sinxronlashni jimgina qaytarib yubormasin
  if (diff.length || Object.keys(set).length) await tx.update(schema.products).set({ ...set, version: sql`${schema.products.version} + 1` }).where(eq(schema.products.id, cur.id));
  if (diff.length) upd(`${cur.sku} "${d.name}": ${diff.join('; ')}`);
}

try {
  await db.transaction(async (tx) => {
    await syncUnits(tx);
    const catByName = await syncCategories(tx);
    await syncPresets(tx, catByName);
    await syncNameLists(tx);
    if (WITH_PRODUCTS) await syncProducts(tx, catByName);
    if (!APPLY) throw new DryRun();
  });
} catch (e) {
  if (!(e instanceof DryRun)) { console.error(log.join('\n')); console.error('XATO:', e); await pool.end(); process.exit(1); }
}
console.log(log.length ? log.join('\n') : "O'zgarish yo'q — katalog standartga mos");
console.log(`\n${APPLY ? 'SAQLANDI' : "QURUQ REJIM (hech narsa saqlanmadi; saqlash uchun --apply)"}: +${stat.add} qo'shildi, ~${stat.upd} yangilandi, -${stat.del} o'chirildi, !${stat.warn} ogohlantirish${WITH_PRODUCTS ? '' : ' (mahsulotlar: --products bilan)'}`);
await pool.end();
