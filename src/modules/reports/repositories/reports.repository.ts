import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { categories, customers, debtLedger, expenseCategories, expenses, paymentMethods, productVariants, products, saleLines, salePayments, sales, stockLevels, stockReceipts, users } from '../../../entities/index.js';

export type Granularity = 'week' | 'month' | 'year';

const TZ = 'Asia/Tashkent';

/**
 * Hisobotlar uchun barcha SQL agregatlari (TZ 8.10, 9.9). Chek soniga bog'liq bo'lmagan doimiy sonli so'rovlar.
 * `scId` — filial id yoki null (barcha filiallar); ruxsat tekshiruvi servisda.
 */
@Injectable()
export class ReportsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Do'kon kuni (TZ 8.10). Vaqt zonasi literal: GROUP BY da parametr ($n) ishlatilsa Postgres ifodani tanimaydi. */
  private day(col: SQL | AnyPgColumn) {
    return sql`(${col} at time zone ${sql.raw(`'${TZ}'`)})::date`;
  }
  /** Davr boshi (hafta dushanbadan, oy, yil) do'kon vaqt zonasida — `YYYY-MM-DD` matn. `g` enum (DTO tekshiradi), parametr emas. */
  private period(col: SQL | AnyPgColumn, g: Granularity, isDate = false) {
    const local = isDate ? sql`${col}::timestamp` : sql`(${col} at time zone ${sql.raw(`'${TZ}'`)})`;
    return sql`date_trunc(${sql.raw(`'${g}'`)}, ${local})::date::text`;
  }
  private saleScope(scId: string | null) {
    return scId ? eq(sales.branchId, scId) : undefined;
  }
  /** `completed` cheklar, filial va do'kon kuni oralig'i bo'yicha. */
  private completedIn(scId: string | null, from: string, to: string) {
    const dayExpr = this.day(sales.createdAt);
    return and(this.saleScope(scId), eq(sales.status, 'completed'), gte(dayExpr, sql`${from}::date`), lte(dayExpr, sql`${to}::date`));
  }

  /* ───────── Dashboard ───────── */

  /** Kun bo'yicha: tushum (paid), cheklar, savdo summasi, foyda, yangi nasiya, qarz to'lovlari. */
  dashboardByDay(scId: string | null, from: string, to: string, tx: DbOrTx = this.db) {
    const dayExpr = this.day(sales.createdAt);
    return tx
      .select({
        day: sql<string>`${dayExpr}::text`,
        revenue: sql<number>`coalesce(sum(${sales.paidAmount}), 0)::bigint`,
        sales: sql<number>`count(case when ${sales.type} = 'sale' then 1 end)::int`,
        salesTotal: sql<number>`coalesce(sum(case when ${sales.type} = 'sale' then ${sales.totalAmount} end), 0)::bigint`,
        profit: sql<number>`coalesce(sum(case when ${sales.type} = 'sale' then ${sales.profit} end), 0)::bigint`,
        newDebt: sql<number>`coalesce(sum(${sales.remainingDebt}), 0)::bigint`,
        debtPaid: sql<number>`coalesce(sum(case when ${sales.type} = 'debt_payment' then ${sales.paidAmount} end), 0)::bigint`,
      })
      .from(sales)
      .where(this.completedIn(scId, from, to))
      .groupBy(dayExpr);
  }

  /** Kategoriya ulushi (chegirma qatorlarga mutanosib). */
  categoryShare(scId: string | null, from: string, to: string, tx: DbOrTx = this.db) {
    return tx
      .select({ categoryId: saleLines.categoryId, name: categories.name, value: sql<number>`coalesce(sum(${saleLines.lineTotal} * (case when ${sales.subtotal} > 0 then ${sales.totalAmount}::numeric / ${sales.subtotal} else 1 end)), 0)::bigint` })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .leftJoin(categories, eq(categories.id, saleLines.categoryId))
      .where(and(this.completedIn(scId, from, to), eq(sales.type, 'sale')))
      .groupBy(saleLines.categoryId, categories.name)
      .orderBy(desc(sql`sum(${saleLines.lineTotal})`));
  }

  /** Bir kunda usul bo'yicha kassaga tushgan pul. */
  paymentsOfDay(scId: string | null, day: string, tx: DbOrTx = this.db) {
    return tx
      .select({ code: salePayments.methodCode, kind: salePayments.kind, label: paymentMethods.label, sum: sql<number>`sum(${salePayments.amount})::bigint` })
      .from(salePayments)
      .innerJoin(sales, eq(sales.id, salePayments.saleId))
      .leftJoin(paymentMethods, eq(paymentMethods.id, salePayments.methodId))
      .where(and(this.saleScope(scId), eq(sales.status, 'completed'), eq(this.day(sales.createdAt), sql`${day}::date`)))
      .groupBy(salePayments.methodCode, salePayments.kind, paymentMethods.label);
  }

  /** Mijozlar qarzi: jami, qarzdorlar soni, muddati o'tganlar (mijozlar filialga bog'lanmagan). */
  debtAggregate(today: string, tx: DbOrTx = this.db) {
    return tx
      .select({ total: sql<number>`coalesce(sum(${customers.totalDebt}), 0)::bigint`, debtors: sql<number>`count(case when ${customers.totalDebt} > 0 then 1 end)::int`, overdue: sql<number>`count(case when ${customers.totalDebt} > 0 and ${customers.dueDate} < ${today}::date then 1 end)::int` })
      .from(customers)
      .where(isNull(customers.deletedAt))
      .then((r) => r[0]);
  }

  /** Ombor qiymati: tannarxda (`withCost`), aks holda sotish narxida. */
  inventoryValue(scId: string | null, withCost: boolean, tx: DbOrTx = this.db) {
    return tx
      .select({
        positions: sql<number>`count(*)::int`,
        value: withCost
          ? sql<number>`coalesce(sum(greatest(${stockLevels.stock}, 0) * coalesce(${stockLevels.costPrice}, ${productVariants.retailPrice}, ${products.retailPrice})), 0)::bigint`
          : sql<number>`coalesce(sum(greatest(${stockLevels.stock}, 0) * coalesce(${productVariants.retailPrice}, ${products.retailPrice})), 0)::bigint`,
      })
      .from(stockLevels)
      .innerJoin(products, and(eq(products.id, stockLevels.productId), isNull(products.deletedAt)))
      .leftJoin(productVariants, eq(productVariants.id, stockLevels.variantId))
      .where(scId ? eq(stockLevels.branchId, scId) : undefined)
      .then((r) => r[0]);
  }

  /** Kam qoldiq (dashboard): min_stock > 0 va stock < min_stock, nisbat bo'yicha, `limit` tagacha. */
  lowStockTop(scId: string | null, limit: number, tx: DbOrTx = this.db) {
    return tx
      .select({ productId: stockLevels.productId, variantId: stockLevels.variantId, name: products.name, variantName: productVariants.name, sku: sql<string>`coalesce(${productVariants.sku}, ${products.sku})`, unit: products.baseUnit, stock: stockLevels.stock, minStock: stockLevels.minStock })
      .from(stockLevels)
      .innerJoin(products, and(eq(products.id, stockLevels.productId), isNull(products.deletedAt)))
      .leftJoin(productVariants, eq(productVariants.id, stockLevels.variantId))
      .where(and(scId ? eq(stockLevels.branchId, scId) : undefined, sql`${stockLevels.minStock} > 0 and ${stockLevels.stock} < ${stockLevels.minStock}`))
      .orderBy(sql`${stockLevels.stock} / ${stockLevels.minStock}`)
      .limit(limit);
  }

  /** Kam qoldiq to'liq ro'yxati (filial ustuni bilan); `branchIds` — filial id, ruxsat etilgan filiallar ro'yxati yoki null (hammasi). */
  lowStockAll(branchIds: string | string[] | null, tx: DbOrTx = this.db) {
    const scope = branchIds == null ? undefined : Array.isArray(branchIds) ? inArray(stockLevels.branchId, branchIds) : eq(stockLevels.branchId, branchIds);
    return tx
      .select({ productId: stockLevels.productId, variantId: stockLevels.variantId, branchId: stockLevels.branchId, name: products.name, variantName: productVariants.name, sku: sql<string>`coalesce(${productVariants.sku}, ${products.sku})`, unit: products.baseUnit, stock: stockLevels.stock, minStock: stockLevels.minStock })
      .from(stockLevels)
      .innerJoin(products, and(eq(products.id, stockLevels.productId), isNull(products.deletedAt)))
      .leftJoin(productVariants, eq(productVariants.id, stockLevels.variantId))
      .where(and(scope, sql`${stockLevels.minStock} > 0 and ${stockLevels.stock} < ${stockLevels.minStock}`))
      .orderBy(sql`${stockLevels.stock} / ${stockLevels.minStock}`);
  }

  /** Xarajatlar: bugun, kecha, 30 kun (bekor qilinganlarsiz). */
  expenseAggregate(scId: string | null, today: string, yesterday: string, monthStart: string, tx: DbOrTx = this.db) {
    return tx
      .select({
        today: sql<number>`coalesce(sum(case when ${expenses.date} = ${today}::date then ${expenses.amount} end), 0)::bigint`,
        yesterday: sql<number>`coalesce(sum(case when ${expenses.date} = ${yesterday}::date then ${expenses.amount} end), 0)::bigint`,
        month: sql<number>`coalesce(sum(case when ${expenses.date} >= ${monthStart}::date then ${expenses.amount} end), 0)::bigint`,
      })
      .from(expenses)
      .where(and(scId ? eq(expenses.branchId, scId) : undefined, isNull(expenses.voidedAt), gte(expenses.date, monthStart), lte(expenses.date, today)))
      .then((r) => r[0]);
  }

  /** Xarajatlar kategoriya bo'yicha (dashboard 30 kun va foyda-zarar). */
  expensesByCategory(scId: string | null, from: string, to: string, tx: DbOrTx = this.db) {
    return tx
      .select({ categoryId: expenses.categoryId, name: expenseCategories.name, value: sql<number>`sum(${expenses.amount})::bigint` })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(and(scId ? eq(expenses.branchId, scId) : undefined, isNull(expenses.voidedAt), gte(expenses.date, from), lte(expenses.date, to)))
      .groupBy(expenses.categoryId, expenseCategories.name)
      .orderBy(desc(sql`sum(${expenses.amount})`));
  }

  /** Bir kunda sotilganning tannarxi (tannarx yo'q qatorlar uchun sotish narxi olinadi — foyda 0). */
  soldCostOfDay(scId: string | null, day: string, tx: DbOrTx = this.db): Promise<number> {
    return tx
      .select({ cost: sql<number>`coalesce(sum(${saleLines.baseQty} * coalesce(${saleLines.costPerBase}, case when ${saleLines.baseQty} > 0 then ${saleLines.lineTotal} / ${saleLines.baseQty} else 0 end)), 0)::bigint` })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(and(this.saleScope(scId), eq(sales.status, 'completed'), eq(sales.type, 'sale'), eq(this.day(sales.createdAt), sql`${day}::date`)))
      .then((r) => r[0].cost);
  }

  /** Bir kundagi kirim hujjatlari jami tannarxi. */
  stockInCostOfDay(scId: string | null, day: string, tx: DbOrTx = this.db): Promise<number> {
    return tx
      .select({ cost: sql<number>`coalesce(sum(${stockReceipts.totalCost}), 0)::bigint` })
      .from(stockReceipts)
      .where(and(scId ? eq(stockReceipts.branchId, scId) : undefined, eq(stockReceipts.date, day)))
      .then((r) => r[0].cost);
  }

  /* ───────── Davr hisobotlari ───────── */

  /** Kunlik tushum va foyda (TZ 9.9 revenue), kun bo'yicha tartiblangan. */
  revenueByDay(scId: string | null, from: string, to: string, tx: DbOrTx = this.db) {
    const dayExpr = this.day(sales.createdAt);
    return tx
      .select({
        day: sql<string>`${dayExpr}::text`,
        revenue: sql<number>`coalesce(sum(${sales.paidAmount}), 0)::bigint`,
        receipts: sql<number>`count(case when ${sales.type} = 'sale' then 1 end)::int`,
        salesTotal: sql<number>`coalesce(sum(case when ${sales.type} = 'sale' then ${sales.totalAmount} end), 0)::bigint`,
        profit: sql<number>`coalesce(sum(case when ${sales.type} = 'sale' then ${sales.profit} end), 0)::bigint`,
        nasiya: sql<number>`coalesce(sum(${sales.remainingDebt}), 0)::bigint`,
      })
      .from(sales)
      .where(this.completedIn(scId, from, to))
      .groupBy(dayExpr)
      .orderBy(dayExpr);
  }

  /** Eng ko'p sotilgan mahsulotlar (summa bo'yicha). */
  topProducts(scId: string | null, from: string, to: string, limit: number, tx: DbOrTx = this.db) {
    return tx
      .select({
        productId: saleLines.productId, variantId: saleLines.variantId, name: sql<string>`max(${saleLines.name})`, variantName: sql<string | null>`max(${saleLines.variantName})`, sku: sql<string>`max(${saleLines.sku})`,
        qtyBase: sql<number>`sum(${saleLines.baseQty})::numeric`, total: sql<number>`sum(${saleLines.lineTotal})::bigint`, lines: sql<number>`count(*)::int`,
        profit: sql<number>`coalesce(sum(${saleLines.lineTotal} - ${saleLines.baseQty} * coalesce(${saleLines.costPerBase}, 0)), 0)::bigint`,
      })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(and(this.completedIn(scId, from, to), eq(sales.type, 'sale')))
      .groupBy(saleLines.productId, saleLines.variantId)
      .orderBy(desc(sql`sum(${saleLines.lineTotal})`))
      .limit(limit);
  }

  /** Kassirlar: cheklar, savdo, tushum, storno (oraliqdagi barcha statuslar). */
  cashiers(scId: string | null, from: string, to: string, tx: DbOrTx = this.db) {
    const dayExpr = this.day(sales.createdAt);
    return tx
      .select({ cashierId: sales.cashierId, name: users.name, receipts: sql<number>`count(case when ${sales.type} = 'sale' and ${sales.status} = 'completed' then 1 end)::int`, total: sql<number>`coalesce(sum(case when ${sales.type} = 'sale' and ${sales.status} = 'completed' then ${sales.totalAmount} end), 0)::bigint`, paid: sql<number>`coalesce(sum(case when ${sales.status} = 'completed' then ${sales.paidAmount} end), 0)::bigint`, voided: sql<number>`count(case when ${sales.status} = 'voided' then 1 end)::int` })
      .from(sales)
      .innerJoin(users, eq(users.id, sales.cashierId))
      .where(and(this.saleScope(scId), gte(dayExpr, sql`${from}::date`), lte(dayExpr, sql`${to}::date`)))
      .groupBy(sales.cashierId, users.name)
      .orderBy(desc(sql`sum(${sales.paidAmount})`));
  }

  /** Qarzdorlar, muddati o'tgan kunlari bilan (eng ko'p kechikkan birinchi). */
  debtors(today: string, tx: DbOrTx = this.db) {
    return tx
      .select({ id: customers.id, name: customers.name, phone: customers.phone, totalDebt: customers.totalDebt, creditLimit: customers.creditLimit, dueDate: customers.dueDate, lastPaidDate: customers.lastPaidDate, overdueDays: sql<number>`greatest(0, ${today}::date - ${customers.dueDate})::int` })
      .from(customers)
      .where(and(isNull(customers.deletedAt), sql`${customers.totalDebt} > 0`))
      .orderBy(desc(sql`${today}::date - ${customers.dueDate}`), desc(customers.totalDebt));
  }

  /** To'lovlar usul bo'yicha (summa va soni). */
  paymentsByMethod(scId: string | null, from: string, to: string, tx: DbOrTx = this.db) {
    return tx
      .select({ method: salePayments.methodCode, kind: salePayments.kind, label: paymentMethods.label, sum: sql<number>`sum(${salePayments.amount})::bigint`, count: sql<number>`count(*)::int` })
      .from(salePayments)
      .innerJoin(sales, eq(sales.id, salePayments.saleId))
      .leftJoin(paymentMethods, eq(paymentMethods.id, salePayments.methodId))
      .where(this.completedIn(scId, from, to))
      .groupBy(salePayments.methodCode, salePayments.kind, paymentMethods.label)
      .orderBy(desc(sql`sum(${salePayments.amount})`));
  }

  /** Davr bo'yicha savdo jami, foyda va cheklar soni (foyda-zarar). */
  salesSummary(scId: string | null, from: string, to: string, tx: DbOrTx = this.db) {
    return tx
      .select({ salesTotal: sql<number>`coalesce(sum(${sales.totalAmount}), 0)::bigint`, profit: sql<number>`coalesce(sum(${sales.profit}), 0)::bigint`, receipts: sql<number>`count(*)::int` })
      .from(sales)
      .where(and(this.completedIn(scId, from, to), eq(sales.type, 'sale')))
      .then((r) => r[0]);
  }

  /* ───────── Davrlar bo'yicha dinamika (hafta / oy / yil) ───────── */

  /** Cheklar davr bo'yicha: tushum, cheklar, savdo, chegirma, foyda, yangi nasiya, qarz to'lovlari. */
  salesByPeriod(scId: string | null, from: string, to: string, g: Granularity, tx: DbOrTx = this.db) {
    const p = this.period(sales.createdAt, g);
    return tx
      .select({
        period: p,
        revenue: sql<number>`coalesce(sum(${sales.paidAmount}), 0)::bigint`,
        receipts: sql<number>`count(case when ${sales.type} = 'sale' then 1 end)::int`,
        salesTotal: sql<number>`coalesce(sum(case when ${sales.type} = 'sale' then ${sales.totalAmount} end), 0)::bigint`,
        discount: sql<number>`coalesce(sum(case when ${sales.type} = 'sale' then ${sales.discountAmount} end), 0)::bigint`,
        profit: sql<number>`coalesce(sum(case when ${sales.type} = 'sale' then ${sales.profit} end), 0)::bigint`,
        newDebt: sql<number>`coalesce(sum(${sales.remainingDebt}), 0)::bigint`,
        debtPaid: sql<number>`coalesce(sum(case when ${sales.type} = 'debt_payment' then ${sales.paidAmount} end), 0)::bigint`,
      })
      .from(sales)
      .where(this.completedIn(scId, from, to))
      .groupBy(p)
      .orderBy(p);
  }

  /** Xarajatlar davr bo'yicha (bekor qilinganlarsiz). */
  expensesByPeriod(scId: string | null, from: string, to: string, g: Granularity, tx: DbOrTx = this.db) {
    const p = this.period(expenses.date, g, true);
    return tx
      .select({ period: p, expenses: sql<number>`sum(${expenses.amount})::bigint`, fromRegister: sql<number>`coalesce(sum(case when ${expenses.source} = 'cash_register' then ${expenses.amount} end), 0)::bigint` })
      .from(expenses)
      .where(and(scId ? eq(expenses.branchId, scId) : undefined, isNull(expenses.voidedAt), gte(expenses.date, from), lte(expenses.date, to)))
      .groupBy(p)
      .orderBy(p);
  }

  /** Qarz jurnali davr bo'yicha: yangi nasiya, to'lovlar, storno/tuzatish (mijozlar umumiy; filial ixtiyoriy). */
  debtLedgerByPeriod(scId: string | null, from: string, to: string, g: Granularity, tx: DbOrTx = this.db) {
    const p = this.period(debtLedger.createdAt, g);
    const dayExpr = this.day(debtLedger.createdAt);
    return tx
      .select({
        period: p,
        newDebt: sql<number>`coalesce(sum(case when ${debtLedger.type} = 'sale_debt' then ${debtLedger.amount} end), 0)::bigint`,
        paid: sql<number>`coalesce(sum(case when ${debtLedger.type} = 'payment' then -${debtLedger.amount} end), 0)::bigint`,
        other: sql<number>`coalesce(sum(case when ${debtLedger.type} in ('sale_void', 'adjustment') then ${debtLedger.amount} end), 0)::bigint`,
        net: sql<number>`coalesce(sum(${debtLedger.amount}), 0)::bigint`,
      })
      .from(debtLedger)
      .where(and(scId ? eq(debtLedger.branchId, scId) : undefined, gte(dayExpr, sql`${from}::date`), lte(dayExpr, sql`${to}::date`)))
      .groupBy(p)
      .orderBy(p);
  }

  /** Davr boshigacha bo'lgan umumiy qarz balansi (jurnal yig'indisi) — dinamika chizig'ining boshlang'ich nuqtasi. */
  debtBalanceBefore(scId: string | null, from: string, tx: DbOrTx = this.db): Promise<number> {
    return tx
      .select({ sum: sql<number>`coalesce(sum(${debtLedger.amount}), 0)::bigint` })
      .from(debtLedger)
      .where(and(scId ? eq(debtLedger.branchId, scId) : undefined, sql`${this.day(debtLedger.createdAt)} < ${from}::date`))
      .then((r) => r[0].sum);
  }

  /** Qarz holati: jami, qarzdorlar, muddati o'tgan (soni va summasi), 7 kun ichida muddati keladiganlar. */
  debtSummary(today: string, tx: DbOrTx = this.db) {
    const soon = sql`${today}::date + 7`;
    return tx
      .select({
        total: sql<number>`coalesce(sum(${customers.totalDebt}), 0)::bigint`,
        debtors: sql<number>`count(*)::int`,
        overdueCount: sql<number>`count(case when ${customers.dueDate} < ${today}::date then 1 end)::int`,
        overdueSum: sql<number>`coalesce(sum(case when ${customers.dueDate} < ${today}::date then ${customers.totalDebt} end), 0)::bigint`,
        dueSoonCount: sql<number>`count(case when ${customers.dueDate} >= ${today}::date and ${customers.dueDate} <= ${soon} then 1 end)::int`,
        dueSoonSum: sql<number>`coalesce(sum(case when ${customers.dueDate} >= ${today}::date and ${customers.dueDate} <= ${soon} then ${customers.totalDebt} end), 0)::bigint`,
        creditLimit: sql<number>`coalesce(sum(${customers.creditLimit}), 0)::bigint`,
      })
      .from(customers)
      .where(and(isNull(customers.deletedAt), sql`${customers.totalDebt} > 0`))
      .then((r) => r[0]);
  }

  /** Xarajatlar to'lov usuli bo'yicha (kassa oqimi chiqimi). */
  expensesByMethod(scId: string | null, from: string, to: string, tx: DbOrTx = this.db) {
    return tx
      .select({ method: paymentMethods.code, label: paymentMethods.label, sum: sql<number>`sum(${expenses.amount})::bigint` })
      .from(expenses)
      .innerJoin(paymentMethods, eq(paymentMethods.id, expenses.methodId))
      .where(and(scId ? eq(expenses.branchId, scId) : undefined, isNull(expenses.voidedAt), gte(expenses.date, from), lte(expenses.date, to)))
      .groupBy(paymentMethods.code, paymentMethods.label);
  }
}

/* Qator turlari — so'rov shaklidan chiqariladi (mapper shularni oladi). */
type Result<K extends keyof ReportsRepository> = Awaited<ReturnType<ReportsRepository[K]>>;
export type DashboardDayRow = Result<'dashboardByDay'>[number];
export type CategoryShareRow = Result<'categoryShare'>[number];
export type PaymentDayRow = Result<'paymentsOfDay'>[number];
export type DebtAggRow = Result<'debtAggregate'>;
export type InventoryValueRow = Result<'inventoryValue'>;
export type LowStockRow = Result<'lowStockTop'>[number];
export type ExpenseAggRow = Result<'expenseAggregate'>;
export type ExpenseByCategoryRow = Result<'expensesByCategory'>[number];
export type RevenueDayRow = Result<'revenueByDay'>[number];
export type ProductReportRow = Result<'topProducts'>[number];
export type DebtorRow = Result<'debtors'>[number];
export type PaymentRow = Result<'paymentsByMethod'>[number];
export type SalesSummaryRow = Result<'salesSummary'>;
export type ExpenseByMethodRow = Result<'expensesByMethod'>[number];
export type SalesPeriodRow = Result<'salesByPeriod'>[number];
export type ExpensePeriodRow = Result<'expensesByPeriod'>[number];
export type DebtLedgerPeriodRow = Result<'debtLedgerByPeriod'>[number];
export type DebtSummaryRow = Result<'debtSummary'>;
