import { describe, expect, it } from 'vitest';
import { addDays, canonicalPhone, codeFromName, dayKey, roundTo, slug } from './numbers.js';

describe('numbers', () => {
  it('roundTo: 0.1+0.2 kabi xatolarsiz', () => {
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(12649.5726, 2)).toBe(12649.57);
  });
  it('canonicalPhone: 9 raqamga 998 qo\'shiladi, formatlangan qabul qilinadi, yaroqsiz → null', () => {
    expect(canonicalPhone('91 234 56 78')).toBe('998912345678');
    expect(canonicalPhone('+998 91 234-56-78')).toBe('998912345678');
    expect(canonicalPhone('998912345678')).toBe('998912345678');
    expect(canonicalPhone('12345')).toBeNull();
    expect(canonicalPhone('+7 912 345 67 89')).toBeNull();
    expect(canonicalPhone('')).toBeNull();
  });
  it('codeFromName: birinchi so\'z, 10 belgi, takrorga raqam', () => {
    expect(codeFromName('Chilonzor filiali')).toBe('CHILONZOR');
    expect(codeFromName("Yunusobod ko'chasi 12")).toBe('YUNUSOBOD');
    expect(codeFromName('Asosiy filial', ['ASOSIY'])).toBe('ASOSIY2');
    expect(codeFromName('12 a')).toBe('12A');
    expect(codeFromName('')).toBe('BR');
    expect(codeFromName('Juda uzun nomli filial nomi').length).toBeLessThanOrEqual(10);
  });
  it('slug: SKU uchun', () => {
    expect(slug("Armatura po'lat (A500C)")).toBe('ARMATURA-POLAT-A500C');
    expect(slug('Ø 12 mm A500C')).toBe('12-MM-A500C');
    expect(slug('Truba 40×20×2')).toBe('TRUBA-40-20-2');
  });
  it('dayKey Toshkent vaqtida (UTC+5): 23:30 UTC → ertangi kun', () => {
    expect(dayKey(new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-25');
    expect(dayKey(new Date('2026-10-24T18:59:00Z'))).toBe('2026-10-24');
  });
  it('addDays oy va yil chegarasidan o\'tadi', () => {
    expect(addDays('2026-10-24', 30)).toBe('2026-11-23');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
