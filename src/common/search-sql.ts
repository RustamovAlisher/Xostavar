import { and, or, type SQL } from 'drizzle-orm';
import { parseQuery, tokenRegex } from './search.js';

/**
 * SQL matn qidiruvi (search.ts bilan bir xil qoidalar, xato-tuzatishsiz — tarix jadvallari katta):
 * har so'z (yoki lug'atdagi ibora) AND, uning muqobillari (sinonimlar) OR. Har so'z imlo variantlari bilan regex
 * (kirill/lotin, apostrof, qo'sh harf, 5+ harfda o/a, e/i).
 * `match(regexes)` — bitta muqobilning hamma so'zi bitta yozuvda borligi sharti (masalan nom yoki raqam ustunida).
 * Qaytaradi: undefined — so'rov bo'sh; null — so'z yo'q (faqat belgilar), chaqiruvchi oddiy ILIKE ishlatadi.
 */
export function textQuery(raw: string | undefined, match: (regexes: string[]) => SQL | undefined): SQL | undefined | null {
  const term = raw?.trim();
  if (!term) return undefined;
  const q = parseQuery(term);
  if (!q.units.length) return null;
  return and(...q.units.map((alts) => or(...alts.map((alt) => match(alt.map(tokenRegex))))));
}
