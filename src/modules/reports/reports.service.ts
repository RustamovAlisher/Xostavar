import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module.js';
import { categories, customers, expenseCategories, expenses, paymentMethods, productVariants, products, saleLines, salePayments, sales, stockLevels, stockReceipts, users } from '../../db/schema/index.js';
import type { AuthUser } from '../../common/auth-context.js';
import { forbidden } from '../../common/errors.js';
import { addDays, todayISO } from '../../common/numbers.js';

const TZ = 'Asia/Tashkent';

/**
 * Hisobotlar (TZ 8.10, 9.9). Hammasi SQL agregatlari — chek soniga bog'liq bo'lmagan doimiy sonli so'rov.
 * Filial: joriy filial yoki `all` (faqat egasi).
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Filial sharti: `all` faqat all_branches uchun (TZ 8.12 (1)). */
  private scope(user: AuthUser, branchId: string, requested: string | undefined): SQL | undefined {
    if (requested === 'all') {
      if (!user.allBranches) throw forbidden('Barcha filiallar hisoboti faqat egasi uchun', 'branch_forbidden');
      return undefined;
    }
    const id = requested && user.allBranches ? requested : branchId;
    return eq(sales.branchId, id);
  }
  private scopeId(user: AuthUser, branchId: string, requested: string | undefined): string | null {
    if (requested === 'all') return null;
    return requested && user.allBranches ? requested : branchId;
  }

  /** Do'kon kuni (TZ 8.10). Vaqt zonasi literal: GROUP BY da parametr ($n) ishlatilsa Postgres ifodani tanimaydi. */
  private day(col: SQL | typeof sales.createdAt) {
    return sql`(${col} at time zone ${sql.raw(`'${TZ}'`)})::date`;
  }

  /** Frontend "Moliya va statistika" sahifasi uchun bitta javob (TZ 9.9 dashboard). */
  async dashboard(user: AuthUser, branchId: string, requested?: string, date?: string) {
    const today = date ?? todayISO();
    const yesterday = addDays(today, -1);
    const weekStart = addDays(today, -6);
    const monthStart = addDays(today, -29);
    const withCost = user.permissions.includes('view_cost_price');
    const withExp = user.permissions.includes('view_expenses');
    const sc = this.scope(user, branchId, requested);
    const scId = this.scopeId(user, branchId, requested);
    const dayExpr = this.day(sales.createdAt);
    const completed = and(sc, eq(sales.status, 'completed'));

    const [byDay, catShare, payToday, debtAgg, invAgg, lowStock, expAgg, expByCat, soldCostToday, stockInToday] = await Promise.all([
      // Kun bo'yicha: tushum (paid), cheklar, savdo summasi, foyda — 30 kun
      this.db
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
        .where(and(completed, gte(dayExpr, sql`${monthStart}::date`), lte(dayExpr, sql`${today}::date`)))
        .groupBy(dayExpr),
      // Kategoriya ulushi 30 kun (chegirma qatorlarga mutanosib)
      this.db
        .select({ categoryId: saleLines.categoryId, name: categories.name, value: sql<number>`coalesce(sum(${saleLines.lineTotal} * (case when ${sales.subtotal} > 0 then ${sales.totalAmount}::numeric / ${sales.subtotal} else 1 end)), 0)::bigint` })
        .from(saleLines)
        .innerJoin(sales, eq(sales.id, saleLines.saleId))
        .leftJoin(categories, eq(categories.id, saleLines.categoryId))
        .where(and(completed, eq(sales.type, 'sale'), gte(dayExpr, sql`${monthStart}::date`), lte(dayExpr, sql`${today}::date`)))
        .groupBy(saleLines.categoryId, categories.name)
        .orderBy(desc(sql`sum(${saleLines.lineTotal})`)),
      // Bugun usul bo'yicha kassaga tushgan pul
      this.db
        .select({ code: salePayments.methodCode, kind: salePayments.kind, label: paymentMethods.label, sum: sql<number>`sum(${salePayments.amount})::bigint` })
        .from(salePayments)
        .innerJoin(sales, eq(sales.id, salePayments.saleId))
        .leftJoin(paymentMethods, eq(paymentMethods.id, salePayments.methodId))
        .where(and(completed, eq(dayExpr, sql`${today}::date`)))
        .groupBy(salePayments.methodCode, salePayments.kind, paymentMethods.label),
      this.db.select({ total: sql<number>`coalesce(sum(${customers.totalDebt}), 0)::bigint`, debtors: sql<number>`count(case when ${customers.totalDebt} > 0 then 1 end)::int`, overdue: sql<number>`count(case when ${customers.totalDebt} > 0 and ${customers.dueDate} < ${today}::date then 1 end)::int` }).from(customers).where(isNull(customers.deletedAt)),
      // Ombor qiymati: tannarxda (view_cost_price), aks holda sotish narxida
      this.db
        .select({
          positions: sql<number>`count(*)::int`,
          value: withCost
            ? sql<number>`coalesce(sum(greatest(${stockLevels.stock}, 0) * coalesce(${stockLevels.costPrice}, ${productVariants.retailPrice}, ${products.retailPrice})), 0)::bigint`
            : sql<number>`coalesce(sum(greatest(${stockLevels.stock}, 0) * coalesce(${productVariants.retailPrice}, ${products.retailPrice})), 0)::bigint`,
        })
        .from(stockLevels)
        .innerJoin(products, and(eq(products.id, stockLevels.productId), isNull(products.deletedAt)))
        .leftJoin(productVariants, eq(productVariants.id, stockLevels.variantId))
        .where(scId ? eq(stockLevels.branchId, scId) : undefined),
      // Kam qoldiq: min_stock > 0 va stock < min_stock, nisbat bo'yicha
      this.db
        .select({ productId: stockLevels.productId, variantId: stockLevels.variantId, name: products.name, variantName: productVariants.name, sku: sql<string>`coalesce(${productVariants.sku}, ${products.sku})`, unit: products.baseUnit, stock: stockLevels.stock, minStock: stockLevels.minStock })
        .from(stockLevels)
        .innerJoin(products, and(eq(products.id, stockLevels.productId), isNull(products.deletedAt)))
        .leftJoin(productVariants, eq(productVariants.id, stockLevels.variantId))
        .where(and(scId ? eq(stockLevels.branchId, scId) : undefined, sql`${stockLevels.minStock} > 0 and ${stockLevels.stock} < ${stockLevels.minStock}`))
        .orderBy(sql`${stockLevels.stock} / ${stockLevels.minStock}`)
        .limit(50),
      // Xarajatlar: bugun, kecha, 30 kun
      withExp
        ? this.db
            .select({
              today: sql<number>`coalesce(sum(case when ${expenses.date} = ${today}::date then ${expenses.amount} end), 0)::bigint`,
              yesterday: sql<number>`coalesce(sum(case when ${expenses.date} = ${yesterday}::date then ${expenses.amount} end), 0)::bigint`,
              month: sql<number>`coalesce(sum(case when ${expenses.date} >= ${monthStart}::date then ${expenses.amount} end), 0)::bigint`,
            })
            .from(expenses)
            .where(and(scId ? eq(expenses.branchId, scId) : undefined, isNull(expenses.voidedAt), gte(expenses.date, monthStart), lte(expenses.date, today)))
        : Promise.resolve([{ today: 0, yesterday: 0, month: 0 }]),
      withExp
        ? this.db
            .select({ categoryId: expenses.categoryId, name: expenseCategories.name, value: sql<number>`sum(${expenses.amount})::bigint` })
            .from(expenses)
            .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
            .where(and(scId ? eq(expenses.branchId, scId) : undefined, isNull(expenses.voidedAt), gte(expenses.date, monthStart), lte(expenses.date, today)))
            .groupBy(expenses.categoryId, expenseCategories.name)
            .orderBy(desc(sql`sum(${expenses.amount})`))
        : Promise.resolve([]),
      // Kechagi ombor qiymatini taxminlash uchun: bugun sotilganning tannarxi va bugungi kirim summasi
      this.db
        .select({ cost: sql<number>`coalesce(sum(${saleLines.baseQty} * coalesce(${saleLines.costPerBase}, case when ${saleLines.baseQty} > 0 then ${saleLines.lineTotal} / ${saleLines.baseQty} else 0 end)), 0)::bigint` })
        .from(saleLines)
        .innerJoin(sales, eq(sales.id, saleLines.saleId))
        .where(and(completed, eq(sales.type, 'sale'), eq(dayExpr, sql`${today}::date`))),
      this.db.select({ cost: sql<number>`coalesce(sum(${stockReceipts.totalCost}), 0)::bigint` }).from(stockReceipts).where(and(scId ? eq(stockReceipts.branchId, scId) : undefined, eq(stockReceipts.date, today))),
    ]);

    const d = new Map(byDay.map((r) => [r.day, r]));
    const zero = { revenue: 0, sales: 0, salesTotal: 0, profit: 0, newDebt: 0, debtPaid: 0 };
    const t = d.get(today) ?? zero;
    const y = d.get(yesterday) ?? zero;
    const pair = (a: number, b: number) => ({ today: a, yesterday: b });
    const exp = expAgg[0];
    const inv = invAgg[0];
    // Kechagi ombor qiymati taxmini (bugungi sotuv tannarxi qaytariladi, bugungi kirim ayriladi); 0 dan kichik bo'lmaydi
    const invYesterday = Math.max(0, inv.value + soldCostToday[0].cost - stockInToday[0].cost);
    let profit30 = 0;
    for (const r of byDay) profit30 += r.profit;

    return {
      date: today,
      branchId: scId ?? 'all',
      revenue: pair(t.revenue, y.revenue),
      receipts: pair(t.sales, y.sales),
      avgReceipt: pair(t.sales ? Math.round(t.salesTotal / t.sales) : 0, y.sales ? Math.round(y.salesTotal / y.sales) : 0),
      ...(withCost ? { grossProfit: pair(t.profit, y.profit), marginPct: pair(t.salesTotal ? +((t.profit / t.salesTotal) * 100).toFixed(1) : 0, y.salesTotal ? +((y.profit / y.salesTotal) * 100).toFixed(1) : 0) } : {}),
      ...(withCost && withExp ? { netProfit: pair(t.profit - exp.today, y.profit - exp.yesterday) } : {}),
      customerDebt: { total: debtAgg[0].total, yesterday: debtAgg[0].total - t.newDebt + t.debtPaid, debtors: debtAgg[0].debtors, overdue: debtAgg[0].overdue },
      inventoryValue: { today: inv.value, yesterday: invYesterday, positions: inv.positions, atCost: withCost },
      week: Array.from({ length: 7 }, (_, i) => {
        const k = addDays(weekStart, i);
        const r = d.get(k) ?? zero;
        return { day: k, revenue: r.revenue, ...(withCost ? { profit: r.profit } : {}) };
      }),
      categoryShare: catShare.map((c) => ({ categoryId: c.categoryId, name: c.name ?? 'Boshqa', value: c.value })),
      paymentsToday: payToday.map((p) => ({ method: p.code, kind: p.kind, label: p.label ?? p.code, value: p.sum })),
      nasiyaWrittenToday: t.newDebt,
      debtPaymentsToday: t.debtPaid,
      ...(withExp ? { expenses: { today: exp.today, yesterday: exp.yesterday, month: exp.month, byCategory: expByCat }, ...(withCost ? { profitLoss30: { grossProfit: profit30, expenses: exp.month, netProfit: profit30 - exp.month } } : {}) } : {}),
      lowStock: lowStock.map((l) => ({ ...l, stock: Number(l.stock), minStock: Number(l.minStock), name: l.variantName ? `${l.name} — ${l.variantName}` : l.name })),
    };
  }

  /** Kunlik tushum va foyda (TZ 9.9 revenue). */
  async revenue(user: AuthUser, branchId: string, q: { from: string; to: string; branchId?: string }) {
    const sc = this.scope(user, branchId, q.branchId);
    const dayExpr = this.day(sales.createdAt);
    const withCost = user.permissions.includes('view_cost_price');
    const rows = await this.db
      .select({
        day: sql<string>`${dayExpr}::text`,
        revenue: sql<number>`coalesce(sum(${sales.paidAmount}), 0)::bigint`,
        receipts: sql<number>`count(case when ${sales.type} = 'sale' then 1 end)::int`,
        salesTotal: sql<number>`coalesce(sum(case when ${sales.type} = 'sale' then ${sales.totalAmount} end), 0)::bigint`,
        profit: sql<number>`coalesce(sum(case when ${sales.type} = 'sale' then ${sales.profit} end), 0)::bigint`,
        nasiya: sql<number>`coalesce(sum(${sales.remainingDebt}), 0)::bigint`,
      })
      .from(sales)
      .where(and(sc, eq(sales.status, 'completed'), gte(dayExpr, sql`${q.from}::date`), lte(dayExpr, sql`${q.to}::date`)))
      .groupBy(dayExpr)
      .orderBy(dayExpr);
    return rows.map((r) => (withCost ? r : { ...r, profit: undefined }));
  }

  /** Eng ko'p sotilgan / foydali mahsulotlar. */
  async productsReport(user: AuthUser, branchId: string, q: { from: string; to: string; branchId?: string; limit?: number }) {
    const sc = this.scope(user, branchId, q.branchId);
    const dayExpr = this.day(sales.createdAt);
    const withCost = user.permissions.includes('view_cost_price');
    const rows = await this.db
      .select({
        productId: saleLines.productId, variantId: saleLines.variantId, name: sql<string>`max(${saleLines.name})`, variantName: sql<string | null>`max(${saleLines.variantName})`, sku: sql<string>`max(${saleLines.sku})`,
        qtyBase: sql<number>`sum(${saleLines.baseQty})::numeric`, total: sql<number>`sum(${saleLines.lineTotal})::bigint`, lines: sql<number>`count(*)::int`,
        profit: sql<number>`coalesce(sum(${saleLines.lineTotal} - ${saleLines.baseQty} * coalesce(${saleLines.costPerBase}, 0)), 0)::bigint`,
      })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(and(sc, eq(sales.status, 'completed'), eq(sales.type, 'sale'), gte(dayExpr, sql`${q.from}::date`), lte(dayExpr, sql`${q.to}::date`)))
      .groupBy(saleLines.productId, saleLines.variantId)
      .orderBy(desc(sql`sum(${saleLines.lineTotal})`))
      .limit(q.limit ?? 50);
    return rows.map((r) => ({ ...r, qtyBase: Number(r.qtyBase), profit: withCost ? r.profit : undefined }));
  }

  async cashiers(user: AuthUser, branchId: string, q: { from: string; to: string; branchId?: string }) {
    const sc = this.scope(user, branchId, q.branchId);
    const dayExpr = this.day(sales.createdAt);
    return this.db
      .select({ cashierId: sales.cashierId, name: users.name, receipts: sql<number>`count(case when ${sales.type} = 'sale' then 1 end)::int`, total: sql<number>`coalesce(sum(case when ${sales.type} = 'sale' then ${sales.totalAmount} end), 0)::bigint`, paid: sql<number>`coalesce(sum(${sales.paidAmount}), 0)::bigint`, voided: sql<number>`count(case when ${sales.status} = 'voided' then 1 end)::int` })
      .from(sales)
      .innerJoin(users, eq(users.id, sales.cashierId))
      .where(and(sc, gte(dayExpr, sql`${q.from}::date`), lte(dayExpr, sql`${q.to}::date`)))
      .groupBy(sales.cashierId, users.name)
      .orderBy(desc(sql`sum(${sales.paidAmount})`));
  }

  /** Qarzdorlar va yoshi (aging): 0–30, 31–60, 61–90, 90+ kun muddat o'tgan. */
  async debts() {
    const today = todayISO();
    const rows = await this.db
      .select({ id: customers.id, name: customers.name, phone: customers.phone, totalDebt: customers.totalDebt, creditLimit: customers.creditLimit, dueDate: customers.dueDate, lastPaidDate: customers.lastPaidDate, overdueDays: sql<number>`greatest(0, ${today}::date - ${customers.dueDate})::int` })
      .from(customers)
      .where(and(isNull(customers.deletedAt), sql`${customers.totalDebt} > 0`))
      .orderBy(desc(sql`${today}::date - ${customers.dueDate}`), desc(customers.totalDebt));
    const bucket = (d: number) => (d <= 0 ? 'current' : d <= 30 ? 'd30' : d <= 60 ? 'd60' : d <= 90 ? 'd90' : 'd90plus');
    const aging: Record<string, number> = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
    for (const r of rows) aging[bucket(r.overdueDays)] += r.totalDebt;
    return { items: rows, total: rows.reduce((a, r) => a + r.totalDebt, 0), aging };
  }

  async paymentsReport(user: AuthUser, branchId: string, q: { from: string; to: string; branchId?: string }) {
    const sc = this.scope(user, branchId, q.branchId);
    const dayExpr = this.day(sales.createdAt);
    return this.db
      .select({ method: salePayments.methodCode, kind: salePayments.kind, label: paymentMethods.label, sum: sql<number>`sum(${salePayments.amount})::bigint`, count: sql<number>`count(*)::int` })
      .from(salePayments)
      .innerJoin(sales, eq(sales.id, salePayments.saleId))
      .leftJoin(paymentMethods, eq(paymentMethods.id, salePayments.methodId))
      .where(and(sc, eq(sales.status, 'completed'), gte(dayExpr, sql`${q.from}::date`), lte(dayExpr, sql`${q.to}::date`)))
      .groupBy(salePayments.methodCode, salePayments.kind, paymentMethods.label)
      .orderBy(desc(sql`sum(${salePayments.amount})`));
  }

  /** Foyda va zarar (TZ 7.11): tushum, tannarx, yalpi foyda, xarajatlar kategoriya bo'yicha, sof foyda. */
  async profitLoss(user: AuthUser, branchId: string, q: { from: string; to: string; branchId?: string }) {
    const sc = this.scope(user, branchId, q.branchId);
    const scId = this.scopeId(user, branchId, q.branchId);
    const dayExpr = this.day(sales.createdAt);
    const [[s], exp] = await Promise.all([
      this.db
        .select({ salesTotal: sql<number>`coalesce(sum(${sales.totalAmount}), 0)::bigint`, profit: sql<number>`coalesce(sum(${sales.profit}), 0)::bigint`, receipts: sql<number>`count(*)::int` })
        .from(sales)
        .where(and(sc, eq(sales.status, 'completed'), eq(sales.type, 'sale'), gte(dayExpr, sql`${q.from}::date`), lte(dayExpr, sql`${q.to}::date`))),
      this.db
        .select({ categoryId: expenses.categoryId, name: expenseCategories.name, value: sql<number>`sum(${expenses.amount})::bigint` })
        .from(expenses)
        .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
        .where(and(scId ? eq(expenses.branchId, scId) : undefined, isNull(expenses.voidedAt), gte(expenses.date, q.from), lte(expenses.date, q.to)))
        .groupBy(expenses.categoryId, expenseCategories.name)
        .orderBy(desc(sql`sum(${expenses.amount})`)),
    ]);
    const expTotal = exp.reduce((a, e) => a + e.value, 0);
    return { from: q.from, to: q.to, revenue: s.salesTotal, costOfGoods: s.salesTotal - s.profit, grossProfit: s.profit, receipts: s.receipts, expenses: expTotal, expensesByCategory: exp, netProfit: s.profit - expTotal };
  }

  /** Kassa oqimi: kirim (to'lovlar usul bo'yicha) va chiqim (xarajatlar usul bo'yicha). */
  async cashFlow(user: AuthUser, branchId: string, q: { from: string; to: string; branchId?: string }) {
    const scId = this.scopeId(user, branchId, q.branchId);
    const [inflow, outflow] = await Promise.all([
      this.paymentsReport(user, branchId, q),
      this.db
        .select({ method: paymentMethods.code, label: paymentMethods.label, sum: sql<number>`sum(${expenses.amount})::bigint` })
        .from(expenses)
        .innerJoin(paymentMethods, eq(paymentMethods.id, expenses.methodId))
        .where(and(scId ? eq(expenses.branchId, scId) : undefined, isNull(expenses.voidedAt), gte(expenses.date, q.from), lte(expenses.date, q.to)))
        .groupBy(paymentMethods.code, paymentMethods.label),
    ]);
    return { inflow, outflow, net: inflow.reduce((a, r) => a + r.sum, 0) - outflow.reduce((a, r) => a + r.sum, 0) };
  }

  /** Oxirgi N kunlik ko'rsatkich — kassirlar/filiallar uchun qisqa (frontend Bosh admin sahifasi `GET /branches/overview` da). */
  async lowStockList(user: AuthUser, branchId: string, requested?: string) {
    const scId = this.scopeId(user, branchId, requested);
    const rows = await this.db
      .select({ productId: stockLevels.productId, variantId: stockLevels.variantId, branchId: stockLevels.branchId, name: products.name, variantName: productVariants.name, sku: sql<string>`coalesce(${productVariants.sku}, ${products.sku})`, unit: products.baseUnit, stock: stockLevels.stock, minStock: stockLevels.minStock })
      .from(stockLevels)
      .innerJoin(products, and(eq(products.id, stockLevels.productId), isNull(products.deletedAt)))
      .leftJoin(productVariants, eq(productVariants.id, stockLevels.variantId))
      .where(and(scId ? eq(stockLevels.branchId, scId) : user.allBranches ? undefined : inArray(stockLevels.branchId, user.branchIds), sql`${stockLevels.minStock} > 0 and ${stockLevels.stock} < ${stockLevels.minStock}`))
      .orderBy(sql`${stockLevels.stock} / ${stockLevels.minStock}`);
    return rows.map((l) => ({ ...l, stock: Number(l.stock), minStock: Number(l.minStock) }));
  }
}
