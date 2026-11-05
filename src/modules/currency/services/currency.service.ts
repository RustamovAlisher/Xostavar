import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB, type Db, type DbOrTx } from '../../../db/db.module.js';
import { runTx } from '../../../db/tx.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { unprocessable } from '../../../common/errors/app-error.js';
import { AuditService } from '../../audit/services/audit.service.js';
import { toRateView, type CurrentRateView, type RateView } from '../mappers/currency.mapper.js';
import { CurrencyRepository } from '../repositories/currency.repository.js';
import { CbuClient } from './cbu.client.js';

/** Avtomatik tortish vaqtlari, Toshkent (UTC+5, yozgi vaqt yo'q). */
export const AUTO_FETCH_TIMES = ['07:00', '12:00'] as const;
const TZ_OFFSET_MS = 5 * 3600_000;
/** Dollar narxdan hisoblangan so'm narxi shu qiymatgacha yaxlitlanadi. */
export const USD_ROUND_TO = 100;

/** Berilgan vaqtdan keyingi eng yaqin avtomatik tortish momenti. */
export function nextAutoFetch(now = new Date()): Date {
  const local = new Date(now.getTime() + TZ_OFFSET_MS); // "Toshkent soati" UTC maydonlarida
  for (let day = 0; day < 2; day++) {
    for (const t of AUTO_FETCH_TIMES) {
      const [h, m] = t.split(':').map(Number);
      const at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day, h, m) - TZ_OFFSET_MS;
      if (at > now.getTime()) return new Date(at);
    }
  }
  throw new Error('unreachable');
}

/** Berilgan vaqtgacha bo'lgan eng so'nggi avtomatik tortish momenti (o'tkazib yuborilganini aniqlash uchun). */
export function lastAutoFetch(now = new Date()): Date {
  const local = new Date(now.getTime() + TZ_OFFSET_MS);
  let best = 0;
  for (let day = -1; day <= 0; day++) {
    for (const t of AUTO_FETCH_TIMES) {
      const [h, m] = t.split(':').map(Number);
      const at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day, h, m) - TZ_OFFSET_MS;
      if (at <= now.getTime() && at > best) best = at;
    }
  }
  return new Date(best);
}

/** So'm qiymati: dollar × kurs, `USD_ROUND_TO` so'mgacha yaxlitlab. */
export const usdToUzs = (usd: number, rate: number) => Math.round((usd * rate) / USD_ROUND_TO) * USD_ROUND_TO;

/**
 * Dollar kursi: joriy qiymat, tarix, Markaziy bankdan tortish va qo'lda kiritish.
 * Yangi kurs yozilganda dollar narxli mahsulotlarning so'm narxi shu tranzaksiyada qayta hisoblanadi.
 */
@Injectable()
export class CurrencyService {
  private readonly logger = new Logger('Currency');
  private lastCheckAt?: Date;
  private lastError?: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: CurrencyRepository,
    private readonly cbu: CbuClient,
    private readonly audit: AuditService,
  ) {}

  /** Joriy USD kursi (so'm); hali hech qachon kiritilmagan bo'lsa null. */
  async currentRate(tx?: DbOrTx): Promise<number | null> {
    const r = await this.repo.latest('USD', tx);
    return r ? Number(r.rate) : null;
  }

  /** Kurs majburiy bo'lgan joylar uchun (dollar narxli mahsulot, dollar to'lov). */
  async requireRate(tx?: DbOrTx): Promise<number> {
    const r = await this.currentRate(tx);
    if (!r) throw unprocessable('validation_failed', "Dollar kursi hali kiritilmagan — Sozlamalar yoki yuqori paneldagi $ tugmasidan kursni yangilang");
    return r;
  }

  async current(): Promise<CurrentRateView> {
    const r = await this.repo.latest('USD');
    return {
      current: r ? toRateView(r) : null,
      nextAutoAt: nextAutoFetch().toISOString(),
      schedule: [...AUTO_FETCH_TIMES],
      ...(this.lastCheckAt ? { lastCheckAt: this.lastCheckAt.toISOString() } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      roundTo: USD_ROUND_TO,
    };
  }

  async history(limit = 14): Promise<RateView[]> {
    return (await this.repo.history(limit)).map(toRateView);
  }

  /** Yangi kursni yozadi va dollar narxli mahsulotlarni qayta hisoblaydi. */
  private async apply(tx: DbOrTx, rate: number, rateDate: string, source: 'cbu' | 'manual', user: AuthUser | null) {
    const prev = await this.repo.latest('USD', tx);
    const row = await this.repo.insert(tx, { currency: 'USD', rate, rateDate, source, createdBy: user?.id ?? null, createdByName: user?.name ?? null });
    const updated = await this.repo.recalcUsdPrices(tx, rate, USD_ROUND_TO);
    if (user) {
      await this.audit.log(user, {
        action: 'edit', module: 'Sozlamalar', targetId: row.id, targetName: 'Dollar kursi',
        details: `${source === 'cbu' ? 'Markaziy bankdan yangilandi' : "Qo'lda kiritildi"}: 1 $ = ${rate.toLocaleString('ru-RU')} so'm${prev ? ` (avval ${Number(prev.rate).toLocaleString('ru-RU')})` : ''}; ${updated} ta mahsulot narxi qayta hisoblandi`,
      }, tx);
    }
    return { row, updated };
  }

  /**
   * Markaziy bankdan tortadi. Kurs va sana oxirgi Markaziy bank yozuvi bilan bir xil bo'lsa yangi qator yozilmaydi
   * (lekin oxirgi yozuv qo'lda kiritilgan bo'lsa — Markaziy bank kursi uni almashtiradi).
   */
  async refreshFromCbu(user: AuthUser | null = null): Promise<{ changed: boolean; updatedProducts: number; current: RateView }> {
    this.lastCheckAt = new Date();
    let fetched;
    try {
      fetched = await this.cbu.fetchRate('USD');
      this.lastError = undefined;
    } catch (e) {
      this.lastError = (e as Error).message || 'Markaziy bankka ulanib bo\'lmadi';
      this.logger.warn(`Markaziy bank kursini olib bo'lmadi: ${this.lastError}`);
      throw unprocessable('validation_failed', `Markaziy bank kursini olib bo'lmadi: ${this.lastError}`);
    }
    return runTx(this.db, async (tx) => {
      const latest = await this.repo.latest('USD', tx);
      if (latest && latest.source === 'cbu' && Number(latest.rate) === fetched.rate && latest.rateDate === fetched.date) {
        return { changed: false, updatedProducts: 0, current: toRateView(latest) };
      }
      const { row, updated } = await this.apply(tx, fetched.rate, fetched.date, 'cbu', user);
      this.logger.log(`USD kursi: ${fetched.rate} (${fetched.date}), ${updated} ta mahsulot qayta hisoblandi`);
      return { changed: true, updatedProducts: updated, current: toRateView(row) };
    });
  }

  async setManual(user: AuthUser, rate: number): Promise<{ updatedProducts: number; current: RateView }> {
    const today = new Date(Date.now() + TZ_OFFSET_MS).toISOString().slice(0, 10);
    return runTx(this.db, async (tx) => {
      const { row, updated } = await this.apply(tx, Math.round(rate * 100) / 100, today, 'manual', user);
      return { updatedProducts: updated, current: toRateView(row) };
    });
  }

  /** Jadval uchun: oxirgi avtomatik moment o'tkazib yuborilganmi (server o'chiq bo'lgan bo'lsa). */
  async isStale(now = new Date()): Promise<boolean> {
    const last = await this.repo.latestFromCbu('USD');
    return !last || last.createdAt.getTime() < lastAutoFetch(now).getTime();
  }
}
