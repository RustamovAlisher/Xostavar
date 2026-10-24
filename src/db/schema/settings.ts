import { boolean, integer, jsonb, numeric, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, factor, id, money, qty, updatedAt, version } from './common.js';
import { sqlLower } from './branches.js';

/** Do'kon rekvizitlari (bitta qator, TZ 7.2). Filialniki bo'lmasa shu ishlatiladi. */
export const storeSettings = pgTable('store_settings', {
  id: integer('id').primaryKey().default(1),
  name: text('name').notNull(),
  subtitle: text('subtitle').notNull().default(''),
  address: text('address').notNull().default(''),
  phone: text('phone').notNull().default(''),
  taxId: text('tax_id').notNull().default(''),
  receiptFooter: text('receipt_footer').notNull().default(''),
  printFormat: text('print_format', { enum: ['thermal', 'a4'] }).notNull().default('thermal'),
  paperWidthMm: smallint('paper_width_mm').notNull().default(80),
  version: version(),
  updatedAt: updatedAt(),
});

/** Biznes qoidalari (bitta qator, TZ 7.2). */
export const businessRules = pgTable('business_rules', {
  id: integer('id').primaryKey().default(1),
  pieceLengthMeters: numeric('piece_length_meters', { precision: 10, scale: 3, mode: 'number' }).notNull().default(11.7),
  defaultCutLengthMeters: numeric('default_cut_length_meters', { precision: 10, scale: 3, mode: 'number' }).notNull().default(6),
  cutDeductionMode: text('cut_deduction_mode', { enum: ['net', 'bars'] }).notNull().default('net'),
  defaultMinStock: qty('default_min_stock').notNull().default(0),
  defaultCreditDays: integer('default_credit_days').notNull().default(30),
  defaultCreditLimit: money('default_credit_limit').notNull().default(5_000_000),
  vatPct: numeric('vat_pct', { precision: 5, scale: 2, mode: 'number' }).notNull().default(12),
  estimatedMarginPct: numeric('estimated_margin_pct', { precision: 5, scale: 2, mode: 'number' }).notNull().default(16),
  quickDownPaymentPcts: integer('quick_down_payment_pcts').array().notNull().default([25, 50]),
  allowNegativeStock: boolean('allow_negative_stock').notNull().default(false),
  requireShift: boolean('require_shift').notNull().default(true),
  /** 0 = cheklanmagan. */
  cashierMaxDiscount: money('cashier_max_discount').notNull().default(0),
  version: version(),
  updatedAt: updatedAt(),
});

/** O'lchov birliklari: id matn (piece, kg, meter...), frontend bilan bir xil (TZ 7.2). */
export const units = pgTable(
  'units',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    short: text('short').notNull(),
    precision: smallint('precision').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('units_short_lower_uq').on(sqlLower(t.short))],
);

export const categories = pgTable(
  'categories',
  {
    id: id(),
    name: text('name').notNull(),
    icon: text('icon').notNull().default('📦'),
    description: text('description').notNull().default(''),
    defaultBaseUnit: text('default_base_unit')
      .notNull()
      .references(() => units.id, { onDelete: 'restrict' }),
    defaultIsDivisible: boolean('default_is_divisible').notNull().default(false),
    /** [{unit, factor}] — yangi mahsulot uchun shablon. */
    defaultConversions: jsonb('default_conversions').$type<{ unit: string; factor: number }[]>().notNull().default([]),
    sortOrder: integer('sort_order').notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('categories_name_lower_uq').on(sqlLower(t.name))],
);

export const sizePresets = pgTable(
  'size_presets',
  {
    id: id(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kgPerMeter: factor('kg_per_meter'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('size_presets_cat_name_uq').on(t.categoryId, sqlLower(t.name))],
);

export const customerGroups = pgTable(
  'customer_groups',
  {
    id: id(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('customer_groups_name_lower_uq').on(sqlLower(t.name))],
);

/** Dinamik to'lov usullari (TZ 7.2). Tizim usullari (cash, card, transfer, debt) o'chirilmaydi. */
export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: id(),
    code: text('code').notNull(),
    label: text('label').notNull(),
    kind: text('kind', { enum: ['cash', 'card', 'transfer', 'other', 'debt'] }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    system: boolean('system').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('payment_methods_code_uq').on(t.code), uniqueIndex('payment_methods_label_lower_uq').on(sqlLower(t.label))],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    name: text('name').notNull(),
    phone: text('phone'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('suppliers_name_lower_uq').on(sqlLower(t.name))],
);

export const expenseCategories = pgTable(
  'expense_categories',
  {
    id: id(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('expense_categories_name_lower_uq').on(sqlLower(t.name))],
);
