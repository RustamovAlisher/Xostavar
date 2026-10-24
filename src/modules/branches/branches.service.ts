import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module.js';
import { branches, sales, shifts, stockLevels, userBranches, users, productVariants, products } from '../../db/schema/index.js';
import type { AuthUser } from '../../common/auth-context.js';
import { conflict, notFound } from '../../common/errors.js';
import { addDays, codeFromName, todayISO } from '../../common/numbers.js';
import { assertVersion } from '../../common/version.js';
import { AuditService } from '../audit/audit.service.js';
import type { CreateBranchDto, UpdateBranchDto } from './branches.dto.js';

@Injectable()
export class BranchesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Faqat o'ziga biriktirilganlar; egasi hammasini (TZ 9.0). */
  async listFor(user: AuthUser) {
    const cond = user.allBranches ? undefined : inArray(branches.id, user.branchIds.length ? user.branchIds : ['00000000-0000-0000-0000-000000000000']);
    return this.db.select().from(branches).where(cond).orderBy(asc(branches.createdAt));
  }

  async get(id: string) {
    const [b] = await this.db.select().from(branches).where(eq(branches.id, id)).limit(1);
    if (!b) throw notFound('Filial');
    return b;
  }

  async create(actor: AuthUser, dto: CreateBranchDto) {
    const name = dto.name.trim();
    const existing = await this.db.select({ code: branches.code, name: branches.name }).from(branches);
    if (existing.some((b) => b.name.toLowerCase() === name.toLowerCase())) throw conflict('duplicate_code', 'Bu nomli filial allaqachon bor');
    const code = dto.code ?? codeFromName(name, existing.map((b) => b.code));
    if (existing.some((b) => b.code === code)) throw conflict('duplicate_code', `"${code}" kodi band`);
    const [b] = await this.db
      .insert(branches)
      .values({ name, code, address: dto.address?.trim() || null, phone: dto.phone?.trim() || null, receiptFooter: dto.receiptFooter?.trim() || null, isMain: existing.length === 0 })
      .returning();
    await this.audit.log(actor, { action: 'add', module: 'Filiallar', targetId: b.id, targetName: b.name, details: `Yangi filial (${b.code})` });
    return b;
  }

  async update(actor: AuthUser, id: string, dto: UpdateBranchDto) {
    const old = await this.get(id);
    assertVersion(old.version, dto.version, 'Filial');
    if (dto.name && dto.name.trim().toLowerCase() !== old.name.toLowerCase()) {
      const [dup] = await this.db.select({ id: branches.id }).from(branches).where(and(eq(sql`lower(${branches.name})`, dto.name.trim().toLowerCase()), ne(branches.id, id))).limit(1);
      if (dup) throw conflict('duplicate_code', 'Bu nomli filial allaqachon bor');
    }
    const [b] = await this.db
      .update(branches)
      .set({
        name: dto.name?.trim() ?? old.name,
        address: dto.address !== undefined ? dto.address.trim() || null : old.address,
        phone: dto.phone !== undefined ? dto.phone.trim() || null : old.phone,
        receiptFooter: dto.receiptFooter !== undefined ? dto.receiptFooter.trim() || null : old.receiptFooter,
        version: old.version + 1,
      })
      .where(eq(branches.id, id))
      .returning();
    await this.audit.log(actor, {
      action: 'edit', module: 'Filiallar', targetId: id, targetName: b.name, details: "Filial ma'lumotlari tahrirlandi",
      diff: { before: { nomi: old.name, manzil: old.address, telefon: old.phone }, after: { nomi: b.name, manzil: b.address, telefon: b.phone } },
    });
    return b;
  }

  /** TZ 7.0.1: kamida bitta faol filial qolsin, ochiq smena bo'lmasin. */
  async setActive(actor: AuthUser, id: string, active: boolean) {
    const b = await this.get(id);
    if (b.active === active) return b;
    if (!active) {
      const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(branches).where(and(eq(branches.active, true), ne(branches.id, id)));
      if (n === 0) throw conflict('in_use', 'Kamida bitta faol filial qolishi kerak');
      const [open] = await this.db.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.branchId, id), isNull(shifts.closedAt))).limit(1);
      if (open) throw conflict('in_use', "Smenasi ochiq filialni nofaol qilib bo'lmaydi — avval smenani yoping");
    }
    const [row] = await this.db.update(branches).set({ active, version: b.version + 1 }).where(eq(branches.id, id)).returning();
    await this.audit.log(actor, { action: 'edit', module: 'Filiallar', targetId: id, targetName: b.name, details: `Holat: ${active ? 'Faol' : 'Nofaol'}` });
    return row;
  }

  /**
   * Bosh admin sahifasi (TZ 9.0): har filial bo'yicha bugungi/30 kunlik savdo, omborda xil tovar, ombor qiymati,
   * smena, xodimlar. Hammasi GROUP BY bilan — filial soniga bog'liq bo'lmagan 5 ta so'rov.
   */
  async overview(withCost: boolean) {
    const today = todayISO();
    const from30 = addDays(today, -29);
    const tz = 'Asia/Tashkent';
    const dayExpr = sql`(${sales.createdAt} at time zone ${tz})::date`;

    const [list, salesAgg, stockAgg, openShifts, staff] = await Promise.all([
      this.db.select().from(branches).orderBy(asc(branches.createdAt)),
      this.db
        .select({
          branchId: sales.branchId,
          salesToday: sql<number>`coalesce(sum(case when ${dayExpr} = ${today}::date then ${sales.totalAmount} end), 0)::bigint`,
          receiptsToday: sql<number>`count(case when ${dayExpr} = ${today}::date then 1 end)::int`,
          sales30: sql<number>`coalesce(sum(${sales.totalAmount}), 0)::bigint`,
        })
        .from(sales)
        .where(and(eq(sales.type, 'sale'), eq(sales.status, 'completed'), gte(dayExpr, sql`${from30}::date`)))
        .groupBy(sales.branchId),
      this.db
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
      this.db.select({ branchId: shifts.branchId, openedByName: shifts.openedByName, openedAt: shifts.openedAt }).from(shifts).where(isNull(shifts.closedAt)),
      this.db
        .select({ branchId: userBranches.branchId, n: sql<number>`count(*)::int` })
        .from(userBranches)
        .innerJoin(users, eq(users.id, userBranches.userId))
        .where(and(eq(users.active, true), isNull(users.deletedAt)))
        .groupBy(userBranches.branchId),
    ]);

    const by = <T extends { branchId: string }>(rows: T[]) => new Map(rows.map((r) => [r.branchId, r]));
    const s = by(salesAgg);
    const st = by(stockAgg);
    const sh = by(openShifts);
    const su = by(staff);
    const items = list.map((b) => ({
      ...b,
      salesToday: s.get(b.id)?.salesToday ?? 0,
      receiptsToday: s.get(b.id)?.receiptsToday ?? 0,
      sales30: s.get(b.id)?.sales30 ?? 0,
      stockItems: st.get(b.id)?.items ?? 0,
      stockValue: withCost ? (st.get(b.id)?.value ?? 0) : undefined,
      shift: sh.get(b.id) ? { open: true, openedByName: sh.get(b.id)!.openedByName, openedAt: sh.get(b.id)!.openedAt } : { open: false },
      staff: su.get(b.id)?.n ?? 0,
    }));
    return {
      items,
      totals: {
        salesToday: items.reduce((a, b) => a + b.salesToday, 0),
        sales30: items.reduce((a, b) => a + b.sales30, 0),
        stockValue: withCost ? items.reduce((a, b) => a + (b.stockValue ?? 0), 0) : undefined,
        activeBranches: items.filter((b) => b.active).length,
        branches: items.length,
      },
    };
  }
}
