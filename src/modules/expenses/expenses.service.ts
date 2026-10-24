import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { DB, type Db } from '../../db/db.module.js';
import { runTx } from '../../db/tx.js';
import { expenseCategories, expenses, paymentMethods } from '../../db/schema/index.js';
import type { AuthUser } from '../../common/auth-context.js';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors.js';
import { page } from '../../common/pagination.js';
import { AuditService } from '../audit/audit.service.js';
import { ShiftsService } from '../shifts/shifts.service.js';
import type { ExpenseDto, ExpenseListQuery, ExpensePatchDto } from './expenses.dto.js';

/** Operatsion xarajatlar (TZ 7.11, 9.12). Kassadan chiqim ochiq smenaga bog'lanadi. */
@Injectable()
export class ExpensesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly shifts: ShiftsService,
  ) {}

  async create(user: AuthUser, branchId: string, dto: ExpenseDto, requestId?: string) {
    const id = await runTx(this.db, async (tx) => {
      const [cat] = await tx.select().from(expenseCategories).where(eq(expenseCategories.id, dto.categoryId)).limit(1);
      if (!cat || !cat.active) throw notFound('Xarajat kategoriyasi');
      const [m] = await tx.select().from(paymentMethods).where(eq(paymentMethods.id, dto.methodId)).limit(1);
      if (!m || !m.enabled || m.kind === 'debt') throw unprocessable('payment_method_disabled', "To'lov usuli noto'g'ri yoki o'chirilgan");
      let shiftId: string | null = null;
      if (dto.source === 'cash_register') {
        if (m.kind !== 'cash') throw unprocessable('validation_failed', "Kassadan chiqim faqat naqd pul usuli bilan bo'ladi");
        const s = await this.shifts.current(branchId, tx);
        if (!s) throw unprocessable('shift_required', "Kassadan chiqim uchun smena ochiq bo'lishi kerak");
        if (s.openedBy !== user.id && !user.permissions.includes('manage_users')) throw forbidden(`Smena ${s.openedByName} nomida ochilgan`, 'shift_owned_by_other');
        shiftId = s.id;
      }
      const [e] = await tx
        .insert(expenses)
        .values({ branchId, date: dto.date, categoryId: cat.id, amount: Math.round(dto.amount), methodId: m.id, source: dto.source, shiftId, supplierId: dto.supplierId ?? null, note: dto.note?.trim() || null, createdBy: user.id, createdByName: user.name })
        .returning({ id: expenses.id });
      await this.audit.log(user, { action: 'expense', module: 'Xarajatlar', targetId: e.id, targetName: cat.name, branchId, requestId, details: `${dto.amount.toLocaleString('ru-RU')} so'm, ${m.label.toLowerCase()}${dto.source === 'cash_register' ? ', kassadan' : ''}${dto.note ? ` — ${dto.note.trim()}` : ''}` }, tx);
      return e.id;
    });
    return this.get(id);
  }

  async get(id: string) {
    const [e] = await this.db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
    if (!e) throw notFound('Xarajat');
    return e;
  }

  /** Faqat sana, kategoriya, izoh o'zgaradi; summa/usul o'zgarsa — o'chirib qayta yoziladi (smena hisobi buzilmasin). */
  async patch(user: AuthUser, branchId: string, id: string, dto: ExpensePatchDto) {
    const e = await this.get(id);
    if (e.branchId !== branchId) throw forbidden('Boshqa filial xarajati', 'branch_forbidden');
    if (e.voidedAt) throw conflict('already_voided', "Bu xarajat o'chirilgan");
    if (e.createdBy !== user.id && !user.permissions.includes('manage_users')) throw forbidden("Boshqa xodim yozgan xarajatni faqat administrator o'zgartiradi");
    if (dto.categoryId) {
      const [cat] = await this.db.select({ id: expenseCategories.id }).from(expenseCategories).where(eq(expenseCategories.id, dto.categoryId)).limit(1);
      if (!cat) throw notFound('Xarajat kategoriyasi');
    }
    const [row] = await this.db.update(expenses).set({ date: dto.date ?? e.date, categoryId: dto.categoryId ?? e.categoryId, note: dto.note !== undefined ? dto.note.trim() || null : e.note }).where(eq(expenses.id, id)).returning();
    await this.audit.log(user, { action: 'edit', module: 'Xarajatlar', targetId: id, targetName: 'Xarajat', branchId, details: 'Xarajat tahrirlandi' });
    return row;
  }

  async void(user: AuthUser, branchId: string, id: string, requestId?: string) {
    const e = await this.get(id);
    if (e.branchId !== branchId) throw forbidden('Boshqa filial xarajati', 'branch_forbidden');
    if (e.voidedAt) throw conflict('already_voided', "Bu xarajat allaqachon o'chirilgan");
    if (e.createdBy !== user.id && !user.permissions.includes('manage_users')) throw forbidden("Boshqa xodim yozgan xarajatni faqat administrator o'chiradi");
    const [row] = await this.db.update(expenses).set({ voidedAt: new Date(), voidedBy: user.id }).where(eq(expenses.id, id)).returning();
    const [cat] = await this.db.select({ name: expenseCategories.name }).from(expenseCategories).where(eq(expenseCategories.id, e.categoryId)).limit(1);
    await this.audit.log(user, { action: 'delete', module: 'Xarajatlar', targetId: id, targetName: cat?.name ?? 'Xarajat', branchId, requestId, details: `${e.amount.toLocaleString('ru-RU')} so'm xarajat o'chirildi` });
    return row;
  }

  /** Ro'yxat + kategoriya bo'yicha jami (2 ta GROUP BY so'rov). Egasi `branchId=all` bilan hammasini ko'radi. */
  async list(user: AuthUser, branchId: string, q: ExpenseListQuery) {
    const all = q.branchId === 'all' && user.allBranches;
    const where = and(
      all ? undefined : eq(expenses.branchId, q.branchId && user.allBranches ? q.branchId : branchId),
      isNull(expenses.voidedAt),
      q.from ? gte(expenses.date, q.from) : undefined,
      q.to ? lte(expenses.date, q.to) : undefined,
      q.categoryId ? eq(expenses.categoryId, q.categoryId) : undefined,
      q.source ? eq(expenses.source, q.source) : undefined,
    );
    const [items, [{ total }], byCat, [sums]] = await Promise.all([
      this.db.select({ e: expenses, category: expenseCategories.name, method: paymentMethods.label }).from(expenses).innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId)).innerJoin(paymentMethods, eq(paymentMethods.id, expenses.methodId)).where(where).orderBy(desc(expenses.date), desc(expenses.createdAt)).limit(q.pageSize).offset(q.offset),
      this.db.select({ total: sql<number>`count(*)::int` }).from(expenses).where(where),
      this.db.select({ categoryId: expenses.categoryId, name: expenseCategories.name, sum: sql<number>`sum(${expenses.amount})::bigint` }).from(expenses).innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId)).where(where).groupBy(expenses.categoryId, expenseCategories.name).orderBy(desc(sql`sum(${expenses.amount})`)),
      this.db.select({ sum: sql<number>`coalesce(sum(${expenses.amount}), 0)::bigint`, fromRegister: sql<number>`coalesce(sum(case when ${expenses.source} = 'cash_register' then ${expenses.amount} end), 0)::bigint` }).from(expenses).where(where),
    ]);
    return { ...page(items.map((r) => ({ ...r.e, category: r.category, method: r.method })), total, q), summary: { sum: sums.sum, fromRegister: sums.fromRegister, byCategory: byCat } };
  }
}
