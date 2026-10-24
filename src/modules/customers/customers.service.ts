import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, isNull, like, lt, ne, or, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../db/db.module.js';
import { customerGroups, customers, debtLedger } from '../../db/schema/index.js';
import type { AuthUser } from '../../common/auth-context.js';
import { conflict, notFound, unprocessable } from '../../common/errors.js';
import { addDays, canonicalPhone, todayISO } from '../../common/numbers.js';
import { page } from '../../common/pagination.js';
import { assertVersion } from '../../common/version.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { CustomerDto, CustomerListQuery } from './customers.dto.js';

/** Frontend `CustomerDebt` bilan mos: `role` = guruh nomi, `totalDebtUZS`, `creditLimitUZS`. */
export interface CustomerView {
  id: string;
  name: string;
  phone: string;
  groupId: string | null;
  role: string;
  totalDebtUZS: number;
  creditLimitUZS: number;
  dueDate: string | null;
  lastPaidDate: string | null;
  overdue: boolean;
  version: number;
  createdAt: Date;
}

/** Mijozlar umumiy (TZ 7.5): istalgan filialdan xarid, qarz va limit umumiy. */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private view(c: typeof customers.$inferSelect, groupName: string | null): CustomerView {
    const today = todayISO();
    return {
      id: c.id, name: c.name, phone: c.phone, groupId: c.groupId, role: groupName ?? '', totalDebtUZS: c.totalDebt, creditLimitUZS: c.creditLimit,
      dueDate: c.dueDate, lastPaidDate: c.lastPaidDate, overdue: c.totalDebt > 0 && !!c.dueDate && c.dueDate < today, version: c.version, createdAt: c.createdAt,
    };
  }

  /** Ro'yxat: 2 ta so'rov (mijozlar + guruh join, jami). Tartib: muddati o'tganlar, keyin qarz kamayishi bo'yicha. */
  async list(q: CustomerListQuery) {
    const today = todayISO();
    const where = and(
      isNull(customers.deletedAt),
      q.hasDebt === 'true' ? gt(customers.totalDebt, 0) : undefined,
      q.overdue === 'true' ? and(gt(customers.totalDebt, 0), lt(customers.dueDate, today)) : undefined,
      q.q?.trim() ? or(ilike(customers.name, `%${q.q.trim()}%`), like(customers.phone, `%${q.q.replace(/\D/g, '')}%`).if(q.q.replace(/\D/g, '').length >= 2)) : undefined,
    );
    const overdueExpr = sql`(${customers.totalDebt} > 0 and ${customers.dueDate} < ${today}::date)`;
    const [rows, [{ total }]] = await Promise.all([
      this.db.select({ c: customers, g: customerGroups.name }).from(customers).leftJoin(customerGroups, eq(customerGroups.id, customers.groupId)).where(where).orderBy(desc(overdueExpr), desc(customers.totalDebt), asc(customers.name)).limit(q.pageSize).offset(q.offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(customers).where(where),
    ]);
    return page(rows.map((r) => this.view(r.c, r.g)), total, q);
  }

  async get(id: string, db: DbOrTx = this.db): Promise<CustomerView> {
    const [r] = await db.select({ c: customers, g: customerGroups.name }).from(customers).leftJoin(customerGroups, eq(customerGroups.id, customers.groupId)).where(and(eq(customers.id, id), isNull(customers.deletedAt))).limit(1);
    if (!r) throw notFound('Mijoz');
    return this.view(r.c, r.g);
  }

  private async assertPhoneFree(db: DbOrTx, phone: string, exceptId?: string) {
    const [dup] = await db.select({ name: customers.name }).from(customers).where(and(eq(customers.phone, phone), isNull(customers.deletedAt), exceptId ? ne(customers.id, exceptId) : undefined)).limit(1);
    if (dup) throw conflict('duplicate_code', `Bu telefon raqami allaqachon mavjud: ${dup.name}`);
  }

  async create(user: AuthUser, dto: CustomerDto): Promise<CustomerView> {
    const phone = canonicalPhone(dto.phone);
    if (!phone) throw unprocessable('validation_failed', "Telefon raqamini to'liq kiriting (+998 va 9 ta raqam)");
    const rules = await this.settings.getRules();
    const id = await this.db.transaction(async (tx) => {
      await this.assertPhoneFree(tx, phone);
      let groupId = dto.groupId ?? null;
      if (!groupId) groupId = (await tx.select({ id: customerGroups.id }).from(customerGroups).orderBy(asc(customerGroups.sortOrder)).limit(1))[0]?.id ?? null;
      const [c] = await tx
        .insert(customers)
        .values({ name: dto.name.trim(), phone, groupId, creditLimit: dto.creditLimit ?? rules.defaultCreditLimit, dueDate: dto.dueDate ?? addDays(todayISO(), rules.defaultCreditDays) })
        .returning({ id: customers.id, name: customers.name, creditLimit: customers.creditLimit });
      await this.audit.log(user, { action: 'add', module: 'Nasiya / Qarz', targetId: c.id, targetName: c.name, details: `Yangi mijoz, limit ${c.creditLimit.toLocaleString('ru-RU')} so'm` }, tx);
      return c.id;
    });
    return this.get(id);
  }

  async update(user: AuthUser, id: string, dto: CustomerDto): Promise<CustomerView> {
    const phone = canonicalPhone(dto.phone);
    if (!phone) throw unprocessable('validation_failed', "Telefon raqamini to'liq kiriting (+998 va 9 ta raqam)");
    await this.db.transaction(async (tx) => {
      const [old] = await tx.select().from(customers).where(and(eq(customers.id, id), isNull(customers.deletedAt))).limit(1).for('update');
      if (!old) throw notFound('Mijoz');
      assertVersion(old.version, dto.version, 'Mijoz');
      await this.assertPhoneFree(tx, phone, id);
      // total_debt faqat ledger orqali o'zgaradi; limit qarzdan kichik bo'lishi mumkin (keyingi nasiya rad etiladi)
      await tx
        .update(customers)
        .set({ name: dto.name.trim(), phone, groupId: dto.groupId === undefined ? old.groupId : dto.groupId, creditLimit: dto.creditLimit ?? old.creditLimit, dueDate: dto.dueDate === undefined ? old.dueDate : dto.dueDate, version: old.version + 1 })
        .where(eq(customers.id, id));
      await this.audit.log(user, {
        action: 'edit', module: 'Nasiya / Qarz', targetId: id, targetName: dto.name.trim(), details: "Mijoz ma'lumotlari tahrirlandi",
        diff: { before: { telefon: old.phone, limit: old.creditLimit, muddat: old.dueDate }, after: { telefon: phone, limit: dto.creditLimit ?? old.creditLimit, muddat: dto.dueDate === undefined ? old.dueDate : dto.dueDate } },
      }, tx);
    });
    return this.get(id);
  }

  /** TZ 8.11: faqat qarzi 0 bo'lsa, yumshoq. */
  async remove(user: AuthUser, id: string) {
    await this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(customers).where(and(eq(customers.id, id), isNull(customers.deletedAt))).limit(1).for('update');
      if (!c) throw notFound('Mijoz');
      if (c.totalDebt > 0) throw conflict('in_use', "Qarzi bor mijozni o'chirib bo'lmaydi");
      await tx.update(customers).set({ deletedAt: new Date(), phone: `${c.phone}#del#${Date.now()}` }).where(eq(customers.id, id));
      await this.audit.log(user, { action: 'delete', module: 'Nasiya / Qarz', targetId: id, targetName: c.name, details: "Mijoz o'chirildi" }, tx);
    });
  }

  /* ───────── Qarz jurnali (sotuv va to'lov servisi chaqiradi) ───────── */

  /** Mijoz qatorini qulflab qarzni o'zgartiradi, ledger yozadi. Qaytaradi: yangi qarz. */
  async applyDebt(tx: DbOrTx, p: { customerId: string; branchId: string; type: typeof debtLedger.$inferInsert.type; amount: number; refType: string; refId: string; userId: string; dueDays?: number; markPaid?: boolean; capAtZero?: boolean }) {
    const [c] = await tx.select().from(customers).where(and(eq(customers.id, p.customerId), isNull(customers.deletedAt))).limit(1).for('update');
    if (!c) throw notFound('Mijoz');
    let amount = p.amount;
    // Storno: mijoz chekdan keyin qisman to'lagan bo'lsa qarz 0 gacha kamayadi, ortig'i naqd qaytariladi (chaqiruvchi auditga yozadi)
    if (p.capAtZero && c.totalDebt + amount < 0) amount = -c.totalDebt;
    if (c.totalDebt + amount < 0) throw unprocessable('validation_failed', `Summa qarzdan katta (${c.totalDebt.toLocaleString('ru-RU')} so'm)`);
    const set: Partial<typeof customers.$inferInsert> = {};
    if (p.amount > 0 && p.dueDays != null) {
      // TZ 8.8: due_date = max(joriy muddat, bugun + N); muddat o'tgan bo'lsa yangi sana
      const today = todayISO();
      const next = addDays(today, p.dueDays);
      set.dueDate = c.dueDate && c.dueDate > next && c.dueDate >= today ? c.dueDate : next;
    }
    if (p.markPaid) set.lastPaidDate = todayISO();
    // Balans atomar yangilanadi (o'qib-yozish emas): qulf bilan birga ikki qavat himoya; natija ledger ga yoziladi
    const [upd] = await tx
      .update(customers)
      .set({ ...set, totalDebt: sql`${customers.totalDebt} + ${amount}` })
      .where(and(eq(customers.id, c.id), sql`${customers.totalDebt} + ${amount} >= 0`))
      .returning({ totalDebt: customers.totalDebt });
    if (!upd) throw unprocessable('validation_failed', `Summa qarzdan katta (${c.totalDebt.toLocaleString('ru-RU')} so'm)`);
    const balance = upd.totalDebt;
    if (amount !== 0) await tx.insert(debtLedger).values({ customerId: c.id, branchId: p.branchId, type: p.type, amount, balanceAfter: balance, refType: p.refType, refId: p.refId, userId: p.userId });
    return { before: balance - amount, after: balance, applied: amount, customer: c };
  }

  async ledger(id: string, q: { page: number; pageSize: number; offset: number }) {
    await this.get(id);
    const [items, [{ total }]] = await Promise.all([
      this.db.select().from(debtLedger).where(eq(debtLedger.customerId, id)).orderBy(desc(debtLedger.seq)).limit(q.pageSize).offset(q.offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(debtLedger).where(eq(debtLedger.customerId, id)),
    ]);
    return page(items, total, q);
  }
}
