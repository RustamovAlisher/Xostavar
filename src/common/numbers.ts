/** Hisob yordamchilari — frontend `lib/units.ts` bilan bir xil natija berishi shart (TZ 16 golden test). */

export function roundTo(n: number, precision: number): number {
  const m = 10 ** precision;
  return Math.round((n + Number.EPSILON) * m) / m;
}

/** Pul: butun so'm. */
export const money = (n: number) => Math.round(n);

/** Miqdor saqlash aniqligi (TZ 5): 4 xona. */
export const qty4 = (n: number) => roundTo(n, 4);

export const todayISO = (tz = 'Asia/Tashkent'): string => dayKey(new Date(), tz);

/** Sana kaliti YYYY-MM-DD do'kon vaqt zonasida (TZ 8.10). */
export function dayKey(d: Date, tz = 'Asia/Tashkent'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Telefon: faqat raqamlar, 12 ta, 998 bilan (9 ta kiritilsa 998 qo'shiladi). Yaroqsiz bo'lsa null. */
export function canonicalPhone(s: string): string | null {
  let d = s.replace(/\D/g, '');
  if (d.length === 9) d = '998' + d;
  return d.length === 12 && d.startsWith('998') ? d : null;
}

/** "Chilonzor filiali" → "CHILONZOR" (filial kodi). */
export function codeFromName(name: string, taken: string[] = []): string {
  const words = name
    .toUpperCase()
    .replace(/[ʻʼ'`‘’]/g, '')
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  // "Chilonzor filiali" → CHILONZOR (birinchi ma'noli so'z), juda qisqa bo'lsa hammasi qo'shib yoziladi
  const first = words[0] ?? '';
  const base = (first.length >= 3 ? first : words.join('')).slice(0, 10) || 'BR';
  let code = base;
  let n = 2;
  while (taken.includes(code)) code = `${base}${n++}`;
  return code;
}

/** SKU uchun slug: "Armatura po'lat" → "ARMATURA-POLAT". */
export function slug(s: string): string {
  return s
    .toUpperCase()
    .replace(/[ʻʼ'`‘’]/g, '')
    .replace(/[^A-Z0-9.]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}
