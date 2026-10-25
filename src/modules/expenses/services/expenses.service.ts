import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { conflict, forbidden, notFound, unprocessable } from '../../../common/errors/app-error.js';
import { page } from '../../../common/utils/pagination.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { ShiftsService } from '../../shifts/services/shifts.service.js';
import type { ExpenseDto, ExpenseListQuery, ExpensePatchDto } from '../dto/expenses.dto.js';
import { toExpenseItem, toExpenseSummary } from '../mappers/expenses.mapper.js';
import { ExpensesRepository } from '../repositories/expenses.repository.js';

export type { ExpenseItem } from '../mappers/expenses.mapper.js';

/** Operatsion xarajatlar (TZ 7.11, 9.12). Kassadan chiqim ochiq smenaga bog'lanadi. */
@Injectable()
export class ExpensesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: ExpensesRepository,
    private readonly audit: AuditService,
    private readonly shifts: ShiftsService,
  ) {}

  async create(user: AuthUser, branchId: string, dto: ExpenseDto, requestId?: string) {
    const id = await runTx(this.db, async (tx) => {
      const cat = await this.repo.findCategory(dto.categoryId, tx);
      if (!cat || !cat.active) throw notFound('Xarajat kategoriyasi');
      const m = await this.repo.findPaymentMethod(tx, dto.methodId);
      if (!m || !m.enabled || m.kind === 'debt') throw unprocessable('payment_method_disabled', "To'lov usuli noto'g'ri yoki o'chirilgan");
      let shiftId: string | null = null;
      if (dto.source === 'cash_register') {
        if (m.kind !== 'cash') throw unprocessable('validation_failed', "Kassadan chiqim faqat naqd pul usuli bilan bo'ladi");
        const s = await this.shifts.current(branchId, tx);
        if (!s) throw unprocessable('shift_required', "Kassadan chiqim uchun smena ochiq bo'lishi kerak");
        if (s.openedBy !== user.id && !user.permissions.includes('manage_users')) throw forbidden(`Smena ${s.openedByName} nomida ochilgan`, 'shift_owned_by_other');
        shiftId = s.id;
      }
      const id = await this.repo.insert(tx, { branchId, date: dto.date, categoryId: cat.id, amount: Math.round(dto.amount), methodId: m.id, source: dto.source, shiftId, supplierId: dto.supplierId ?? null, note: dto.note?.trim() || null, createdBy: user.id, createdByName: user.name });
      await this.audit.log(user, { action: 'expense', module: 'Xarajatlar', targetId: id, targetName: cat.name, branchId, requestId, details: `${dto.amount.toLocaleString('ru-RU')} so'm, ${m.label.toLowerCase()}${dto.source === 'cash_register' ? ', kassadan' : ''}${dto.note ? ` — ${dto.note.trim()}` : ''}` }, tx);
      return id;
    });
    return this.get(id);
  }

  async get(id: string) {
    const e = await this.repo.findById(id);
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
      const cat = await this.repo.findCategory(dto.categoryId);
      if (!cat || !cat.active) throw notFound('Xarajat kategoriyasi');
    }
    // Tekshiruv bilan yozish orasida o'chirilgan bo'lsa — o'chirilgan yozuv tahrirlanmasin
    const row = await this.repo.updateIfActive(id, { date: dto.date ?? e.date, categoryId: dto.categoryId ?? e.categoryId, note: dto.note !== undefined ? dto.note.trim() || null : e.note });
    if (!row) throw conflict('already_voided', "Bu xarajat o'chirilgan");
    await this.audit.log(user, { action: 'edit', module: 'Xarajatlar', targetId: id, targetName: 'Xarajat', branchId, details: 'Xarajat tahrirlandi' });
    return row;
  }

  async void(user: AuthUser, branchId: string, id: string, requestId?: string) {
    const e = await this.get(id);
    if (e.branchId !== branchId) throw forbidden('Boshqa filial xarajati', 'branch_forbidden');
    if (e.voidedAt) throw conflict('already_voided', "Bu xarajat allaqachon o'chirilgan");
    if (e.createdBy !== user.id && !user.permissions.includes('manage_users')) throw forbidden("Boshqa xodim yozgan xarajatni faqat administrator o'chiradi");
    const cat = await this.repo.findCategory(e.categoryId);
    return runTx(this.db, async (tx) => {
      const row = await this.repo.voidIfActive(tx, id, user.id);
      if (!row) throw conflict('already_voided', "Bu xarajat allaqachon o'chirilgan");
      await this.shifts.refreezeIfClosed(tx, e.shiftId); // kassadan chiqim yopilgan smenada bo'lsa Z-hisobot yangilanadi
      await this.audit.log(user, { action: 'delete', module: 'Xarajatlar', targetId: id, targetName: cat?.name ?? 'Xarajat', branchId, requestId, details: `${e.amount.toLocaleString('ru-RU')} so'm xarajat o'chirildi` }, tx);
      return row;
    });
  }

  /** Ro'yxat + kategoriya bo'yicha jami (2 ta GROUP BY so'rov). Egasi `branchId=all` bilan hammasini ko'radi. */
  async list(user: AuthUser, branchId: string, q: ExpenseListQuery) {
    const all = q.branchId === 'all' && user.allBranches;
    const [items, total, byCat, sums] = await this.repo.list(all ? null : q.branchId && user.allBranches ? q.branchId : branchId, q);
    return { ...page(items.map(toExpenseItem), total, q), summary: toExpenseSummary(sums, byCat) };
  }
}
