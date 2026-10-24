import { bigserial, date, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, id, money, qty, updatedAt, version } from './common.js';
import { branches } from './branches.js';
import { products, productVariants } from './catalog.js';
import { suppliers, units } from './settings.js';
import { users } from './users.js';

/**
 * Filial ombori (TZ 7.0.1, 7.3): qoldiq, kam qoldiq chegarasi, o'rtacha tannarx — filial bo'yicha.
 * Qator faqat birinchi kirimda yaratiladi; qatori bor mahsulot "omborda" hisoblanadi (qoldiq 0 bo'lsa ham).
 */
export const stockLevels = pgTable(
  'stock_levels',
  {
    id: id(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
    stock: qty('stock').notNull().default(0),
    minStock: qty('min_stock'),
    /** O'rtacha tannarx, asosiy birlik uchun (TZ 8.6). */
    costPrice: qty('cost_price'),
    version: version(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('stock_levels_target_uq').on(t.branchId, t.productId, sql`coalesce(${t.variantId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
    index('stock_levels_product_idx').on(t.productId),
  ],
);

/** Filial bo'yicha narx (TZ 7.3): qator bo'lmasa umumiy narx. */
export const branchPrices = pgTable(
  'branch_prices',
  {
    id: id(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
    retailPrice: money('retail_price').notNull(),
    wholesalePrice: money('wholesale_price'),
  },
  (t) => [uniqueIndex('branch_prices_target_uq').on(t.branchId, t.productId, sql`coalesce(${t.variantId}, '00000000-0000-0000-0000-000000000000'::uuid)`)],
);

/** Kirim hujjati (TZ 7.4). Raqam filial bo'yicha ketma-ket. */
export const stockReceipts = pgTable(
  'stock_receipts',
  {
    id: id(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    number: integer('number').notNull(),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    supplierName: text('supplier_name'),
    invoice: text('invoice'),
    date: date('date').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    userName: text('user_name').notNull(),
    note: text('note'),
    totalCost: qty('total_cost').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('stock_receipts_branch_number_uq').on(t.branchId, t.number), index('stock_receipts_branch_date_idx').on(t.branchId, t.date)],
);

export const stockReceiptLines = pgTable(
  'stock_receipt_lines',
  {
    id: id(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => stockReceipts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'restrict' }),
    /** Nusxa: mahsulot keyin o'zgarsa tarix buzilmasin. */
    productName: text('product_name').notNull(),
    sku: text('sku').notNull(),
    unit: text('unit')
      .notNull()
      .references(() => units.id, { onDelete: 'restrict' }),
    qty: qty('qty').notNull(),
    qtyBase: qty('qty_base').notNull(),
    costPerUnit: qty('cost_per_unit').notNull().default(0),
    costPerBase: qty('cost_per_base').notNull().default(0),
    totalCost: qty('total_cost').notNull().default(0),
  },
  (t) => [index('stock_receipt_lines_receipt_idx').on(t.receiptId), index('stock_receipt_lines_product_idx').on(t.productId)],
);

/** O'zgarmas qoldiq jurnali (TZ 7.4): stock = Σ qty_base — yaxlitlik tekshiruvi uchun. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: id(),
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'restrict' }),
    type: text('type', { enum: ['stock_in', 'sale', 'sale_void', 'adjustment', 'write_off', 'transfer_out', 'transfer_in'] }).notNull(),
    /** +/− asosiy birlikda. */
    qtyBase: qty('qty_base').notNull(),
    unit: text('unit').notNull(),
    qtyUnit: qty('qty_unit').notNull(),
    costPerBase: qty('cost_per_base'),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    balanceAfter: qty('balance_after').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('stock_movements_target_seq_idx').on(t.branchId, t.productId, t.seq), index('stock_movements_ref_idx').on(t.refId), uniqueIndex('stock_movements_seq_uq').on(t.seq)],
);
