import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { conflict, forbidden, isUniqueViolation, notFound, unprocessable } from '../../../common/errors/app-error.js';
import { page, type PageQuery } from '../../../common/utils/pagination.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { expectedCashOf, toShiftReport, toShiftTotals, type ShiftTotals } from '../mappers/shifts.mapper.js';
import { ShiftsRepository } from '../repositories/shifts.repository.js';

export type { ShiftTotals } from '../mappers/shifts.mapper.js';

/** Smenalar (TZ 7.7, 9.5): filialda bir vaqtda bitta ochiq smena; yopishda jamlar muzlatiladi. */
@Injectable()
export class ShiftsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: ShiftsRepository,
    private readonly audit: AuditService,
  ) {}

  current(branchId: string, tx?: DbOrTx) {
    return this.repo.findOpen(branchId, tx);
  }

  /**
   * Sotuv/qarz to'lovi oldidan (TZ 8.9): require_shift bo'lsa ochiq smena va u shu xodimniki (yoki admin) bo'lishi shart.
   * Tranzaksiya ichida chaqiriladi; ochiq smena id sini qaytaradi (bo'lmasa null).
   */
  async requireForSale(tx: DbOrTx, user: AuthUser, branchId: string, allowAdmin = false): Promise<string | null> {
    const [required, s] = await Promise.all([this.repo.requireShiftRule(tx), this.repo.findOpen(branchId, tx)]);
    if (!required) return s?.id ?? null;
    if (!s) throw unprocessable('shift_required', 'Avval smenani oching');
    if (s.openedBy !== user.id && !(allowAdmin && user.permissions.includes('manage_users'))) {
      throw forbidden(`Smena ${s.openedByName} nomida ochilgan`, 'shift_owned_by_other');
    }
    return s.id;
  }

  async open(user: AuthUser, branchId: string, openingCash = 0) {
    const existing = await this.repo.findOpen(branchId);
    if (existing) throw conflict('in_use', `Smena allaqachon ochiq (${existing.openedByName})`);
    const cash = Math.max(0, Math.round(openingCash));
    try {
      return await runTx(this.db, async (tx) => {
        const row = await this.repo.insertOpen(tx, { branchId, openedBy: user.id, openedByName: user.name, openingCash: cash });
        await this.audit.log(user, { action: 'shift_open', module: 'Kassa', targetId: row.id, targetName: 'Smena', details: `Smena ochildi, kassada ${cash.toLocaleString('ru-RU')} so'm`, branchId }, tx);
        return row;
      });
    } catch (e) {
      // Qisman unikal indeks: ikki kassir bir vaqtda ochsa — ikkinchisi 409
      if (isUniqueViolation(e)) throw conflict('in_use', 'Smena allaqachon ochiq');
      throw e;
    }
  }

  async totals(shiftId: string, tx?: DbOrTx): Promise<ShiftTotals> {
    const [payRows, saleRows, cashOut] = await this.repo.totalsRows(shiftId, tx);
    return toShiftTotals(payRows, saleRows, cashOut);
  }

  async close(user: AuthUser, branchId: string, countedCash?: number) {
    const s = await this.repo.findOpen(branchId);
    if (!s) throw notFound('Ochiq smena');
    if (s.openedBy !== user.id && !user.permissions.includes('manage_users')) {
      throw forbidden(`Smenani faqat ${s.openedByName} yoki administrator yopa oladi`, 'shift_owned_by_other');
    }
    return runTx(this.db, async (tx) => {
      const totals = await this.totals(s.id, tx);
      const expectedCash = expectedCashOf(s.openingCash, totals);
      const counted = countedCash != null ? Math.max(0, Math.round(countedCash)) : null;
      const row = await this.repo.closeIfOpen(tx, s.id, { closedBy: user.id, closedByName: user.name, totals: totals as unknown as Record<string, unknown>, expectedCash, closingCashCounted: counted });
      if (!row) throw conflict('in_use', 'Smena allaqachon yopilgan');
      const diff = counted != null ? counted - expectedCash : null;
      await this.audit.log(user, {
        action: 'shift_close', module: 'Kassa', targetId: s.id, targetName: 'Smena', branchId,
        details: `Smena yopildi: tushum ${totals.revenue.toLocaleString('ru-RU')} so'm, ${totals.receipts} ta chek, kutilgan naqd ${expectedCash.toLocaleString('ru-RU')}${diff != null ? `, sanaldi ${counted!.toLocaleString('ru-RU')} (farq ${diff >= 0 ? '+' : ''}${diff.toLocaleString('ru-RU')})` : ''}`,
      }, tx);
      return { ...row, totals };
    });
  }

  /** Yopilgan smenaning muzlatilgan jamlari storno/xarajat o'chirilgandan keyin qayta hisoblanadi (Z-hisobot eskirib qolmasin). */
  async refreezeIfClosed(tx: DbOrTx, shiftId: string | null | undefined) {
    if (!shiftId) return;
    const s = await this.repo.findById(shiftId, tx);
    if (!s?.closedAt) return;
    const totals = await this.totals(shiftId, tx);
    await this.repo.updateFrozenTotals(tx, shiftId, totals as unknown as Record<string, unknown>, expectedCashOf(s.openingCash, totals));
  }

  /** Z-hisobot: yopilgan smenada muzlatilgan jamlar, ochiqda joriy hisob. Filial xodimi faqat o'z filiali smenasini ko'radi. */
  async report(id: string, user?: AuthUser) {
    const s = await this.repo.findById(id);
    if (!s) throw notFound('Smena');
    if (user && !user.allBranches && !user.branchIds.includes(s.branchId)) throw forbidden("Bu filialga kirish huquqingiz yo'q", 'branch_forbidden');
    const [totals, methods] = await Promise.all([s.closedAt && s.totals ? (s.totals as unknown as ShiftTotals) : this.totals(id), this.repo.paymentMethodLabels()]);
    return toShiftReport(s, totals, methods);
  }

  async list(branchId: string, q: PageQuery & { from?: string; to?: string }) {
    const [items, total] = await this.repo.list(branchId, q);
    return page(items, total, q);
  }
}
