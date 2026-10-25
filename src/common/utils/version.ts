import { conflict } from '../errors/app-error.js';

/** Optimistik bloklash (TZ 5): mijoz yuborgan `version` bazadagiga mos bo'lmasa 409. */
export function assertVersion(current: number, provided: number | undefined, what = 'Yozuv') {
  if (provided == null) return;
  if (provided !== current) {
    throw conflict('version_conflict', `${what} boshqa foydalanuvchi tomonidan o'zgartirilgan, sahifani yangilang`, { current, provided });
  }
}
