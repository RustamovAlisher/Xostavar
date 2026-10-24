import 'dotenv/config';
import argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';
import { DEFAULT_ROLES, DEFAULT_SETTINGS } from '../modules/settings/settings.defaults.js';

/**
 * `npm run db:seed` — lug'atlar, standart rollar, bitta `main` filial (TZ 15).
 * SEED_DEMO=true (local/staging) bo'lsa demo xodimlar (parol 1234, birinchi kirishda almashtiriladi) va namuna mahsulotlar.
 * Qayta ishga tushirish xavfsiz: mavjud yozuvlar o'zgartirilmaydi.
 */
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });
const demo = (process.env.SEED_DEMO ?? 'true') === 'true' && process.env.NODE_ENV !== 'production';
const D = DEFAULT_SETTINGS;

await db.transaction(async (tx) => {
  await tx.insert(schema.storeSettings).values({ id: 1, ...D.store }).onConflictDoNothing();
  await tx.insert(schema.businessRules).values({ id: 1, ...D.rules }).onConflictDoNothing();
  await tx.insert(schema.units).values(D.units.map((u, i) => ({ ...u, sortOrder: i }))).onConflictDoNothing();

  const cats = await tx.insert(schema.categories).values(D.categories.map((c, i) => ({ ...c, sortOrder: i }))).onConflictDoNothing().returning();
  const allCats = cats.length ? cats : await tx.select().from(schema.categories);
  const catByName = new Map(allCats.map((c) => [c.name, c.id]));
  if (cats.length) {
    await tx.insert(schema.sizePresets).values(
      D.sizePresets.map((s, i) => ({ categoryId: catByName.get(s.category)!, name: s.name, kgPerMeter: s.kgPerMeter != null ? String(s.kgPerMeter) : null, sortOrder: i })),
    );
  }
  await tx.insert(schema.customerGroups).values(D.customerGroups.map((name, i) => ({ name, sortOrder: i }))).onConflictDoNothing();
  await tx.insert(schema.paymentMethods).values(D.paymentMethods.map((m, i) => ({ ...m, sortOrder: i }))).onConflictDoNothing();
  await tx.insert(schema.suppliers).values(D.suppliers.map((name) => ({ name }))).onConflictDoNothing();
  await tx.insert(schema.expenseCategories).values(D.expenseCategories.map((name, i) => ({ name, sortOrder: i }))).onConflictDoNothing();

  await tx.insert(schema.roles).values(DEFAULT_ROLES.map((r, i) => ({ ...r, sortOrder: i }))).onConflictDoNothing();
  const roles = await tx.select().from(schema.roles);
  const roleByName = new Map(roles.map((r) => [r.name, r]));

  const [main] = await tx.insert(schema.branches).values({ code: 'MAIN', name: 'Asosiy filial', isMain: true }).onConflictDoNothing().returning();
  const mainId = main?.id ?? (await tx.select({ id: schema.branches.id }).from(schema.branches).where(eq(schema.branches.code, 'MAIN')))[0].id;

  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  if (n === 0) {
    const hash = await argon2.hash('1234', { type: argon2.argon2id });
    const people = demo
      ? [
          { name: 'Alisher Navoiy', username: 'admin', email: 'admin@temirbaza.uz', role: 'Super Admin' },
          { name: 'Jasur Mirzayev', username: 'kassir', email: 'jasur@temirbaza.uz', role: 'Kassir' },
          { name: 'Baxtiyor Qodirov', username: 'omborchi', email: 'baxtiyor@temirbaza.uz', role: 'Omborchi' },
          { name: 'Sardor Buxgalter', username: 'buxgalter', email: 'sardor@temirbaza.uz', role: 'Buxgalter' },
        ]
      : [{ name: 'Administrator', username: 'admin', email: null, role: 'Super Admin' }];
    for (const p of people) {
      const role = roleByName.get(p.role)!;
      const [u] = await tx
        .insert(schema.users)
        .values({ name: p.name, username: p.username, email: p.email, roleId: role.id, permissions: role.permissions, passwordHash: hash, mustChangePassword: true })
        .returning({ id: schema.users.id });
      if (!role.allBranches) await tx.insert(schema.userBranches).values({ userId: u.id, branchId: mainId, isDefault: true });
    }
    console.log(`${people.length} ta foydalanuvchi yaratildi (parol: 1234, birinchi kirishda almashtiriladi)`);
  }

  // Namuna mahsulotlar — frontend `mockProducts` bilan bir xil (faqat demo, katalog bo'sh bo'lsa)
  const [{ pn }] = await tx.select({ pn: sql<number>`count(*)::int` }).from(schema.products);
  if (demo && pn === 0) {
    const cat = (name: string) => catByName.get(name)!;
    const meterVariant = (name: string, sku: string, kgPerM: number, price: number) => ({ name, sku, retailPrice: price, kg: Math.round((1 / kgPerM) * 10000) / 10000 });
    const items: {
      name: string; category: string; sku: string; baseUnit: string; isDivisible: boolean; retailPrice?: number; barcodes?: string[];
      conversions?: { unit: string; factor: number; price?: number; barcode?: string }[]; variants?: ReturnType<typeof meterVariant>[] | { name: string; sku: string; retailPrice: number }[];
    }[] = [
      { name: "Armatura po'lat (A500C / 25G2S)", category: 'Armatura', sku: 'ARM', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'piece', factor: 11.7 }],
        variants: [meterVariant('Ø 10 mm A500C', 'ARM-10-A500C', 0.617, 8800), meterVariant('Ø 12 mm A500C', 'ARM-12-A500C', 0.888, 12500), meterVariant('Ø 16 mm 25G2S', 'ARM-16-25G2S', 1.578, 19800)] },
      { name: "Profil truba (kvadrat va to'rtburchak)", category: 'Trubalar', sku: 'PT', baseUnit: 'meter', isDivisible: true, conversions: [{ unit: 'piece', factor: 6 }],
        variants: [meterVariant('40×20×2 mm', 'PT-40x20x2', 1.75, 24000), meterVariant('80×80×3 mm', 'PT-80x80x3', 7.1, 98000), meterVariant('100×100×4 mm', 'PT-100x100x4', 11.5, 162000)] },
      { name: 'Qurilish mixi', category: "Xo'jalik mollari", sku: 'NAIL', baseUnit: 'kg', isDivisible: true, conversions: [{ unit: 'box', factor: 5 }],
        variants: [{ name: '70 mm', sku: 'NAIL-70', retailPrice: 24000 }, { name: '100 mm', sku: 'NAIL-100', retailPrice: 22500 }, { name: '120 mm', sku: 'NAIL-120', retailPrice: 23000 }] },
      { name: 'Tunuka list 2.0 mm 1250×2500', category: 'Listlar', sku: 'TL-2.0-1250', baseUnit: 'piece', isDivisible: false, retailPrice: 925000, barcodes: ['4780012345017'], conversions: [{ unit: 'kg', factor: 0.02 }] },
      { name: 'Sement Qizilqum M500', category: 'Sement va aralashmalar', sku: 'SEM-M500-50', baseUnit: 'bag', isDivisible: false, retailPrice: 65000, barcodes: ['4780012345024'], conversions: [{ unit: 'kg', factor: 0.02, price: 1400 }] },
      { name: 'Samorez metall 3.5×35 mm', category: "Xo'jalik mollari", sku: 'SAM-3.5x35', baseUnit: 'piece', isDivisible: false, retailPrice: 35, barcodes: ['4780012345031'], conversions: [{ unit: 'box', factor: 1000, price: 28000, barcode: '4780012345048' }] },
      { name: 'Balgarka toshi (kesuvchi disk) 125×1.2 mm', category: 'Asbob-uskunalar', sku: 'DISC-125', baseUnit: 'piece', isDivisible: false, retailPrice: 9000, barcodes: ['4780012345055'], conversions: [{ unit: 'box', factor: 25, price: 210000 }] },
      { name: 'Bolgarka Makita GA5030 (720 W)', category: 'Asbob-uskunalar', sku: 'MAK-GA5030', baseUnit: 'piece', isDivisible: false, retailPrice: 1150000, barcodes: ['088381096560'] },
      { name: "Emal bo'yoq PF-115 oq", category: "Bo'yoqlar", sku: 'PF115-W', baseUnit: 'liter', isDivisible: true, retailPrice: 38000, conversions: [{ unit: 'can', factor: 2.8, price: 100000 }] },
      { name: 'Kafel 30×60 kulrang', category: 'Kafel va pol', sku: 'TILE-3060-GR', baseUnit: 'm2', isDivisible: true, retailPrice: 85000, conversions: [{ unit: 'box', factor: 1.44 }] },
    ];
    for (const it of items) {
      const [p] = await tx
        .insert(schema.products)
        .values({ name: it.name, categoryId: cat(it.category), sku: it.sku, baseUnit: it.baseUnit, isDivisible: it.isDivisible, retailPrice: it.retailPrice ?? 0, isVariable: !!it.variants })
        .returning({ id: schema.products.id });
      for (const c of it.conversions ?? []) {
        await tx.insert(schema.unitConversions).values({ productId: p.id, unit: c.unit, factor: String(c.factor), price: c.price ?? null });
        if (c.barcode) await tx.insert(schema.productBarcodes).values({ productId: p.id, unit: c.unit, barcode: c.barcode });
      }
      for (const b of it.barcodes ?? []) await tx.insert(schema.productBarcodes).values({ productId: p.id, barcode: b });
      for (const [i, v] of (it.variants ?? []).entries()) {
        const [row] = await tx.insert(schema.productVariants).values({ productId: p.id, name: v.name, sku: v.sku, retailPrice: v.retailPrice, sortOrder: i }).returning({ id: schema.productVariants.id });
        if ('kg' in v) await tx.insert(schema.unitConversions).values({ productId: p.id, variantId: row.id, unit: 'kg', factor: String(v.kg) });
      }
    }
    console.log(`${items.length} ta namuna mahsulot yaratildi (qoldiqsiz — kirim orqali qo'shiladi)`);
  }
});

console.log('Seed tugadi');
await pool.end();
