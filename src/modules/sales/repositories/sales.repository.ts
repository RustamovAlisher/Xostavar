import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, exists, gt, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { branches, expenseCategories, expenses, paymentMethods, saleLines, salePayments, sales, stockMovements, units } from '../../../entities/index.js';
import type { SalesListQuery } from '../dto/sales.dto.js';
import { textQuery } from '../../../common/search-sql.js';

export type SaleRow = typeof sales.$inferSelect;
export type SaleLineRow = typeof saleLines.$inferSelect;
export type SalePaymentRow = typeof salePayments.$inferSelect;
export type PaymentMethodRow = typeof paymentMethods.$inferSelect;
export type ExpenseRow = typeof expenses.$inferSelect;
export type StockKey = { productId: string; variantId: string | null };

/**
 * Cheklar bo'yicha barcha SQL (sotuv, qarz to'lovi, storno, ro'yxat). Biznes qoidalari va xatolar servisda.
 * Qulf tartibi servisda saqlanadi: avval filial qatori, keyin qoldiq qatorlari (InventoryService.lockLevels).
 */
@Injectable()
export class SalesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /* ───────── Hisob uchun ma'lumotnomalar ───────── */

  units(tx: DbOrTx = this.db) {
    return tx.select().from(units);
  }

  /** Filial narxi (TZ 8.1): bo'lsa umumiy narx o'rniga. */
  branchPrices(tx: DbOrTx, branchId: string, productIds: string[]) {
    return tx.query.branchPrices.findMany({ where: (bp, { and, eq, inArray }) => and(eq(bp.branchId, branchId), inArray(bp.productId, productIds)) });
  }

  /** Qoldiqni qulfsiz o'qish (quote) — kalit `productId|variantId`. */
  async readLevels(tx: DbOrTx, branchId: string, keys: StockKey[]) {
    const rows = await tx.query.stockLevels.findMany({ where: (s, { and, eq, inArray }) => and(eq(s.branchId, branchId), inArray(s.productId, [...new Set(keys.map((k) => k.productId))])) });
    const out = new Map<string, { id: string; stock: number; costPrice: number | null; minStock: number | null }>();
    for (const r of rows) out.set(`${r.productId}|${r.variantId ?? ''}`, { id: r.id, stock: Number(r.stock), costPrice: r.costPrice != null ? Number(r.costPrice) : null, minStock: r.minStock != null ? Number(r.minStock) : null });
    return out;
  }

  paymentMethods(tx: DbOrTx = this.db) {
    return tx.select().from(paymentMethods);
  }

  findPaymentMethod(tx: DbOrTx, id: string) {
    return tx.select().from(paymentMethods).where(eq(paymentMethods.id, id)).limit(1).then((r) => r[0] ?? null);
  }

  /* ───────── Qulf va raqam ───────── */

  /** Filial qatorini FOR UPDATE bilan qulflaydi (chek raqami ketma-ketligi); filial kodini qaytaradi. */
  lockBranch(tx: DbOrTx, branchId: string) {
    return tx.select({ code: branches.code, name: branches.name }).from(branches).where(eq(branches.id, branchId)).for('update').then((r) => r[0] ?? null);
  }

  /** Kun ichidagi oxirgi tartib raqami — chek raqamining oxirgi qismi (MAIN-20261024-0007 → 7). */
  maxSeq(tx: DbOrTx, branchId: string, prefix: string) {
    return tx
      .select({ max: sql<number>`coalesce(max(split_part(${sales.number}, '-', 3)::int), 0)::int` })
      .from(sales)
      .where(and(eq(sales.branchId, branchId), sql`${sales.number} like ${prefix + '%'}`))
      .then((r) => r[0].max);
  }

  /* ───────── Yozish ───────── */

  findIdByClientId(clientId: string, tx: DbOrTx = this.db) {
    return tx.select({ id: sales.id }).from(sales).where(eq(sales.clientId, clientId)).limit(1).then((r) => r[0]?.id ?? null);
  }

  insertSale(tx: DbOrTx, v: typeof sales.$inferInsert) {
    return tx.insert(sales).values(v).returning({ id: sales.id }).then((r) => r[0].id);
  }

  insertLines(tx: DbOrTx, v: (typeof saleLines.$inferInsert)[]) {
    return tx.insert(saleLines).values(v);
  }

  insertPayments(tx: DbOrTx, v: (typeof salePayments.$inferInsert)[]) {
    return tx.insert(salePayments).values(v);
  }

  updateSale(tx: DbOrTx, id: string, set: Partial<typeof sales.$inferInsert>) {
    return tx.update(sales).set(set).where(eq(sales.id, id));
  }

  /* ───────── O'qish ───────── */

  findById(id: string, tx: DbOrTx = this.db) {
    return tx.select().from(sales).where(eq(sales.id, id)).limit(1).then((r) => r[0] ?? null);
  }

  /** Storno uchun chek qatori FOR UPDATE bilan (ikki parallel storno bo'lmasin). */
  lockById(tx: DbOrTx, id: string) {
    return tx.select().from(sales).where(eq(sales.id, id)).limit(1).for('update').then((r) => r[0] ?? null);
  }

  /** Kategoriyalar mashhurligi: oxirgi `days` kunda shu filialda nechta sotuv qatori (bekor qilinmagan sotuv chekidan). */
  categoryRank(branchId: string, days: number) {
    const lines = sql<number>`count(*)::int`;
    return this.db
      .select({ categoryId: saleLines.categoryId, lines })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(and(eq(sales.branchId, branchId), eq(sales.type, 'sale'), eq(sales.status, 'completed'), gte(sales.createdAt, sql`now() - make_interval(days => ${days})`), sql`${saleLines.categoryId} is not null`))
      .groupBy(saleLines.categoryId)
      .orderBy(desc(lines));
  }

  updateLine(tx: DbOrTx, lineId: string, set: Partial<typeof saleLines.$inferInsert>) {
    return tx.update(saleLines).set(set).where(eq(saleLines.id, lineId));
  }

  deleteLine(tx: DbOrTx, lineId: string) {
    return tx.delete(saleLines).where(eq(saleLines.id, lineId));
  }

  lines(tx: DbOrTx, saleId: string) {
    return tx.select().from(saleLines).where(eq(saleLines.saleId, saleId));
  }

  /** Bitta chekning qatorlari (tartib bo'yicha) va to'lovlari. */
  details(saleId: string, tx: DbOrTx = this.db) {
    return Promise.all([tx.select().from(saleLines).where(eq(saleLines.saleId, saleId)).orderBy(saleLines.sortOrder), tx.select().from(salePayments).where(eq(salePayments.saleId, saleId))]);
  }

  /** Bir nechta chekning qatorlari va to'lovlari — 2 ta so'rov (N+1 emas). */
  detailsMany(saleIds: string[], tx: DbOrTx = this.db): Promise<[SaleLineRow[], SalePaymentRow[]]> {
    if (!saleIds.length) return Promise.resolve([[], []]);
    return Promise.all([tx.select().from(saleLines).where(inArray(saleLines.saleId, saleIds)).orderBy(saleLines.sortOrder), tx.select().from(salePayments).where(inArray(salePayments.saleId, saleIds))]);
  }

  /**
   * Matn qidiruvi: raqam, mijoz ismi, qator nomi/SKU. Har bir so'z alohida (hammasi bo'lishi kerak, tartib ahamiyatsiz),
   * imlo variantlari va sinonimlar (common/search-sql.ts). Tarix katta bo'lgani uchun xato-tuzatish yo'q.
   */
  private textFilter(raw?: string) {
    const all = (col: unknown, res: string[]) => and(...res.map((re) => sql`${col} ~* ${re}`));
    const cond = textQuery(raw, (res) => or(
      all(sales.number, res),
      all(sales.customerName, res),
      sql`exists (select 1 from ${saleLines} where ${saleLines.saleId} = ${sales.id} and (${all(saleLines.name, res)} or ${all(saleLines.sku, res)}))`,
    ));
    if (cond !== null) return cond;
    const like = `%${raw!.trim()}%`;
    return or(ilike(sales.number, like), ilike(sales.customerName, like));
  }

  /** Ro'yxat + jami (2 ta so'rov). `cashierId` servisda hal qilinadi: kassir uchun o'ziniki, aks holda filtr. */
  /** Ro'yxat va jamilar uchun bitta filtr (davr, kassir, tur, holat, qidiruv, to'lov turi). */
  private where(branchId: string, cashierId: string | undefined, q: Omit<SalesListQuery, 'offset'>): SQL | undefined {
    return and(
      eq(sales.branchId, branchId),
      cashierId ? eq(sales.cashierId, cashierId) : undefined,
      q.from ? gte(sales.createdAt, new Date(q.from)) : undefined,
      q.to ? lte(sales.createdAt, new Date(q.to + 'T23:59:59.999Z')) : undefined,
      q.customerId ? eq(sales.customerId, q.customerId) : undefined,
      q.shiftId ? eq(sales.shiftId, q.shiftId) : undefined,
      q.type === 'sale' || q.type === 'debt_payment' ? eq(sales.type, q.type) : undefined,
      q.status === 'voided' ? eq(sales.status, 'voided') : q.status === 'completed' ? eq(sales.status, 'completed') : undefined,
      this.textFilter(q.q),
      q.method === 'debt'
        ? and(eq(sales.type, 'sale'), gt(sales.remainingDebt, 0))
        : q.method
          ? exists(this.db.select({ x: sql`1` }).from(salePayments).where(and(eq(salePayments.saleId, sales.id), eq(salePayments.methodCode, q.method))))
          : undefined,
    );
  }

  list(branchId: string, cashierId: string | undefined, q: SalesListQuery, tx: DbOrTx = this.db) {
    const where = this.where(branchId, cashierId, q);
    return Promise.all([
      tx.select().from(sales).where(where).orderBy(desc(sales.createdAt)).limit(q.pageSize).offset(q.offset),
      tx.select({ total: sql<number>`count(*)::int` }).from(sales).where(where).then((r) => r[0].total),
    ]);
  }

  private async debtTotals(branchId: string, cashierId: string | undefined, q: SalesListQuery, tx: DbOrTx) {
    const [d] = await tx.select({
      debtAll: sql<number>`coalesce(sum(${sales.remainingDebt}) filter (where ${sales.type} = 'sale' and ${sales.status} = 'completed'), 0)::bigint`,
      debtSalesAll: sql<number>`count(*) filter (where ${sales.type} = 'sale' and ${sales.status} = 'completed' and ${sales.remainingDebt} > 0)::int`,
    }).from(sales).where(this.where(branchId, cashierId, { ...q, method: undefined }));
    return { debtAll: Number(d.debtAll), debtSalesAll: Number(d.debtSalesAll) };
  }

  /**
   * Tanlangan davr (filtr) bo'yicha jamilar — sahifalashsiz, butun to'plamdan:
   * cheklar soni, sotuv summasi, kassaga tushgan, nasiya, bekor qilinganlar va to'lov turlari kesimi.
   */
  async summary(branchId: string, cashierId: string | undefined, q: SalesListQuery, tx: DbOrTx = this.db) {
    const where = this.where(branchId, cashierId, q);
    const [t] = await tx.select({
      sales: sql<number>`count(*) filter (where ${sales.type} = 'sale' and ${sales.status} = 'completed')::int`,
      salesSum: sql<number>`coalesce(sum(${sales.totalAmount}) filter (where ${sales.type} = 'sale' and ${sales.status} = 'completed'), 0)::bigint`,
      paid: sql<number>`coalesce(sum(${sales.paidAmount}) filter (where ${sales.status} = 'completed'), 0)::bigint`,
      debt: sql<number>`coalesce(sum(${sales.remainingDebt}) filter (where ${sales.type} = 'sale' and ${sales.status} = 'completed'), 0)::bigint`,
      debtSales: sql<number>`count(*) filter (where ${sales.type} = 'sale' and ${sales.status} = 'completed' and ${sales.remainingDebt} > 0)::int`,
      voided: sql<number>`count(*) filter (where ${sales.status} = 'voided')::int`,
    }).from(sales).where(where);
    const methods = await tx.select({
      code: salePayments.methodCode,
      kind: salePayments.kind,
      type: sales.type,
      amount: sql<number>`coalesce(sum(${salePayments.amount}), 0)::bigint`,
      count: sql<number>`count(distinct ${sales.id})::int`,
    }).from(salePayments).innerJoin(sales, eq(sales.id, salePayments.saleId))
      // Kesim to'lov turi filtriga bog'liq emas — karta bosilganda boshqalari 0 ga tushmasin
      .where(and(this.where(branchId, cashierId, { ...q, method: undefined }), eq(sales.status, 'completed')))
      .groupBy(salePayments.methodCode, salePayments.kind, sales.type);
    return {
      sales: Number(t.sales), salesSum: Number(t.salesSum), paid: Number(t.paid), debt: Number(t.debt),
      debtSales: Number(t.debtSales), voided: Number(t.voided),
      // Nasiya kartasi ham filtrsiz (kesim bilan bir xil asosda)
      ...(q.method ? await this.debtTotals(branchId, cashierId, q, tx) : {}),
      methods: methods.map((m) => ({ code: m.code, kind: m.kind, type: m.type as 'sale' | 'debt_payment', amount: Number(m.amount), count: Number(m.count) })),
    };
  }

  /* ───────── «O'zimga olish» (kassadan mol egasi hisobiga): xarajat yozuvi va uning qoldiq harakatlari ───────── */

  /** Kategoriya bo'lmasa yaratadi (nomi bo'yicha unikal indeks — parallel chaqiruvda ham bitta qator). */
  async ensureCategory(tx: DbOrTx, name: string) {
    await tx.insert(expenseCategories).values({ name, active: true, sortOrder: 99 }).onConflictDoNothing();
    const [c] = await tx.select().from(expenseCategories).where(sql`lower(${expenseCategories.name}) = lower(${name})`).limit(1);
    return c;
  }

  async insertExpense(tx: DbOrTx, row: typeof expenses.$inferInsert) {
    const [r] = await tx.insert(expenses).values(row).returning({ id: expenses.id });
    return r.id;
  }

  async findExpenseForUpdate(tx: DbOrTx, id: string): Promise<ExpenseRow | undefined> {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).for('update');
    return e;
  }

  voidExpenseRow(tx: DbOrTx, id: string, userId: string) {
    return tx.update(expenses).set({ voidedAt: new Date(), voidedBy: userId }).where(eq(expenses.id, id));
  }

  /** Shu xarajat uchun ombordan chiqarilgan qatorlar (qaytarishda teskari yoziladi). */
  ownMovements(tx: DbOrTx, expenseId: string, refType: string) {
    return tx.select().from(stockMovements).where(and(eq(stockMovements.refId, expenseId), eq(stockMovements.refType, refType)));
  }

  /** «O'zimga olingan» yozuvlar (bekor qilinmaganlar): shu filial, davr (kun) va xodim bo'yicha. */
  private ownUseWhere(branchId: string, name: string, f: { from?: string; to?: string; userId?: string }) {
    return and(
      eq(expenses.branchId, branchId),
      sql`lower(${expenseCategories.name}) = lower(${name})`,
      isNull(expenses.voidedAt),
      f.from ? gte(expenses.date, f.from) : undefined,
      f.to ? lte(expenses.date, f.to) : undefined,
      f.userId ? eq(expenses.createdBy, f.userId) : undefined,
    );
  }

  ownUseRows(branchId: string, name: string, f: { from?: string; to?: string; userId?: string }) {
    return this.db
      .select({ id: expenses.id, date: expenses.date, createdAt: expenses.createdAt, amount: expenses.amount, note: expenses.note, userId: expenses.createdBy, userName: expenses.createdByName })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(this.ownUseWhere(branchId, name, f))
      .orderBy(desc(expenses.createdAt))
      .limit(500);
  }

  async ownUseTotals(branchId: string, name: string, f: { from?: string; to?: string; userId?: string }) {
    const [r] = await this.db
      .select({ count: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${expenses.amount}), 0)::bigint` })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(this.ownUseWhere(branchId, name, f));
    return { count: Number(r.count), amount: Number(r.amount) };
  }
}
