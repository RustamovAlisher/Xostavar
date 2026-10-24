import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, id, money, qty } from './common.js';
import { branches } from './branches.js';
import { users } from './users.js';
import { customers } from './customers.js';
import { products, productVariants } from './catalog.js';
import { categories, paymentMethods, units } from './settings.js';

/** Smena (TZ 7.7): har filialda bir vaqtda faqat bitta ochiq. */
export const shifts = pgTable(
  'shifts',
  {
    id: id(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    openedBy: uuid('opened_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    openedByName: text('opened_by_name').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'restrict' }),
    closedByName: text('closed_by_name'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    openingCash: money('opening_cash').notNull().default(0),
    closingCashCounted: money('closing_cash_counted'),
    expectedCash: money('expected_cash'),
    /** Yopilganda muzlatiladi: cash, card, transfer, other, byMethod, nasiyaDebt, debtPayments, receipts, revenue, cashOut, voided. */
    totals: jsonb('totals').$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex('shifts_one_open_per_branch_uq').on(t.branchId).where(sql`${t.closedAt} is null`),
    index('shifts_branch_opened_idx').on(t.branchId, t.openedAt),
  ],
);

/** Chek (TZ 7.6): sotuv yoki qarz to'lovi. Raqam filial kodi va kun bo'yicha: MAIN-20261024-0001. */
export const sales = pgTable(
  'sales',
  {
    id: id(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    number: text('number').notNull(),
    type: text('type', { enum: ['sale', 'debt_payment'] }).notNull(),
    shiftId: uuid('shift_id').references(() => shifts.id, { onDelete: 'set null' }),
    cashierId: uuid('cashier_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    cashierName: text('cashier_name').notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    customerName: text('customer_name').notNull(),
    /** Hosila ro'yxat uchun: cash | card | transfer | other | mixed | debt (usul kodi yoki 'mixed'). */
    paymentSummary: text('payment_summary').notNull(),
    subtotal: money('subtotal').notNull(),
    discountAmount: money('discount_amount').notNull().default(0),
    totalAmount: money('total_amount').notNull(),
    /** Kassaga tushgan pul = Σ sale_payments.amount. */
    paidAmount: money('paid_amount').notNull(),
    remainingDebt: money('remaining_debt').notNull().default(0),
    customerDebtAfter: money('customer_debt_after'),
    profit: money('profit').notNull().default(0),
    vatIncluded: numeric('vat_included', { precision: 18, scale: 2, mode: 'number' }).notNull().default(0),
    status: text('status', { enum: ['completed', 'voided'] }).notNull().default('completed'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
    voidedByName: text('voided_by_name'),
    voidReason: text('void_reason'),
    /** Oflayn yaratilgan chek id si (idempotentlik, TZ 10). */
    clientId: uuid('client_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sales_number_uq').on(t.number),
    uniqueIndex('sales_client_id_uq').on(t.clientId),
    index('sales_branch_created_idx').on(t.branchId, t.createdAt),
    index('sales_shift_idx').on(t.shiftId),
    index('sales_customer_idx').on(t.customerId),
    index('sales_cashier_idx').on(t.cashierId),
  ],
);

export const saleLines = pgTable(
  'sale_lines',
  {
    id: id(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'restrict' }),
    /** Nusxalar: mahsulot keyin o'zgarsa yoki o'chirilsa chek buzilmasin. */
    name: text('name').notNull(),
    variantName: text('variant_name'),
    sku: text('sku').notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    unit: text('unit')
      .notNull()
      .references(() => units.id, { onDelete: 'restrict' }),
    qty: qty('qty').notNull(),
    baseQty: qty('base_qty').notNull(),
    unitPrice: money('unit_price').notNull(),
    lineTotal: money('line_total').notNull(),
    costPerBase: qty('cost_per_base'),
    cuts: jsonb('cuts').$type<{ lengthMeters: number; quantity: number }[]>(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('sale_lines_sale_idx').on(t.saleId), index('sale_lines_product_idx').on(t.productId)],
);

/** Chekning to'lov qismlari (aralash to'lov, TZ 7.6): Σ amount + remaining_debt = total_amount. */
export const salePayments = pgTable(
  'sale_payments',
  {
    id: id(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    methodId: uuid('method_id')
      .notNull()
      .references(() => paymentMethods.id, { onDelete: 'restrict' }),
    /** Nusxa (hisobotlar usul o'chirilsa ham ishlasin). */
    methodCode: text('method_code').notNull(),
    kind: text('kind').notNull(),
    amount: money('amount').notNull(),
    ref: text('ref'),
  },
  (t) => [index('sale_payments_sale_idx').on(t.saleId)],
);
