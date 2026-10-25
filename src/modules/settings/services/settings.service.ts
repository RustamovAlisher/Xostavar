import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import {
  businessRules, categories, customerGroups, customers, expenseCategories, expenses, paymentMethods, products, productVariants,
  saleLines, salePayments, sizePresets, stockReceiptLines, storeSettings, suppliers, unitConversions, units,
} from '../../../entities/index.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { conflict, unprocessable } from '../../../common/errors/app-error.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { SettingsBundleDto } from '../dto/settings.dto.js';
import { DEFAULT_SETTINGS } from '../constants/settings.defaults.js';

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
    private readonly audit: AuditService,
  ) {}

  async getAll(db: DbOrTx = this.db) {
    const [[store], [rules], u, c, sp, cg, pm, s, ec] = await Promise.all([
      db.select().from(storeSettings).limit(1),
      db.select().from(businessRules).limit(1),
      db.select().from(units).orderBy(asc(units.sortOrder), asc(units.id)),
      db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.createdAt)),
      db.select().from(sizePresets).orderBy(asc(sizePresets.sortOrder)),
      db.select().from(customerGroups).orderBy(asc(customerGroups.sortOrder)),
      db.select().from(paymentMethods).orderBy(asc(paymentMethods.sortOrder)),
      db.select().from(suppliers).orderBy(asc(suppliers.name)),
      db.select().from(expenseCategories).orderBy(asc(expenseCategories.sortOrder)),
    ]);
    return { store, rules, units: u, categories: c, sizePresets: sp, customerGroups: cg, paymentMethods: pm, suppliers: s, expenseCategories: ec };
  }

  async getRules(db: DbOrTx = this.db) {
    const [r] = await db.select().from(businessRules).limit(1);
    return r;
  }

  /** PUT /settings. Tekshiruvlar frontend `validateSettings` + "ishlatilmoqda" qoidalari (TZ 7.2, 9.3). */
  async saveAll(actor: AuthUser, dto: SettingsBundleDto) {
    this.validateBundle(dto);
    await runTx(this.db, async (tx) => {
      // Birliklar avval yoziladi (kategoriya ularga tayanadi), o'chirilganlari kategoriyalardan keyin (FK)
      await this.upsertUnits(tx, dto);
      await this.saveCategories(tx, dto);
      await this.deleteRemovedUnits(tx, dto);
      await this.saveSizePresets(tx, dto);
      await this.saveNamed(tx, customerGroups, dto.customerGroups, 'Mijoz guruhi', async (ids) => {
        const [c] = await tx.select({ name: customers.name }).from(customers).where(and(inArray(customers.groupId, ids), isNull(customers.deletedAt))).limit(1);
        return c ? `"${c.name}" mijozi shu guruhda` : null;
      });
      await this.savePaymentMethods(tx, dto);
      await this.saveNamed(tx, suppliers, dto.suppliers, 'Yetkazib beruvchi', async () => null, (d) => ({ phone: d.phone?.trim() || null, note: d.note?.trim() || null }));
      await this.saveNamed(tx, expenseCategories, dto.expenseCategories, 'Xarajat kategoriyasi', async (ids) => {
        const [e] = await tx.select({ id: expenses.id }).from(expenses).where(and(inArray(expenses.categoryId, ids), isNull(expenses.voidedAt))).limit(1);
        return e ? 'xarajat yozuvlari bor' : null;
      }, (d) => ({ active: d.active ?? true }));
      const s = dto.store;
      await tx
        .insert(storeSettings)
        .values({ id: 1, name: s.name.trim(), subtitle: s.subtitle ?? '', address: s.address ?? '', phone: s.phone ?? '', taxId: s.taxId ?? '', receiptFooter: s.receiptFooter ?? '', printFormat: s.printFormat ?? 'thermal', paperWidthMm: s.paperWidthMm ?? 80 })
        .onConflictDoUpdate({
          target: storeSettings.id,
          set: { name: s.name.trim(), subtitle: s.subtitle ?? '', address: s.address ?? '', phone: s.phone ?? '', taxId: s.taxId ?? '', receiptFooter: s.receiptFooter ?? '', printFormat: s.printFormat ?? 'thermal', paperWidthMm: s.paperWidthMm ?? 80, version: sql`${storeSettings.version} + 1` },
        });
      const r = dto.rules;
      const rulesRow = {
        pieceLengthMeters: r.pieceLengthMeters, defaultCutLengthMeters: r.defaultCutLengthMeters, cutDeductionMode: r.cutDeductionMode,
        defaultMinStock: r.defaultMinStock, defaultCreditDays: r.defaultCreditDays, defaultCreditLimit: r.defaultCreditLimit,
        vatPct: r.vatPct, estimatedMarginPct: r.estimatedMarginPct, quickDownPaymentPcts: r.quickDownPaymentPcts,
        allowNegativeStock: r.allowNegativeStock, requireShift: r.requireShift, cashierMaxDiscount: r.cashierMaxDiscount,
      };
      await tx.insert(businessRules).values({ id: 1, ...rulesRow }).onConflictDoUpdate({ target: businessRules.id, set: { ...rulesRow, version: sql`${businessRules.version} + 1` } });
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
    for (const [i, u] of d.units.entries()) {
      const row = { name: u.name.trim(), short: u.short.trim(), precision: u.precision, sortOrder: i };
      await tx.insert(units).values({ id: u.id, ...row }).onConflictDoUpdate({ target: units.id, set: row });
    }
  }

  private async deleteRemovedUnits(tx: DbOrTx, d: SettingsBundleDto) {
    const keep = d.units.map((u) => u.id);
    // O'chirilayotgan birlik ishlatilayotgan bo'lsa — 409 (mahsulot, konversiya, chek, kirim, kategoriya shabloni)
    const removed = await tx.select({ id: units.id }).from(units).where(notInArray(units.id, keep));
    for (const { id } of removed) {
      const used =
        (await tx.select({ n: products.id }).from(products).where(eq(products.baseUnit, id)).limit(1)).length ||
        (await tx.select({ n: unitConversions.id }).from(unitConversions).where(eq(unitConversions.unit, id)).limit(1)).length ||
        (await tx.select({ n: saleLines.id }).from(saleLines).where(eq(saleLines.unit, id)).limit(1)).length ||
        (await tx.select({ n: stockReceiptLines.id }).from(stockReceiptLines).where(eq(stockReceiptLines.unit, id)).limit(1)).length;
      if (used) throw conflict('in_use', `"${id}" birligi ishlatilmoqda, o'chirib bo'lmaydi`, { unit: id });
    }
    if (removed.length) await tx.delete(units).where(inArray(units.id, removed.map((r) => r.id)));
  }

  private async saveCategories(tx: DbOrTx, d: SettingsBundleDto) {
    const keepIds = d.categories.map((c) => c.id).filter((x): x is string => !!x);
    const removed = await tx.select({ id: categories.id, name: categories.name }).from(categories).where(keepIds.length ? notInArray(categories.id, keepIds) : sql`true`);
    for (const r of removed) {
      const [p] = await tx.select({ name: products.name }).from(products).where(and(eq(products.categoryId, r.id), isNull(products.deletedAt))).limit(1);
      if (p) throw conflict('in_use', `"${p.name}" mahsuloti "${r.name}" kategoriyasida`, { category: r.id });
    }
    if (removed.length) await tx.delete(categories).where(inArray(categories.id, removed.map((r) => r.id)));
    for (const [i, c] of d.categories.entries()) {
      const row = { name: c.name.trim(), icon: c.icon ?? '📦', description: c.description ?? '', defaultBaseUnit: c.defaultBaseUnit, defaultIsDivisible: c.defaultIsDivisible ?? false, defaultConversions: c.defaultConversions ?? [], sortOrder: i };
      if (c.id) {
        const [upd] = await tx.update(categories).set({ ...row, version: sql`${categories.version} + 1` }).where(eq(categories.id, c.id)).returning({ id: categories.id });
        if (upd) continue;
      }
      const [ins] = await tx.insert(categories).values(c.id ? { id: c.id, ...row } : row).returning({ id: categories.id });
      c.id = ins.id; // andozalar shu id ga bog'lanadi
    }
  }

  private async saveSizePresets(tx: DbOrTx, d: SettingsBundleDto) {
    await tx.delete(sizePresets);
    if (d.sizePresets.length) {
      await tx.insert(sizePresets).values(d.sizePresets.map((s, i) => ({ id: s.id, categoryId: s.categoryId, name: s.name.trim(), kgPerMeter: s.kgPerMeter ?? null, sortOrder: i })));
    }
  }

  private async savePaymentMethods(tx: DbOrTx, d: SettingsBundleDto) {
    const existing = await tx.select().from(paymentMethods);
    const byId = new Map(existing.map((m) => [m.id, m]));
    const keep = new Set(d.paymentMethods.map((m) => m.id).filter(Boolean));
    for (const m of existing) {
      if (keep.has(m.id)) continue;
      if (m.system) throw conflict('in_use', `"${m.label}" tizim usuli, o'chirilmaydi`);
      const [used] = await tx.select({ id: salePayments.id }).from(salePayments).where(eq(salePayments.methodId, m.id)).limit(1);
      const [usedE] = used ? [used] : await tx.select({ id: expenses.id }).from(expenses).where(eq(expenses.methodId, m.id)).limit(1);
      if (used || usedE) throw conflict('in_use', `"${m.label}" to'lov usuli cheklarda ishlatilgan, o'chirib bo'lmaydi (o'chirib qo'yish mumkin)`);
      await tx.delete(paymentMethods).where(eq(paymentMethods.id, m.id));
    }
    for (const [i, m] of d.paymentMethods.entries()) {
      const old = m.id ? byId.get(m.id) : undefined;
      if (old) {
        // Tizim usuli va ishlatilgan usulning turi o'zgarmaydi
        let kind = m.kind;
        if (old.kind !== m.kind) {
          const [used] = await tx.select({ id: salePayments.id }).from(salePayments).where(eq(salePayments.methodId, old.id)).limit(1);
          if (old.system || used) kind = old.kind;
        }
        await tx.update(paymentMethods).set({ label: m.label.trim(), kind, enabled: m.enabled, sortOrder: i, version: sql`${paymentMethods.version} + 1` }).where(eq(paymentMethods.id, old.id));
      } else {
        if (m.kind === 'debt') throw unprocessable('validation_failed', 'Nasiya turi faqat tizim usulida bo\'ladi');
        const code = `pm_${Date.now().toString(36)}${i}`;
        await tx.insert(paymentMethods).values({ code, label: m.label.trim(), kind: m.kind, enabled: m.enabled, system: false, sortOrder: i });
      }
    }
  }

  /** Nomli lug'atlar (guruh, yetkazib beruvchi, xarajat kategoriyasi): id bo'yicha yangilash, qolganini o'chirish. */
  private async saveNamed<T extends { id?: string; name: string }>(
    tx: DbOrTx,
    table: typeof customerGroups | typeof suppliers | typeof expenseCategories,
    list: T[],
    what: string,
    inUse: (removedIds: string[]) => Promise<string | null>,
    extra: (d: T) => Record<string, unknown> = () => ({}),
  ) {
    const keep = list.map((x) => x.id).filter((x): x is string => !!x);
    const removed = await tx.select({ id: table.id, name: table.name }).from(table).where(keep.length ? notInArray(table.id, keep) : sql`true`);
    if (removed.length) {
      const reason = await inUse(removed.map((r) => r.id));
      if (reason) throw conflict('in_use', `${what} o'chirilmaydi: ${reason}`);
      await tx.delete(table).where(inArray(table.id, removed.map((r) => r.id)));
    }
    for (const [i, x] of list.entries()) {
      const row = { name: x.name.trim(), sortOrder: i, ...extra(x) } as Record<string, unknown>;
      if (x.id) {
        const upd = await tx.update(table).set(row).where(eq(table.id, x.id)).returning({ id: table.id });
        if (upd.length) continue;
      }
      await tx.insert(table).values({ ...(x.id ? { id: x.id } : {}), ...row } as typeof table.$inferInsert);
    }
  }

  /** TZ 9.3: standartga qaytarish, ishlatilayotgan yozuvlar saqlanadi. */
  async reset(actor: AuthUser) {
    const d = DEFAULT_SETTINGS;
    await runTx(this.db, async (tx) => {
      await tx.insert(storeSettings).values({ id: 1, ...d.store }).onConflictDoUpdate({ target: storeSettings.id, set: { ...d.store, version: sql`${storeSettings.version} + 1` } });
      await tx.insert(businessRules).values({ id: 1, ...d.rules }).onConflictDoUpdate({ target: businessRules.id, set: { ...d.rules, version: sql`${businessRules.version} + 1` } });
      for (const [i, u] of d.units.entries()) await tx.insert(units).values({ ...u, sortOrder: i }).onConflictDoUpdate({ target: units.id, set: { ...u, sortOrder: i } });
      // Standart to'lov usullari qayta nomlanadi va yoqiladi; maxsuslari qoladi
      for (const [i, m] of d.paymentMethods.entries()) {
        await tx.insert(paymentMethods).values({ ...m, sortOrder: i }).onConflictDoUpdate({ target: paymentMethods.code, set: { label: m.label, enabled: true, sortOrder: i } });
      }
      await this.audit.log(actor, { action: 'settings_reset', module: 'Sozlamalar', targetName: 'Tizim sozlamalari', details: 'Standartga qaytarildi (ishlatilayotgan yozuvlar saqlandi)' }, tx);
    });
    void productVariants; // (kategoriya/birlik o'chirilmaydi, shuning uchun bu yerda tekshiruv yo'q)
    return this.getAll();
  }
}
