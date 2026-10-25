import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { conflict, isUniqueViolation, notFound, unprocessable } from '../../../common/errors/app-error.js';
import { addDays, canonicalPhone, todayISO } from '../../../common/utils/numbers.js';
import { page } from '../../../common/utils/pagination.js';
import { assertVersion } from '../../../common/utils/version.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { SettingsService } from '../../settings/services/settings.service.js';
import type { CustomerDto, CustomerListQuery } from '../dto/customers.dto.js';
import { toCustomerView, type CustomerView } from '../mappers/customers.mapper.js';
import { CustomersRepository, type CustomerInsert, type DebtLedgerInsert } from '../repositories/customers.repository.js';

export type { CustomerView } from '../mappers/customers.mapper.js';

/** Mijozlar umumiy (TZ 7.5): istalgan filialdan xarid, qarz va limit umumiy. */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: CustomersRepository,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** Ro'yxat: 2 ta so'rov (mijozlar + guruh join, jami). Tartib: muddati o'tganlar, keyin qarz kamayishi bo'yicha. */
  async list(q: CustomerListQuery) {
    const today = todayISO();
    const [rows, total] = await this.repo.list(q, today);
    return page(rows.map((r) => toCustomerView(r.c, r.g, today)), total, q);
  }

  async get(id: string, db?: DbOrTx): Promise<CustomerView> {
    const r = await this.repo.findWithGroup(id, db);
    if (!r) throw notFound('Mijoz');
    return toCustomerView(r.c, r.g);
  }

  private async assertPhoneFree(tx: DbOrTx, phone: string, exceptId?: string) {
    const dup = await this.repo.findByPhone(phone, exceptId, tx);
    if (dup) throw conflict('duplicate_code', `Bu telefon raqami allaqachon mavjud: ${dup.name}`);
  }

  private parsePhone(raw: string) {
    const phone = canonicalPhone(raw);
    if (!phone) throw unprocessable('validation_failed', "Telefon raqamini to'liq kiriting (+998 va 9 ta raqam)");
    return phone;
  }

  /** Unikal indeks `customers_phone_uq`: ikki kassir bir vaqtda bir raqam bilan yaratsa — ikkinchisi 409 (500 emas). */
  private phoneConflict(e: unknown): never {
    if (isUniqueViolation(e)) throw conflict('duplicate_code', 'Bu telefon raqami allaqachon mavjud');
    throw e;
  }

  async create(user: AuthUser, dto: CustomerDto): Promise<CustomerView> {
    const phone = this.parsePhone(dto.phone);
    const rules = await this.settings.getRules();
    const id = await runTx(this.db, async (tx) => {
      await this.assertPhoneFree(tx, phone);
      const groupId = dto.groupId ?? (await this.repo.firstGroupId(tx));
      const c = await this.repo.insert(tx, { name: dto.name.trim(), phone, groupId, creditLimit: dto.creditLimit ?? rules.defaultCreditLimit, dueDate: dto.dueDate ?? addDays(todayISO(), rules.defaultCreditDays) });
      await this.audit.log(user, { action: 'add', module: 'Nasiya / Qarz', targetId: c.id, targetName: c.name, details: `Yangi mijoz, limit ${c.creditLimit.toLocaleString('ru-RU')} so'm` }, tx);
      return c.id;
    }).catch((e) => this.phoneConflict(e));
    return this.get(id);
  }

  async update(user: AuthUser, id: string, dto: CustomerDto): Promise<CustomerView> {
    const phone = this.parsePhone(dto.phone);
    await runTx(this.db, async (tx) => {
      const old = await this.repo.lockById(tx, id);
      if (!old) throw notFound('Mijoz');
      assertVersion(old.version, dto.version, 'Mijoz');
      await this.assertPhoneFree(tx, phone, id);
      // total_debt faqat ledger orqali o'zgaradi; limit qarzdan kichik bo'lishi mumkin (keyingi nasiya rad etiladi)
      const next = { name: dto.name.trim(), phone, groupId: dto.groupId === undefined ? old.groupId : dto.groupId, creditLimit: dto.creditLimit ?? old.creditLimit, dueDate: dto.dueDate === undefined ? old.dueDate : dto.dueDate };
      await this.repo.update(tx, id, { ...next, version: old.version + 1 });
      await this.audit.log(user, {
        action: 'edit', module: 'Nasiya / Qarz', targetId: id, targetName: next.name, details: "Mijoz ma'lumotlari tahrirlandi",
        diff: { before: { telefon: old.phone, limit: old.creditLimit, muddat: old.dueDate }, after: { telefon: phone, limit: next.creditLimit, muddat: next.dueDate } },
      }, tx);
    }).catch((e) => this.phoneConflict(e));
    return this.get(id);
  }

  /** TZ 8.11: faqat qarzi 0 bo'lsa, yumshoq. */
  async remove(user: AuthUser, id: string) {
    await runTx(this.db, async (tx) => {
      const c = await this.repo.lockById(tx, id);
      if (!c) throw notFound('Mijoz');
      if (c.totalDebt > 0) throw conflict('in_use', "Qarzi bor mijozni o'chirib bo'lmaydi");
      await this.repo.softDelete(tx, id, c.phone);
      await this.audit.log(user, { action: 'delete', module: 'Nasiya / Qarz', targetId: id, targetName: c.name, details: "Mijoz o'chirildi" }, tx);
    });
  }

  /* ───────── Qarz jurnali (sotuv va to'lov servisi chaqiradi) ───────── */

  /** Mijoz qatorini qulflab qarzni o'zgartiradi, ledger yozadi. Qaytaradi: yangi qarz. */
  async applyDebt(tx: DbOrTx, p: { customerId: string; branchId: string; type: DebtLedgerInsert['type']; amount: number; refType: string; refId: string; userId: string; dueDays?: number; markPaid?: boolean; capAtZero?: boolean }) {
    const c = await this.repo.lockById(tx, p.customerId);
    if (!c) throw notFound('Mijoz');
    let amount = p.amount;
    // Storno: mijoz chekdan keyin qisman to'lagan bo'lsa qarz 0 gacha kamayadi, ortig'i naqd qaytariladi (chaqiruvchi auditga yozadi)
    if (p.capAtZero && c.totalDebt + amount < 0) amount = -c.totalDebt;
    if (c.totalDebt + amount < 0) throw unprocessable('validation_failed', `Summa qarzdan katta (${c.totalDebt.toLocaleString('ru-RU')} so'm)`);
    const set: Partial<Pick<CustomerInsert, 'dueDate' | 'lastPaidDate'>> = {};
    if (p.amount > 0 && p.dueDays != null) {
      // TZ 8.8: due_date = max(joriy muddat, bugun + N); muddat o'tgan bo'lsa yangi sana
      const today = todayISO();
      const next = addDays(today, p.dueDays);
      set.dueDate = c.dueDate && c.dueDate > next && c.dueDate >= today ? c.dueDate : next;
    }
    if (p.markPaid) set.lastPaidDate = todayISO();
    // Balans atomar yangilanadi (o'qib-yozish emas): qulf bilan birga ikki qavat himoya; natija ledger ga yoziladi
    const balance = await this.repo.addDebt(tx, c.id, amount, set);
    if (balance == null) throw unprocessable('validation_failed', `Summa qarzdan katta (${c.totalDebt.toLocaleString('ru-RU')} so'm)`);
    if (amount !== 0) await this.repo.insertLedger(tx, { customerId: c.id, branchId: p.branchId, type: p.type, amount, balanceAfter: balance, refType: p.refType, refId: p.refId, userId: p.userId });
    return { before: balance - amount, after: balance, applied: amount, customer: c };
  }

  async ledger(id: string, q: { page: number; pageSize: number; offset: number }) {
    await this.get(id);
    const [items, total] = await this.repo.ledger(id, q);
    return page(items, total, q);
  }
}
