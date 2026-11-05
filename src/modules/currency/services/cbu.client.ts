import { Injectable } from '@nestjs/common';

export interface CbuRate {
  rate: number;
  /** YYYY-MM-DD */
  date: string;
}

const CBU_URL = (ccy: string) => `https://cbu.uz/uz/arkhiv-kursov-valyut/json/${ccy}/`;

/** O'zbekiston Markaziy banki ochiq API si: `[{ Ccy, Rate: "11935.37", Date: "05.11.2026", Nominal: "1" }]`. */
@Injectable()
export class CbuClient {
  async fetchRate(ccy = 'USD'): Promise<CbuRate> {
    const res = await fetch(CBU_URL(ccy), { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Markaziy bank javobi: HTTP ${res.status}`);
    const body = (await res.json()) as { Ccy?: string; Rate?: string; Date?: string; Nominal?: string }[];
    const row = Array.isArray(body) ? body.find((x) => x.Ccy === ccy) : undefined;
    const rate = Number(row?.Rate) / (Number(row?.Nominal) || 1);
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(row?.Date ?? '');
    if (!row || !Number.isFinite(rate) || rate <= 0 || !m) throw new Error("Markaziy bank javobi tushunarsiz");
    return { rate: Math.round(rate * 100) / 100, date: `${m[3]}-${m[2]}-${m[1]}` };
  }
}
