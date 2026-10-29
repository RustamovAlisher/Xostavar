import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import {
  businessRules, categories, customerGroups, customers, expenseCategories, expenses, paymentMethods, products,
  saleLines, salePayments, sizePresets, stockReceiptLines, storeSettings, suppliers, unitConversions, units,
} from '../../../entities/index.js';

export type StoreSettingsRow = typeof storeSettings.$inferSelect;
export type BusinessRulesRow = typeof businessRules.$inferSelect;
export type UnitRow = typeof units.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type SizePresetRow = typeof sizePresets.$inferSelect;
export type CustomerGroupRow = typeof customerGroups.$inferSelect;
export type PaymentMethodRow = typeof paymentMethods.$inferSelect;
export type SupplierRow = typeof suppliers.$inferSelect;
export type ExpenseCategoryRow = typeof expenseCategories.$inferSelect;

export type StoreSettingsValues = Omit<typeof storeSettings.$inferInsert, 'id' | 'version'>;
export type BusinessRulesValues = Omit<typeof businessRules.$inferInsert, 'id' | 'version'>;
export type UnitValues = Omit<typeof units.$inferInsert, 'id'>;
export type CategoryValues = Omit<typeof categories.$inferInsert, 'id' | 'version' | 'createdAt'>;
export type SizePresetValues = typeof sizePresets.$inferInsert;
export type PaymentMethodValues = Omit<typeof paymentMethods.$inferInsert, 'id' | 'version'>;

/** Nomli lug'atlar (guruh, yetkazib beruvchi, xarajat kategoriyasi) — bir xil `id/name/sortOrder` sxema. */
const NAMED = { customerGroups, suppliers, expenseCategories } as const;
export type NamedTable = keyof typeof NAMED;

/**
 * Sozlamalar lug'atlari bo'yicha barcha SQL. Tekshiruvlar, xatolar va audit — servisda.
 * Saqlash metodlari faqat tranzaksiya ichida chaqiriladi (`tx` birinchi), o'qish metodlari `tx` siz ham ishlaydi.
 */
@Injectable()
export class SettingsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /* ───────── O'qish ───────── */

  /** Barcha lug'atlar: 9 ta kichik so'rov parallel. */
  allRows(tx: DbOrTx = this.db) {
    return Promise.all([
      tx.select().from(storeSettings).limit(1).then((r) => r[0]),
      tx.select().from(businessRules).limit(1).then((r) => r[0]),
      tx.select().from(units).orderBy(asc(units.sortOrder), asc(units.id)),
      tx.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.createdAt)),
      tx.select().from(sizePresets).orderBy(asc(sizePresets.sortOrder)),
      tx.select().from(customerGroups).orderBy(asc(customerGroups.sortOrder)),
      tx.select().from(paymentMethods).orderBy(asc(paymentMethods.sortOrder)),
      tx.select().from(suppliers).orderBy(asc(suppliers.name)),
      tx.select().from(expenseCategories).orderBy(asc(expenseCategories.sortOrder)),
    ]);
  }

  rules(tx: DbOrTx = this.db): Promise<BusinessRulesRow> {
    return tx.select().from(businessRules).limit(1).then((r) => r[0]);
  }

  /* ───────── Do'kon va qoidalar (bitta qator, id = 1) ───────── */

  upsertStore(tx: DbOrTx, v: StoreSettingsValues) {
    return tx.insert(storeSettings).values({ id: 1, ...v }).onConflictDoUpdate({ target: storeSettings.id, set: { ...v, version: sql`${storeSettings.version} + 1` } });
  }

  upsertRules(tx: DbOrTx, v: BusinessRulesValues) {
    return tx.insert(businessRules).values({ id: 1, ...v }).onConflictDoUpdate({ target: businessRules.id, set: { ...v, version: sql`${businessRules.version} + 1` } });
  }

  /* ───────── Birliklar ───────── */

  upsertUnit(tx: DbOrTx, id: string, v: UnitValues) {
    return tx.insert(units).values({ id, ...v }).onConflictDoUpdate({ target: units.id, set: v });
  }

  unitIdsNotIn(tx: DbOrTx, keep: string[]): Promise<string[]> {
    return tx.select({ id: units.id }).from(units).where(notInArray(units.id, keep)).then((r) => r.map((x) => x.id));
  }

  /** Birlik ishlatilayotganmi: mahsulot, konversiya, chek qatori, kirim qatori (birinchi topilganda to'xtaydi). */
  async unitInUse(tx: DbOrTx, id: string): Promise<boolean> {
    return !!(
      (await tx.select({ n: products.id }).from(products).where(eq(products.baseUnit, id)).limit(1)).length ||
      (await tx.select({ n: unitConversions.id }).from(unitConversions).where(eq(unitConversions.unit, id)).limit(1)).length ||
      (await tx.select({ n: saleLines.id }).from(saleLines).where(eq(saleLines.unit, id)).limit(1)).length ||
      (await tx.select({ n: stockReceiptLines.id }).from(stockReceiptLines).where(eq(stockReceiptLines.unit, id)).limit(1)).length
    );
  }

  deleteUnits(tx: DbOrTx, ids: string[]) {
    return tx.delete(units).where(inArray(units.id, ids));
  }

  /* ───────── Kategoriyalar ───────── */

  /** `keepIds` bo'sh bo'lsa — hammasi o'chiriladigan hisoblanadi. */
  categoriesNotIn(tx: DbOrTx, keepIds: string[]) {
    return tx.select({ id: categories.id, name: categories.name }).from(categories).where(keepIds.length ? notInArray(categories.id, keepIds) : sql`true`);
  }

  /** Kategoriyadagi (o'chirilmagan) birinchi mahsulot nomi yoki null. */
  productInCategory(tx: DbOrTx, categoryId: string): Promise<string | null> {
    return tx.select({ name: products.name }).from(products).where(and(eq(products.categoryId, categoryId), isNull(products.deletedAt))).limit(1).then((r) => r[0]?.name ?? null);
  }

  deleteCategories(tx: DbOrTx, ids: string[]) {
    return tx.delete(categories).where(inArray(categories.id, ids));
  }

  /** Mavjud bo'lsa yangilaydi (version+1) va true; yo'q bo'lsa false. */
  updateCategory(tx: DbOrTx, id: string, v: CategoryValues): Promise<boolean> {
    return tx.update(categories).set({ ...v, version: sql`${categories.version} + 1` }).where(eq(categories.id, id)).returning({ id: categories.id }).then((r) => r.length > 0);
  }

  insertCategory(tx: DbOrTx, id: string | undefined, v: CategoryValues): Promise<string> {
    return tx.insert(categories).values(id ? { id, ...v } : v).returning({ id: categories.id }).then((r) => r[0].id);
  }

  /* ───────── Andozalar ───────── */

  /** Hammasi o'chirilib qaytadan yoziladi (kichik lug'at). */
  async replaceSizePresets(tx: DbOrTx, rows: SizePresetValues[]) {
    await tx.delete(sizePresets);
    if (rows.length) await tx.insert(sizePresets).values(rows);
  }

  /* ───────── To'lov usullari ───────── */

  allPaymentMethods(tx: DbOrTx): Promise<PaymentMethodRow[]> {
    return tx.select().from(paymentMethods);
  }

  paymentMethodUsedInSales(tx: DbOrTx, methodId: string): Promise<boolean> {
    return tx.select({ id: salePayments.id }).from(salePayments).where(eq(salePayments.methodId, methodId)).limit(1).then((r) => r.length > 0);
  }

  paymentMethodUsedInExpenses(tx: DbOrTx, methodId: string): Promise<boolean> {
    return tx.select({ id: expenses.id }).from(expenses).where(eq(expenses.methodId, methodId)).limit(1).then((r) => r.length > 0);
  }

  deletePaymentMethod(tx: DbOrTx, id: string) {
    return tx.delete(paymentMethods).where(eq(paymentMethods.id, id));
  }

  updatePaymentMethod(tx: DbOrTx, id: string, v: Pick<PaymentMethodValues, 'label' | 'kind' | 'enabled' | 'sortOrder' | 'icon'>) {
    return tx.update(paymentMethods).set({ ...v, version: sql`${paymentMethods.version} + 1` }).where(eq(paymentMethods.id, id));
  }

  insertPaymentMethod(tx: DbOrTx, v: PaymentMethodValues) {
    return tx.insert(paymentMethods).values(v);
  }

  /** Standart usul: kod bo'yicha bor bo'lsa qayta nomlanadi va yoqiladi, yo'q bo'lsa yaratiladi (TZ 9.3). */
  upsertDefaultPaymentMethod(tx: DbOrTx, v: PaymentMethodValues) {
    return tx.insert(paymentMethods).values(v).onConflictDoUpdate({ target: paymentMethods.code, set: { label: v.label, enabled: true, sortOrder: v.sortOrder } });
  }

  /* ───────── Nomli lug'atlar ───────── */

  /** `keep` bo'sh bo'lsa — hammasi o'chiriladigan hisoblanadi. */
  namedNotIn(tx: DbOrTx, table: NamedTable, keep: string[]) {
    const t = NAMED[table];
    return tx.select({ id: t.id, name: t.name }).from(t).where(keep.length ? notInArray(t.id, keep) : sql`true`);
  }

  deleteNamed(tx: DbOrTx, table: NamedTable, ids: string[]) {
    const t = NAMED[table];
    return tx.delete(t).where(inArray(t.id, ids));
  }

  /** Mavjud bo'lsa yangilaydi va true; yo'q bo'lsa false. */
  updateNamed(tx: DbOrTx, table: NamedTable, id: string, row: Record<string, unknown>): Promise<boolean> {
    const t = NAMED[table];
    return tx.update(t).set(row).where(eq(t.id, id)).returning({ id: t.id }).then((r) => r.length > 0);
  }

  insertNamed(tx: DbOrTx, table: NamedTable, row: Record<string, unknown>) {
    const t = NAMED[table];
    return tx.insert(t).values(row as typeof t.$inferInsert);
  }

  /** O'chirilayotgan guruhlardagi (o'chirilmagan) birinchi mijoz nomi yoki null. */
  customerInGroups(tx: DbOrTx, groupIds: string[]): Promise<string | null> {
    return tx.select({ name: customers.name }).from(customers).where(and(inArray(customers.groupId, groupIds), isNull(customers.deletedAt))).limit(1).then((r) => r[0]?.name ?? null);
  }

  /** O'chirilayotgan kategoriyalarda (storno qilinmagan) xarajat bormi. */
  expenseInCategories(tx: DbOrTx, categoryIds: string[]): Promise<boolean> {
    return tx.select({ id: expenses.id }).from(expenses).where(and(inArray(expenses.categoryId, categoryIds), isNull(expenses.voidedAt))).limit(1).then((r) => r.length > 0);
  }
}
