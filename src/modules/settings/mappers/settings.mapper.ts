import type { SettingsRepository } from '../repositories/settings.repository.js';

type AllRows = Awaited<ReturnType<SettingsRepository['allRows']>>;

/** GET /settings javobi — frontend `AppSettings` bilan mos. */
export type SettingsBundle = ReturnType<typeof toSettingsBundle>;

/** 9 ta so'rov natijasini bitta to'plamga yig'adi. */
export function toSettingsBundle([store, rules, units, categories, sizePresets, customerGroups, paymentMethods, suppliers, expenseCategories]: AllRows) {
  return { store, rules, units, categories, sizePresets, customerGroups, paymentMethods, suppliers, expenseCategories };
}
