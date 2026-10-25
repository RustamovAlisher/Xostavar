import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { conflict, unprocessable } from '../../../common/errors/app-error.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { SettingsBundleDto } from '../dto/settings.dto.js';
import { DEFAULT_SETTINGS } from '../constants/settings.defaults.js';
import { toSettingsBundle } from '../mappers/settings.mapper.js';
import { SettingsRepository, type NamedTable } from '../repositories/settings.repository.js';

export type { SettingsBundle } from '../mappers/settings.mapper.js';
export type { BusinessRulesRow } from '../repositories/settings.repository.js';

const dupName = (names: string[]) => {
  const seen = new Set<string>();
  for (const n of names) {
    const k = n.trim().toLowerCase();
    if (seen.has(k)) return n.trim();
    seen.add(k);
  }
  return null;
};

/**
 * Sozlamalar — barcha lug'atlar (TZ 7.2, 9.3). O'qish: 9 ta kichik so'rov parallel.
 * Saqlash: butun to'plam bitta tranzaksiyada, "ishlatilmoqda" tekshiruvlari bilan.
 */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: SettingsRepository,
    private readonly audit: AuditService,
  ) {}

  async getAll(db?: DbOrTx) {
    return toSettingsBundle(await this.repo.allRows(db));
  }

  getRules(db?: DbOrTx) {
    return this.repo.rules(db);
  }

  /** PUT /settings. Tekshiruvlar frontend `validateSettings` + "ishlatilmoqda" qoidalari (TZ 7.2, 9.3). */
  async saveAll(actor: AuthUser, dto: SettingsBundleDto) {
    this.validateBundle(dto);
    await runTx(this.db, async (tx) => {
      // Birliklar avval yoziladi (kategoriya ularga tayanadi), o'chirilganlari kategoriyalardan keyin (FK)
      await this.upsertUnits(tx, dto);
      await this.saveCategories(tx, dto);
      await this.deleteRemovedUnits(tx, dto);
      await this.repo.replaceSizePresets(tx, dto.sizePresets.map((s, i) => ({ id: s.id, categoryId: s.categoryId, name: s.name.trim(), kgPerMeter: s.kgPerMeter ?? null, sortOrder: i })));
      await this.saveNamed(tx, 'customerGroups', dto.customerGroups, 'Mijoz guruhi', async (ids) => {
        const c = await this.repo.customerInGroups(tx, ids);
        return c ? `"${c}" mijozi shu guruhda` : null;
      });
      await this.savePaymentMethods(tx, dto);
      await this.saveNamed(tx, 'suppliers', dto.suppliers, 'Yetkazib beruvchi', async () => null, (d) => ({ phone: d.phone?.trim() || null, note: d.note?.trim() || null }));
      await this.saveNamed(tx, 'expenseCategories', dto.expenseCategories, 'Xarajat kategoriyasi', async (ids) => ((await this.repo.expenseInCategories(tx, ids)) ? 'xarajat yozuvlari bor' : null), (d) => ({ active: d.active ?? true }));
      const s = dto.store;
      await this.repo.upsertStore(tx, { name: s.name.trim(), subtitle: s.subtitle ?? '', address: s.address ?? '', phone: s.phone ?? '', taxId: s.taxId ?? '', receiptFooter: s.receiptFooter ?? '', printFormat: s.printFormat ?? 'thermal', paperWidthMm: s.paperWidthMm ?? 80 });
      const r = dto.rules;
      await this.repo.upsertRules(tx, {
        pieceLengthMeters: r.pieceLengthMeters, defaultCutLengthMeters: r.defaultCutLengthMeters, cutDeductionMode: r.cutDeductionMode,
        defaultMinStock: r.defaultMinStock, defaultCreditDays: r.defaultCreditDays, defaultCreditLimit: r.defaultCreditLimit,
        vatPct: r.vatPct, estimatedMarginPct: r.estimatedMarginPct, quickDownPaymentPcts: r.quickDownPaymentPcts,
        allowNegativeStock: r.allowNegativeStock, requireShift: r.requireShift, cashierMaxDiscount: r.cashierMaxDiscount,
      });
      await this.audit.log(actor, { action: 'edit', module: 'Sozlamalar', targetName: 'Tizim sozlamalari', details: 'Sozlamalar yangilandi' }, tx);
    });
    return this.getAll();
  }

  private validateBundle(d: SettingsBundleDto) {
    const err = (m: string) => unprocessable('validation_failed', m);
    const unitIds = new Set(d.units.map((u) => u.id));
    if (unitIds.size !== d.units.length) throw err('Birlik kodi takrorlangan');
    const ds = dupName(d.units.map((u) => u.short));
    if (ds) throw err(`"${ds}" qisqa yozuvi takrorlangan`);
    if (!d.categories.length) throw err('Kamida bitta kategoriya qolsin');
    const dc = dupName(d.categories.map((c) => c.name));
    if (dc) throw err(`"${dc}" kategoriyasi takrorlangan`);
    for (const c of d.categories) {
      if (!unitIds.has(c.defaultBaseUnit)) throw err(`"${c.name}": asosiy birlik mavjud emas`);
      const used = new Set<string>();
      for (const x of c.defaultConversions ?? []) {
        if (!unitIds.has(x.unit)) throw err(`"${c.name}": qo'shimcha birlik mavjud emas`);
        if (x.unit === c.defaultBaseUnit) throw err(`"${c.name}": qo'shimcha birlik asosiy birlik bilan bir xil`);
        if (used.has(x.unit)) throw err(`"${c.name}": "${x.unit}" birligi ikki marta`);
        used.add(x.unit);
      }
    }
    if (!d.customerGroups.length) throw err('Kamida bitta mijoz guruhi qolsin');
    for (const [list, what] of [[d.customerGroups, 'guruh'], [d.suppliers, 'yetkazib beruvchi'], [d.expenseCategories, 'xarajat kategoriyasi']] as const) {
      const dn = dupName(list.map((x) => x.name));
      if (dn) throw err(`"${dn}" ${what} takrorlangan`);
    }
    if (!d.expenseCategories.length) throw err('Kamida bitta xarajat kategoriyasi qolsin');
    const dpm = dupName(d.paymentMethods.map((m) => m.label));
    if (dpm) throw err(`"${dpm}" to'lov usuli takrorlangan`);
    if (!d.paymentMethods.some((m) => m.enabled && m.kind !== 'debt')) throw err("Kamida bitta oddiy (qarz bo'lmagan) to'lov usuli yoqilgan bo'lsin");
  }

  private async upsertUnits(tx: DbOrTx, d: SettingsBundleDto) {
    for (const [i, u] of d.units.entries()) await this.repo.upsertUnit(tx, u.id, { name: u.name.trim(), short: u.short.trim(), precision: u.precision, sortOrder: i });
  }

  private async deleteRemovedUnits(tx: DbOrTx, d: SettingsBundleDto) {
    // O'chirilayotgan birlik ishlatilayotgan bo'lsa — 409 (mahsulot, konversiya, chek, kirim, kategoriya shabloni)
    const removed = await this.repo.unitIdsNotIn(tx, d.units.map((u) => u.id));
    for (const id of removed) {
      if (await this.repo.unitInUse(tx, id)) throw conflict('in_use', `"${id}" birligi ishlatilmoqda, o'chirib bo'lmaydi`, { unit: id });
    }
    if (removed.length) await this.repo.deleteUnits(tx, removed);
  }

  private async saveCategories(tx: DbOrTx, d: SettingsBundleDto) {
    const removed = await this.repo.categoriesNotIn(tx, d.categories.map((c) => c.id).filter((x): x is string => !!x));
    for (const r of removed) {
      const p = await this.repo.productInCategory(tx, r.id);
      if (p) throw conflict('in_use', `"${p}" mahsuloti "${r.name}" kategoriyasida`, { category: r.id });
    }
    if (removed.length) await this.repo.deleteCategories(tx, removed.map((r) => r.id));
    for (const [i, c] of d.categories.entries()) {
      const row = { name: c.name.trim(), icon: c.icon ?? '📦', description: c.description ?? '', defaultBaseUnit: c.defaultBaseUnit, defaultIsDivisible: c.defaultIsDivisible ?? false, defaultConversions: c.defaultConversions ?? [], sortOrder: i };
      if (c.id && (await this.repo.updateCategory(tx, c.id, row))) continue;
      c.id = await this.repo.insertCategory(tx, c.id, row); // andozalar shu id ga bog'lanadi
    }
  }

  private async savePaymentMethods(tx: DbOrTx, d: SettingsBundleDto) {
    const existing = await this.repo.allPaymentMethods(tx);
    const byId = new Map(existing.map((m) => [m.id, m]));
    const keep = new Set(d.paymentMethods.map((m) => m.id).filter(Boolean));
    for (const m of existing) {
      if (keep.has(m.id)) continue;
      if (m.system) throw conflict('in_use', `"${m.label}" tizim usuli, o'chirilmaydi`);
      const used = (await this.repo.paymentMethodUsedInSales(tx, m.id)) || (await this.repo.paymentMethodUsedInExpenses(tx, m.id));
      if (used) throw conflict('in_use', `"${m.label}" to'lov usuli cheklarda ishlatilgan, o'chirib bo'lmaydi (o'chirib qo'yish mumkin)`);
      await this.repo.deletePaymentMethod(tx, m.id);
    }
    for (const [i, m] of d.paymentMethods.entries()) {
      const old = m.id ? byId.get(m.id) : undefined;
      if (old) {
        // Tizim usuli va ishlatilgan (chek yoki xarajat) usulning turi o'zgarmaydi — Z-hisobot naqd hisobi buzilmasin
        let kind = m.kind;
        if (old.kind !== m.kind && (old.system || (await this.repo.paymentMethodUsedInSales(tx, old.id)) || (await this.repo.paymentMethodUsedInExpenses(tx, old.id)))) kind = old.kind;
        await this.repo.updatePaymentMethod(tx, old.id, { label: m.label.trim(), kind, enabled: m.enabled, sortOrder: i });
      } else {
        if (m.kind === 'debt') throw unprocessable('validation_failed', "Nasiya turi faqat tizim usulida bo'ladi");
        await this.repo.insertPaymentMethod(tx, { code: `pm_${Date.now().toString(36)}${i}`, label: m.label.trim(), kind: m.kind, enabled: m.enabled, system: false, sortOrder: i });
      }
    }
  }

  /** Nomli lug'atlar (guruh, yetkazib beruvchi, xarajat kategoriyasi): id bo'yicha yangilash, qolganini o'chirish. */
  private async saveNamed<T extends { id?: string; name: string }>(
    tx: DbOrTx,
    table: NamedTable,
    list: T[],
    what: string,
    inUse: (removedIds: string[]) => Promise<string | null>,
    extra: (d: T) => Record<string, unknown> = () => ({}),
  ) {
    const removed = await this.repo.namedNotIn(tx, table, list.map((x) => x.id).filter((x): x is string => !!x));
    if (removed.length) {
      const reason = await inUse(removed.map((r) => r.id));
      if (reason) throw conflict('in_use', `${what} o'chirilmaydi: ${reason}`);
      await this.repo.deleteNamed(tx, table, removed.map((r) => r.id));
    }
    for (const [i, x] of list.entries()) {
      const row = { name: x.name.trim(), sortOrder: i, ...extra(x) };
      if (x.id && (await this.repo.updateNamed(tx, table, x.id, row))) continue;
      await this.repo.insertNamed(tx, table, { ...(x.id ? { id: x.id } : {}), ...row });
    }
  }

  /** TZ 9.3: standartga qaytarish, ishlatilayotgan yozuvlar saqlanadi. */
  async reset(actor: AuthUser) {
    const d = DEFAULT_SETTINGS;
    await runTx(this.db, async (tx) => {
      await this.repo.upsertStore(tx, d.store);
      await this.repo.upsertRules(tx, d.rules);
      for (const [i, { id, ...u }] of d.units.entries()) await this.repo.upsertUnit(tx, id, { ...u, sortOrder: i });
      // Standart to'lov usullari qayta nomlanadi va yoqiladi; maxsuslari qoladi
      for (const [i, m] of d.paymentMethods.entries()) await this.repo.upsertDefaultPaymentMethod(tx, { ...m, sortOrder: i });
      // (kategoriya/birlik o'chirilmaydi, shuning uchun bu yerda "ishlatilmoqda" tekshiruvi yo'q)
      await this.audit.log(actor, { action: 'settings_reset', module: 'Sozlamalar', targetName: 'Tizim sozlamalari', details: 'Standartga qaytarildi (ishlatilayotgan yozuvlar saqlandi)' }, tx);
    });
    return this.getAll();
  }
}
