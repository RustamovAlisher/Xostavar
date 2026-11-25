import { bigserial, date, index, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, money } from './common.js';
import { branches } from './branches.js';
import { users } from './users.js';
import { paymentMethods, suppliers } from './settings.js';
import { products } from './catalog.js';

/**
 * Yetkazib beruvchi qaysi mahsulotlarni olib keladi (ko'pga-ko'p). Kirimda avtomatik ulanadi, kartada qo'lda ulash/uzish.
 * Kirim oynasida shu yetkazib beruvchining mahsulotlari ro'yxat boshida chiqadi.
 */
export const supplierProducts = pgTable(
  'supplier_products',
  {
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.supplierId, t.productId] }), index('supplier_products_product_idx').on(t.productId)],
);

/**
 * Yetkazib beruvchi qarzi harakati: bizning ularga qarzimiz.
 * + qarz oshishi (tovar qarzga olindi, eski qarz), − kamayishi (to'lov berildi, tuzatish).
 */
export const supplierLedger = pgTable(
  'supplier_ledger',
  {
    id: id(),
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    /** purchase — kirimdan qarz; purchase_edit — kirim tahrirlanib qarz o'zgardi; payment — to'lov; adjustment — qo'lda (eski qarz, tuzatish). */
    type: text('type', { enum: ['purchase', 'purchase_edit', 'payment', 'adjustment'] }).notNull(),
    amount: money('amount').notNull(),
    balanceAfter: money('balance_after').notNull(),
    /** Ish sanasi (kirim sanasi / to'lov sanasi). */
    date: date('date').notNull(),
    methodId: uuid('method_id').references(() => paymentMethods.id, { onDelete: 'set null' }),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    note: text('note'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('supplier_ledger_supplier_seq_idx').on(t.supplierId, t.seq), uniqueIndex('supplier_ledger_seq_uq').on(t.seq), index('supplier_ledger_ref_idx').on(t.refId)],
);
