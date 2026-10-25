import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { conflict, notFound } from '../../../common/errors/app-error.js';
import { addDays, codeFromName, todayISO } from '../../../common/utils/numbers.js';
import { assertVersion } from '../../../common/utils/version.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { CreateBranchDto, UpdateBranchDto } from '../dto/branches.dto.js';
import { toBranchOverview } from '../mappers/branches.mapper.js';
import { BranchesRepository } from '../repositories/branches.repository.js';

export type { BranchRow } from '../repositories/branches.repository.js';
export type { BranchOverviewItem } from '../mappers/branches.mapper.js';

@Injectable()
export class BranchesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: BranchesRepository,
    private readonly audit: AuditService,
  ) {}

  /** Faqat o'ziga biriktirilganlar; egasi hammasini (TZ 9.0). */
  async listFor(user: AuthUser) {
    return this.repo.list(user.allBranches ? undefined : user.branchIds);
  }

  async get(id: string) {
    const b = await this.repo.findById(id);
    if (!b) throw notFound('Filial');
    return b;
  }

  async create(actor: AuthUser, dto: CreateBranchDto) {
    const name = dto.name.trim();
    const existing = await this.repo.codesAndNames();
    if (existing.some((b) => b.name.toLowerCase() === name.toLowerCase())) throw conflict('duplicate_code', 'Bu nomli filial allaqachon bor');
    const code = dto.code ?? codeFromName(name, existing.map((b) => b.code));
    if (existing.some((b) => b.code === code)) throw conflict('duplicate_code', `"${code}" kodi band`);
    // Yozuv va audit bitta tranzaksiyada (TZ 11)
    return runTx(this.db, async (tx) => {
      const b = await this.repo.insert(tx, { name, code, address: dto.address?.trim() || null, phone: dto.phone?.trim() || null, receiptFooter: dto.receiptFooter?.trim() || null, isMain: existing.length === 0 });
      await this.audit.log(actor, { action: 'add', module: 'Filiallar', targetId: b.id, targetName: b.name, details: `Yangi filial (${b.code})` }, tx);
      return b;
    });
  }

  async update(actor: AuthUser, id: string, dto: UpdateBranchDto) {
    const old = await this.get(id);
    assertVersion(old.version, dto.version, 'Filial');
    if (dto.name && dto.name.trim().toLowerCase() !== old.name.toLowerCase()) {
      const dup = await this.repo.findIdByNameExcept(dto.name.trim().toLowerCase(), id);
      if (dup) throw conflict('duplicate_code', 'Bu nomli filial allaqachon bor');
    }
    return runTx(this.db, async (tx) => {
      const b = await this.repo.update(tx, id, {
        name: dto.name?.trim() ?? old.name,
        address: dto.address !== undefined ? dto.address.trim() || null : old.address,
        phone: dto.phone !== undefined ? dto.phone.trim() || null : old.phone,
        receiptFooter: dto.receiptFooter !== undefined ? dto.receiptFooter.trim() || null : old.receiptFooter,
        version: old.version + 1,
      });
      await this.audit.log(actor, {
        action: 'edit', module: 'Filiallar', targetId: id, targetName: b.name, details: "Filial ma'lumotlari tahrirlandi",
        diff: { before: { nomi: old.name, manzil: old.address, telefon: old.phone }, after: { nomi: b.name, manzil: b.address, telefon: b.phone } },
      }, tx);
      return b;
    });
  }

  /** TZ 7.0.1: kamida bitta faol filial qolsin, ochiq smena bo'lmasin. */
  async setActive(actor: AuthUser, id: string, active: boolean) {
    const b = await this.get(id);
    if (b.active === active) return b;
    return runTx(this.db, async (tx) => {
      if (!active) {
        // Barcha filial qatorlari qulflanadi: ikki admin bir vaqtda ikki filialni nofaol qilsa ham kamida bittasi faol qoladi
        await this.repo.lockAll(tx);
        if ((await this.repo.countActiveExcept(id, tx)) === 0) throw conflict('in_use', 'Kamida bitta faol filial qolishi kerak');
        if (await this.repo.hasOpenShift(id, tx)) throw conflict('in_use', "Smenasi ochiq filialni nofaol qilib bo'lmaydi — avval smenani yoping");
      }
      const row = await this.repo.update(tx, id, { active, version: b.version + 1 });
      await this.audit.log(actor, { action: 'edit', module: 'Filiallar', targetId: id, targetName: b.name, details: `Holat: ${active ? 'Faol' : 'Nofaol'}` }, tx);
      return row;
    });
  }

  /**
   * Bosh admin sahifasi (TZ 9.0): har filial bo'yicha bugungi/30 kunlik savdo, omborda xil tovar, ombor qiymati,
   * smena, xodimlar. Hammasi GROUP BY bilan — filial soniga bog'liq bo'lmagan 5 ta so'rov.
   */
  async overview(withCost: boolean) {
    const today = todayISO();
    const [list, salesAgg, stockAgg, openShifts, staff] = await this.repo.overviewRows(today, addDays(today, -29));
    return toBranchOverview(list, salesAgg, stockAgg, openShifts, staff, withCost);
  }
}
