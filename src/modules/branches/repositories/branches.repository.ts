import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { branches, productVariants, products, sales, shifts, stockLevels, userBranches, users } from '../../../entities/index.js';

export type BranchRow = typeof branches.$inferSelect;
export type BranchInsert = typeof branches.$inferInsert;

/** Hech qanday filialga biriktirilmagan xodim uchun bo'sh natija beradigan "yo'q" id. */
const NO_BRANCH = '00000000-0000-0000-0000-000000000000';

/**
 * Filiallar bo'yicha barcha SQL. Biznes qoidalari, xatolar va audit — servisda.
 * Har metod `tx` qabul qiladi: tranzaksiya ichida chaqirilsa shu `tx`, bo'lmasa umumiy `db`.
 */
@Injectable()
export class BranchesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** `ids` berilmasa hammasi; bo'sh ro'yxat bo'lsa hech biri (yaratilish tartibida). */
  list(ids?: string[], tx: DbOrTx = this.db): Promise<BranchRow[]> {
    const cond = ids ? inArray(branches.id, ids.length ? ids : [NO_BRANCH]) : undefined;
    return tx.select().from(branches).where(cond).orderBy(asc(branches.createdAt));
  }

  findById(id: string, tx: DbOrTx = this.db): Promise<BranchRow | null> {
    return tx.select().from(branches).where(eq(branches.id, id)).limit(1).then((r) => r[0] ?? null);
  }

  /** Nom/kod unikalligi va avtokod uchun barcha kod va nomlar. */
  codesAndNames(tx: DbOrTx = this.db) {
    return tx.select({ code: branches.code, name: branches.name }).from(branches);
  }

  /** Shu nomli (katta-kichik harf farqsiz) boshqa filial id si yoki null. */
  findIdByNameExcept(nameLower: string, exceptId: string, tx: DbOrTx = this.db): Promise<string | null> {
    return tx.select({ id: branches.id }).from(branches).where(and(eq(sql`lower(${branches.name})`, nameLower), ne(branches.id, exceptId))).limit(1).then((r) => r[0]?.id ?? null);
  }

  insert(tx: DbOrTx, v: Pick<BranchInsert, 'name' | 'code' | 'address' | 'phone' | 'receiptFooter' | 'isMain'>): Promise<BranchRow> {
    return tx.insert(branches).values(v).returning().then((r) => r[0]);
  }

  update(tx: DbOrTx, id: string, set: Partial<Pick<BranchInsert, 'name' | 'address' | 'phone' | 'receiptFooter' | 'active' | 'version'>>): Promise<BranchRow> {
    return tx.update(branches).set(set).where(eq(branches.id, id)).returning().then((r) => r[0]);
  }

  /** Barcha filial qatorlarini qulflaydi (faollik o'zgarishida poyga bo'lmasin; filiallar soni kichik). */
  lockAll(tx: DbOrTx) {
    return tx.select({ id: branches.id }).from(branches).for('update');
  }

  /** Shu filialdan tashqari faol filiallar soni. */
  countActiveExcept(id: string, tx: DbOrTx = this.db): Promise<number> {
    return tx.select({ n: sql<number>`count(*)::int` }).from(branches).where(and(eq(branches.active, true), ne(branches.id, id))).then((r) => r[0].n);
  }

  hasOpenShift(branchId: string, tx: DbOrTx = this.db): Promise<boolean> {
    return tx.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.branchId, branchId), isNull(shifts.closedAt))).limit(1).then((r) => r.length > 0);
  }

  /**
   * Bosh admin sahifasi uchun xom qatorlar (TZ 9.0): filiallar, savdo jamlari, ombor jamlari, ochiq smenalar, xodimlar soni.
   * Hammasi GROUP BY bilan — filial soniga bog'liq bo'lmagan 5 ta so'rov.
   */
  overviewRows(today: string, from30: string, tx: DbOrTx = this.db) {
    const dayExpr = sql`(${sales.createdAt} at time zone 'Asia/Tashkent')::date`;
    return Promise.all([
      tx.select().from(branches).orderBy(asc(branches.createdAt)),
      tx
        .select({
          branchId: sales.branchId,
          salesToday: sql<number>`coalesce(sum(case when ${dayExpr} = ${today}::date then ${sales.totalAmount} end), 0)::bigint`,
          receiptsToday: sql<number>`count(case when ${dayExpr} = ${today}::date then 1 end)::int`,
          sales30: sql<number>`coalesce(sum(${sales.totalAmount}), 0)::bigint`,
        })
        .from(sales)
        .where(and(eq(sales.type, 'sale'), eq(sales.status, 'completed'), gte(dayExpr, sql`${from30}::date`)))
        .groupBy(sales.branchId),
      tx
        .select({
          branchId: stockLevels.branchId,
          items: sql<number>`count(case when ${stockLevels.stock} > 0 then 1 end)::int`,
          // Qiymat: tannarx, bo'lmasa sotish narxi (variant yoki mahsulot)
          value: sql<number>`coalesce(sum(greatest(${stockLevels.stock}, 0) * coalesce(${stockLevels.costPrice}, ${productVariants.retailPrice}, ${products.retailPrice})), 0)::bigint`,
        })
        .from(stockLevels)
        .innerJoin(products, eq(products.id, stockLevels.productId))
        .leftJoin(productVariants, eq(productVariants.id, stockLevels.variantId))
        .groupBy(stockLevels.branchId),
      tx.select({ branchId: shifts.branchId, openedByName: shifts.openedByName, openedAt: shifts.openedAt }).from(shifts).where(isNull(shifts.closedAt)),
      tx
        .select({ branchId: userBranches.branchId, n: sql<number>`count(*)::int` })
        .from(userBranches)
        .innerJoin(users, eq(users.id, userBranches.userId))
        .where(and(eq(users.active, true), isNull(users.deletedAt)))
        .groupBy(userBranches.branchId),
    ]);
  }
}
