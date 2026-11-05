import { Injectable } from '@nestjs/common';

export interface CbuRate {
  rate: number;
  /** YYYY-MM-DD */
  date: string;
}

const CBU_URL = (ccy: string) => `https://cbu.uz/uz/arkhiv-kursov-valyut/json/${ccy}/`;

/**
 * O'zbekiston Markaziy banki ochiq API si: `[{ Ccy, Rate: "11935.37", Date: "05.11.2026", Nominal: "1" }]`.
 * cbu.uz chet el IP laridan yopiq (server xorijda bo'lsa ulanmaydi) — u holda kursni O'zbekistondagi brauzer
 * tortib `POST /currency/usd/cbu-report` ga yuboradi; javobda CORS `*` bor.
 */
@Injectable()
export class CbuClient {
  async fetchRate(ccy = 'USD'): Promise<CbuRate> {
    const res = await fetch(CBU_URL(ccy), { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Markaziy bank javobi: HTTP ${res.status}`);
    return parseCbu(await res.json(), ccy);
  }
}

export function parseCbu(body: unknown, ccy = 'USD'): CbuRate {
  const rows = body as { Ccy?: string; Rate?: string; Date?: string; Nominal?: string }[];
  const row = Array.isArray(rows) ? rows.find((x) => x.Ccy === ccy) : undefined;
  const rate = Number(row?.Rate) / (Number(row?.Nominal) || 1);
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(row?.Date ?? '');
  if (!row || !Number.isFinite(rate) || rate <= 0 || !m) throw new Error("Markaziy bank javobi tushunarsiz");
  return { rate: Math.round(rate * 100) / 100, date: `${m[3]}-${m[2]}-${m[1]}` };
}

/**
 * Xalqaro bozor kursi (open.er-api.com, kalitsiz) — faqat tekshiruv uchun: brauzer yuborgan "Markaziy bank kursi"
 * haqiqatga yaqinligini solishtiramiz. Kursni o'zi sifatida yozilmaydi.
 */
@Injectable()
export class MarketRateClient {
  async fetchUsdUzs(): Promise<number | null> {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const rate = Number(((await res.json()) as { rates?: Record<string, number> }).rates?.UZS);
      return Number.isFinite(rate) && rate > 0 ? rate : null;
    } catch {
      return null;
    }
  }
}
