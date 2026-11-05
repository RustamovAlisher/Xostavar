import type { ExchangeRateRow } from '../repositories/currency.repository.js';

export interface RateView {
  currency: string;
  rate: number;
  rateDate: string;
  source: 'cbu' | 'manual';
  createdAt: Date;
  createdByName?: string;
}

/** GET /currency/usd javobi: joriy kurs + avtomatik yangilanish holati. */
export interface CurrentRateView {
  current: RateView | null;
  /** Keyingi avtomatik tortish vaqti (ISO, Toshkent 07:00 yoki 12:00). */
  nextAutoAt: string;
  /** Avtomatik tortish jadvali (Toshkent vaqti). */
  schedule: string[];
  /** Markaziy bankka oxirgi murojaat va natijasi. */
  lastCheckAt?: string;
  lastError?: string;
  /** So'm narxi shu qiymatgacha yaxlitlanadi. */
  roundTo: number;
}

export const toRateView = (r: ExchangeRateRow): RateView => ({
  currency: r.currency, rate: Number(r.rate), rateDate: r.rateDate, source: r.source, createdAt: r.createdAt,
  ...(r.createdByName ? { createdByName: r.createdByName } : {}),
});
