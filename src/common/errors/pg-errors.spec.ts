import { describe, expect, it } from 'vitest';
import { isRetryable, pgErrorOf, translatePgError } from './pg-errors.js';
import { flattenValidation } from '../pipes/validation.pipe.js';

const wrapped = (code: string, extra: Record<string, unknown> = {}) => Object.assign(new Error('Failed query'), { cause: { code, ...extra } });

describe('Postgres xatolari tarjimasi', () => {
  it('pgErrorOf: to\'g\'ridan-to\'g\'ri va Drizzle o\'ramidagi (cause) xatoni topadi; boshqa xatoda null', () => {
    expect(pgErrorOf({ code: '23505' })?.code).toBe('23505');
    expect(pgErrorOf(wrapped('23503'))?.code).toBe('23503');
    expect(pgErrorOf(new Error('x'))).toBeNull();
    expect(pgErrorOf({ code: 'ENOTFOUND' })).toBeNull();
    expect(pgErrorOf(null)).toBeNull();
  });
  it('unikal indeks → 409 duplicate_code, indeks nomiga qarab xabar', () => {
    expect(translatePgError(wrapped('23505', { constraint: 'customers_phone_uq' }))).toMatchObject({ status: 409, code: 'duplicate_code', message: 'Bu telefon raqami allaqachon mavjud' });
    expect(translatePgError(wrapped('23505', { constraint: 'products_sku_lower_uq' }))?.message).toMatch(/SKU/);
    expect(translatePgError(wrapped('23505', { constraint: 'nomalum_idx' }))?.message).toBe('Bunday yozuv allaqachon mavjud');
  });
  it('FK: o\'chirishda bog\'liq yozuv → 409 in_use; kiritishda yo\'q yozuv → 422', () => {
    expect(translatePgError(wrapped('23503', { detail: 'Key (id)=(x) is still referenced from table "sales".' }))).toMatchObject({ status: 409, code: 'in_use' });
    expect(translatePgError(wrapped('23503', { detail: 'Key (role_id)=(x) is not present in table "roles".' }))).toMatchObject({ status: 422, code: 'validation_failed' });
  });
  it('not null, check, overflow, format, uzunlik, deadlock, aloqa', () => {
    expect(translatePgError(wrapped('23502', { column: 'name' }))).toMatchObject({ status: 422, message: "Majburiy maydon bo'sh: name" });
    expect(translatePgError(wrapped('23514'))?.status).toBe(422);
    expect(translatePgError(wrapped('22003'))?.message).toBe('Son juda katta');
    expect(translatePgError(wrapped('22P02'))?.status).toBe(400);
    expect(translatePgError(wrapped('22001'))?.message).toBe('Matn juda uzun');
    expect(translatePgError(wrapped('40P01'))).toMatchObject({ status: 409, code: 'version_conflict' });
    expect(translatePgError(wrapped('08006'))?.status).toBe(503);
    expect(translatePgError(wrapped('57014'))?.status).toBe(503);
    expect(translatePgError(wrapped('99999'))).toBeNull();
  });
  it('isRetryable: faqat deadlock va serialization', () => {
    expect(isRetryable(wrapped('40P01'))).toBe(true);
    expect(isRetryable({ code: '40001' })).toBe(true);
    expect(isRetryable(wrapped('23505'))).toBe(false);
    expect(isRetryable(new Error('x'))).toBe(false);
  });
});

describe('validatsiya xabarlari', () => {
  it('cheklovlar o\'zbekcha, ichma-ich maydonlar nuqta bilan, dekorator xabari saqlanadi', () => {
    const out = flattenValidation([
      { property: 'qty', constraints: { min: 'qty must not be less than 0', isNumber: 'qty must be a number conforming to the specified constraints' }, children: [] },
      { property: 'username', constraints: { matches: 'Login kamida 3 ta lotin harf/raqam' }, children: [] },
      { property: 'kind', constraints: { isIn: 'kind must be one of the following values: cash, card' }, children: [] },
      { property: 'lines', constraints: {}, children: [{ property: '0', constraints: {}, children: [{ property: 'unit', constraints: { matches: 'unit must match /x/ regular expression' }, children: [] }] }] },
    ] as never);
    expect(out).toEqual([
      { field: 'qty', message: 'qty: kamida 0 bo\'lsin' },
      { field: 'qty', message: 'qty: son bo\'lishi kerak' },
      { field: 'username', message: 'Login kamida 3 ta lotin harf/raqam' },
      { field: 'kind', message: 'kind: faqat cash, card bo\'lishi mumkin' },
      { field: 'lines.0.unit', message: 'lines.0.unit: format noto\'g\'ri' },
    ]);
  });
});
