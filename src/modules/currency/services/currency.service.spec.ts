import { describe, expect, it } from 'vitest';
import { lastAutoFetch, nextAutoFetch, usdToUzs } from './currency.service.js';

/** Toshkent vaqti (UTC+5) bo'yicha Date: `tk('2026-11-05 06:59')`. */
const tk = (s: string) => new Date(`${s.replace(' ', 'T')}:00+05:00`);

describe('nextAutoFetch (07:00 va 12:00 Toshkent)', () => {
  it('ertalab 07:00 gacha — bugun 07:00', () => expect(nextAutoFetch(tk('2026-11-05 06:59'))).toEqual(tk('2026-11-05 07:00')));
  it('07:00 da — 12:00 (moment o\'tgan deb hisoblanadi)', () => expect(nextAutoFetch(tk('2026-11-05 07:00'))).toEqual(tk('2026-11-05 12:00')));
  it('tushdan keyin — ertaga 07:00', () => expect(nextAutoFetch(tk('2026-11-05 15:30'))).toEqual(tk('2026-11-06 07:00')));
  it('yarim tundan oldin (UTC sanasi boshqa) — ertaga 07:00', () => expect(nextAutoFetch(tk('2026-11-05 23:50'))).toEqual(tk('2026-11-06 07:00')));
  it('oy oxiri', () => expect(nextAutoFetch(tk('2026-11-30 13:00'))).toEqual(tk('2026-12-01 07:00')));
});

describe('lastAutoFetch', () => {
  it('07:00 dan oldin — kecha 12:00', () => expect(lastAutoFetch(tk('2026-11-05 06:00'))).toEqual(tk('2026-11-04 12:00')));
  it('09:00 — bugun 07:00', () => expect(lastAutoFetch(tk('2026-11-05 09:00'))).toEqual(tk('2026-11-05 07:00')));
  it('18:00 — bugun 12:00', () => expect(lastAutoFetch(tk('2026-11-05 18:00'))).toEqual(tk('2026-11-05 12:00')));
});

describe('usdToUzs', () => {
  it("100 so'mgacha yaxlitlaydi", () => {
    expect(usdToUzs(10, 11935.37)).toBe(119_400);
    expect(usdToUzs(1.5, 12000)).toBe(18_000);
    expect(usdToUzs(0, 12000)).toBe(0);
  });
});
