import type { ErrorCode } from './errors.js';

/**
 * Postgres xatolarini foydalanuvchiga tushunarli javobga aylantirish.
 * Drizzle xatoni `DrizzleQueryError` ichiga o'raydi — asl pg xatosi `cause` da.
 */
interface PgError {
  code?: string;
  constraint?: string;
  table?: string;
  column?: string;
  detail?: string;
}

export function pgErrorOf(e: unknown): PgError | null {
  const direct = e as PgError & { cause?: PgError };
  if (direct?.code && /^[0-9A-Z]{5}$/.test(direct.code)) return direct;
  if (direct?.cause?.code && /^[0-9A-Z]{5}$/.test(direct.cause.code)) return direct.cause;
  return null;
}

/** Deadlock yoki serialization xatosi — tranzaksiyani qayta urinish mumkin. */
export function isRetryable(e: unknown): boolean {
  const code = pgErrorOf(e)?.code;
  return code === '40P01' || code === '40001';
}

/** Unikal indeks nomi → foydalanuvchiga tushunarli xabar. Topilmasa umumiy. */
const UNIQUE_MESSAGES: Record<string, string> = {
  users_username_lower_uq: 'Bu login band',
  users_email_lower_uq: 'Bu email band',
  roles_name_lower_uq: 'Bu nomli rol allaqachon bor',
  branches_code_uq: 'Bu filial kodi band',
  branches_name_lower_uq: 'Bu nomli filial allaqachon bor',
  units_short_lower_uq: "Bu qisqa yozuvli birlik allaqachon bor",
  categories_name_lower_uq: 'Bu nomli kategoriya allaqachon bor',
  size_presets_cat_name_uq: "Bu o'lcham andozasi allaqachon bor",
  customer_groups_name_lower_uq: 'Bu nomli mijoz guruhi allaqachon bor',
  payment_methods_code_uq: "Bu to'lov usuli kodi band",
  payment_methods_label_lower_uq: "Bu nomli to'lov usuli allaqachon bor",
  suppliers_name_lower_uq: 'Bu nomli yetkazib beruvchi allaqachon bor',
  expense_categories_name_lower_uq: 'Bu nomli xarajat kategoriyasi allaqachon bor',
  products_sku_lower_uq: 'Bu SKU boshqa mahsulotda bor',
  product_variants_sku_lower_uq: 'Bu SKU boshqa variantda bor',
  product_barcodes_barcode_lower_uq: 'Bu shtrix-kod boshqa mahsulotda bor',
  unit_conversions_target_unit_uq: 'Bu birlik mahsulotda ikki marta kiritilgan',
  customers_phone_uq: 'Bu telefon raqami allaqachon mavjud',
  shifts_one_open_per_branch_uq: 'Bu filialda smena allaqachon ochiq',
  sales_number_uq: "Chek raqami band, qayta urinib ko'ring",
  sales_client_id_uq: 'Bu chek allaqachon yuborilgan',
  stock_receipts_branch_number_uq: "Kirim raqami band, qayta urinib ko'ring",
  stock_levels_target_uq: 'Ombor qatori allaqachon mavjud',
  branch_prices_target_uq: 'Filial narxi allaqachon mavjud',
};

export function translatePgError(e: unknown): { status: number; code: ErrorCode; message: string; details?: Record<string, unknown> } | null {
  const pg = pgErrorOf(e);
  if (!pg?.code) return null;
  const details = { constraint: pg.constraint, table: pg.table, column: pg.column };
  switch (pg.code) {
    case '23505':
      return { status: 409, code: 'duplicate_code', message: (pg.constraint && UNIQUE_MESSAGES[pg.constraint]) ?? 'Bunday yozuv allaqachon mavjud', details };
    case '23503':
      // Insert/update: ko'rsatilgan yozuv yo'q; delete: bog'liq yozuvlar bor
      return pg.detail?.includes('is still referenced')
        ? { status: 409, code: 'in_use', message: "Bu yozuv boshqa yozuvlarda ishlatilmoqda, o'chirib bo'lmaydi", details }
        : { status: 422, code: 'validation_failed', message: "Ko'rsatilgan bog'liq yozuv topilmadi", details };
    case '23502':
      return { status: 422, code: 'validation_failed', message: `Majburiy maydon bo'sh: ${pg.column ?? "noma'lum"}`, details };
    case '23514':
      return { status: 422, code: 'validation_failed', message: "Qiymat ruxsat etilgan chegaradan tashqarida", details };
    case '22003':
      return { status: 422, code: 'validation_failed', message: 'Son juda katta', details };
    case '22P02':
      return { status: 400, code: 'validation_failed', message: "Qiymat formati noto'g'ri", details };
    case '22001':
      return { status: 422, code: 'validation_failed', message: 'Matn juda uzun', details };
    case '40P01':
    case '40001':
      return { status: 409, code: 'version_conflict', message: "Bir vaqtda boshqa amal bajarilmoqda, qayta urinib ko'ring", details };
    case '57014':
      return { status: 503, code: 'internal', message: "So'rov juda uzoq bajarildi va to'xtatildi", details };
    case '08006':
    case '08001':
    case '57P01':
      return { status: 503, code: 'internal', message: "Ma'lumotlar bazasi bilan aloqa yo'q, birozdan keyin urinib ko'ring", details };
    default:
      return null;
  }
}
