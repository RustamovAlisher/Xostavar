import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CurrencyService, nextAutoFetch } from './currency.service.js';

const RETRY_MS = 10 * 60_000;
const MAX_RETRIES = 6;

/**
 * Har kuni 07:00 va 12:00 (Toshkent) da Markaziy bankdan USD kursini tortadi.
 * Server o'chiq bo'lib moment o'tib ketgan bo'lsa — ishga tushganda darhol tortadi. Xatoda 10 daqiqadan keyin qayta urinadi.
 * Qo'shimcha kutubxonasiz: bitta setTimeout zanjiri (bitta backend nusxasi uchun yetarli).
 */
@Injectable()
export class CurrencyScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('CurrencyScheduler');
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(private readonly currency: CurrencyService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    // Ishga tushganda: o'tkazib yuborilgan moment bo'lsa 5 s dan keyin tortamiz
    this.timer = setTimeout(() => void this.catchUp(), 5_000);
  }

  onApplicationShutdown() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async catchUp() {
    try {
      if (await this.currency.isStale()) return this.run(0);
    } catch (e) {
      this.logger.warn(`Kurs holatini tekshirib bo'lmadi: ${(e as Error).message}`);
    }
    this.scheduleNext();
  }

  private scheduleNext() {
    if (this.stopped) return;
    const at = nextAutoFetch();
    const ms = Math.min(at.getTime() - Date.now(), 2_147_000_000);
    this.logger.log(`Keyingi kurs yangilanishi: ${at.toISOString()}`);
    this.timer = setTimeout(() => void this.run(0), Math.max(1_000, ms));
  }

  private async run(attempt: number) {
    if (this.stopped) return;
    try {
      await this.currency.refreshFromCbu(null);
      this.scheduleNext();
    } catch {
      if (attempt + 1 < MAX_RETRIES) {
        this.timer = setTimeout(() => void this.run(attempt + 1), RETRY_MS);
      } else {
        this.scheduleNext();
      }
    }
  }
}
