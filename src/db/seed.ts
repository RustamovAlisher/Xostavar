import 'dotenv/config';
import argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../entities/index.js';
import { DEFAULT_ROLES, DEFAULT_SETTINGS } from '../modules/settings/constants/settings.defaults.js';
import { DEMO_PRODUCTS } from './demo-products.js';

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

  // Qo'shimcha rejim: mavjud bazaga yetishmayotgan kategoriya va o'lcham andozalari qo'shiladi, borlari o'zgarmaydi
  await tx.insert(schema.categories).values(D.categories.map((c, i) => ({ ...c, sortOrder: i }))).onConflictDoNothing();
  const allCats = await tx.select().from(schema.categories);
  const catByName = new Map(allCats.map((c) => [c.name, c.id]));
  const presetRows = D.sizePresets
    .filter((s) => catByName.has(s.category))
    .map((s, i) => ({ categoryId: catByName.get(s.category)!, name: s.name, kgPerMeter: s.kgPerMeter ?? null, sortOrder: i }));
  if (presetRows.length) await tx.insert(schema.sizePresets).values(presetRows).onConflictDoNothing();
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
    // Ishlab chiqarishda birinchi administrator paroli ADMIN_PASSWORD dan (bo'lmasa 1234) — birinchi kirishda almashtirish majburiy
    const initial = process.env.ADMIN_PASSWORD?.trim() || '1234';
    const hash = await argon2.hash(initial, { type: argon2.argon2id });
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
        .values({ name: p.name, username: p.username, email: p.email, roleId: role.id, permissions: role.permissions, passwordHash: hash })
        .returning({ id: schema.users.id });
      if (!role.allBranches) await tx.insert(schema.userBranches).values({ userId: u.id, branchId: mainId, isDefault: true });
    }
    console.log(`${people.length} ta foydalanuvchi yaratildi (parol: ${process.env.ADMIN_PASSWORD?.trim() ? 'ADMIN_PASSWORD' : '1234'})`);
  }

  // Namuna mahsulotlar — real do'kon assortimenti (`demo-products.ts`), faqat demo va katalog bo'sh bo'lsa
  const [{ pn }] = await tx.select({ pn: sql<number>`count(*)::int` }).from(schema.products);
  if (demo && pn === 0) {
    const cat = (name: string) => {
      const id = catByName.get(name);
      if (!id) throw new Error(`Seed: kategoriya topilmadi: ${name}`);
      return id;
    };
    const items = DEMO_PRODUCTS;
    for (const it of items) {
      const [p] = await tx
        .insert(schema.products)
        .values({ name: it.name, categoryId: cat(it.category), sku: it.sku, baseUnit: it.baseUnit, isDivisible: it.isDivisible, retailPrice: it.retailPrice ?? 0, isVariable: !!it.variants })
        .returning({ id: schema.products.id });
      for (const c of it.conversions ?? []) {
        await tx.insert(schema.unitConversions).values({ productId: p.id, unit: c.unit, factor: c.factor, price: c.price ?? null });
        if (c.barcode) await tx.insert(schema.productBarcodes).values({ productId: p.id, unit: c.unit, barcode: c.barcode });
      }
      for (const b of it.barcodes ?? []) await tx.insert(schema.productBarcodes).values({ productId: p.id, barcode: b });
      for (const [i, v] of (it.variants ?? []).entries()) {
        const [row] = await tx.insert(schema.productVariants).values({ productId: p.id, name: v.name, sku: v.sku, retailPrice: v.retailPrice, sortOrder: i }).returning({ id: schema.productVariants.id });
        if ('kg' in v) await tx.insert(schema.unitConversions).values({ productId: p.id, variantId: row.id, unit: 'kg', factor: v.kg as number });
      }
    }
    console.log(`${items.length} ta namuna mahsulot yaratildi (qoldiqsiz — kirim orqali qo'shiladi)`);
  }
});

console.log('Seed tugadi');
await pool.end();
