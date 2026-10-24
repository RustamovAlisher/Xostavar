import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, deletedAt, factor, id, money, updatedAt, version } from './common.js';
import { categories, units } from './settings.js';
import { sqlLower } from './branches.js';

/**
 * Mahsulot katalogi — UMUMIY, filialga bog'liq emas (TZ 7.3).
 * Qoldiq, min. qoldiq va tannarx bu yerda emas: `stock_levels` (filial bo'yicha).
 */
export const products = pgTable(
  'products',
  {
    id: id(),
    name: text('name').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    sku: text('sku').notNull(),
    description: text('description'),
    baseUnit: text('base_unit')
      .notNull()
      .references(() => units.id, { onDelete: 'restrict' }),
    isDivisible: boolean('is_divisible').notNull().default(false),
    /** Variantsiz mahsulot uchun; variantli mahsulotda 0 (narx variantlarda). Narxsiz = sotilmaydi (TZ 14.4 (5)). */
    retailPrice: money('retail_price').notNull().default(0),
    wholesalePrice: money('wholesale_price'),
    isVariable: boolean('is_variable').notNull().default(false),
    deletedAt: deletedAt(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('products_sku_lower_uq').on(sqlLower(t.sku)),
    index('products_category_idx').on(t.categoryId),
    // Nom bo'yicha qidiruv (pg_trgm, migratsiyada kengaytma yoqiladi)
    index('products_name_trgm_idx').using('gin', sql`lower(${t.name}) gin_trgm_ops`),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sku: text('sku').notNull(),
    retailPrice: money('retail_price').notNull().default(0),
    wholesalePrice: money('wholesale_price'),
    sortOrder: integer('sort_order').notNull().default(0),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('product_variants_sku_lower_uq').on(sqlLower(t.sku)), index('product_variants_product_idx').on(t.productId)],
);

/** Shtrix-kodlar: mahsulot, variant va qadoq (unit) uchun — butun tizimda unikal (TZ 7.3). */
export const productBarcodes = pgTable(
  'product_barcodes',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
    /** Qadoq shtrix-kodi bo'lsa — qaysi birlik (masalan quti). */
    unit: text('unit').references(() => units.id, { onDelete: 'restrict' }),
    barcode: text('barcode').notNull(),
  },
  (t) => [uniqueIndex('product_barcodes_barcode_lower_uq').on(sqlLower(t.barcode)), index('product_barcodes_product_idx').on(t.productId)],
);

/** 1 `unit` = `factor` × asosiy birlik. Variantdagi yozuv otadagi bir xil birlikni ustidan yozadi. */
export const unitConversions = pgTable(
  'unit_conversions',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
    unit: text('unit')
      .notNull()
      .references(() => units.id, { onDelete: 'restrict' }),
    factor: factor('factor').notNull(),
    /** Shu birlik uchun alohida narx; bo'sh bo'lsa retail_price × factor. */
    price: money('price'),
  },
  (t) => [
    // variant_id NULL bo'lganda ham unikal bo'lishi uchun coalesce
    uniqueIndex('unit_conversions_target_unit_uq').on(t.productId, sql`coalesce(${t.variantId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.unit),
    index('unit_conversions_product_idx').on(t.productId),
  ],
);
