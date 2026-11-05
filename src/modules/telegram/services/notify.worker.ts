import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { DB, type Db } from '../../../db/db.module.js';
import { dailyReportMessage, debtPaymentMessage, esc, saleMessage, voidMessage } from '../mappers/telegram.format.js';
import { dailyDue, MAX_ATTEMPTS, nextDailyAt, RETRY_DELAYS_S, tashkentDay, wants, type EventCtx } from '../mappers/telegram.rules.js';
import { TelegramRepository, type OutboxRow, type TelegramChatRow } from '../repositories/telegram.repository.js';
import { NotifyService } from './notify.service.js';
import { SalesReportService } from './sales-report.service.js';
import { MENU_INLINE } from './telegram-bot.service.js';
import { TelegramClient, TelegramError } from './telegram.client.js';

const TICK_MS = 3_000;
/** Bitta chatga ketma-ket xabarlar orasida (Telegram: ~1 xabar/s har chatga). */
const SEND_GAP_MS = 400;

/**
 * Navbat ishchisi: har 3 s da kutayotgan hodisalarni oladi, mos chatlarga yuboradi, xatoda kechiktirib qayta urinadi.
 * Kun yakuni hisobotini `SALES_BOT_DAILY_AT` (standart 21:00, Toshkent) da navbatga qo'yadi.
 * Bitta backend nusxasi uchun (ichki `busy` bayrog'i yetarli).
 */
@Injectable()
export class NotifyWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('TelegramNotify');
  private tick?: NodeJS.Timeout;
  private dailyTimer?: NodeJS.Timeout;
  private busy = false;
  private stopped = false;
  /** 429 bo'lsa — butun navbat shu paytgacha to'xtaydi. */
  private pausedUntil = 0;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: TelegramRepository,
    private readonly notify: NotifyService,
    private readonly report: SalesReportService,
    private readonly tg: TelegramClient,
  ) {}

  onApplicationBootstrap() {
    if (!this.notify.enabled || process.env.NODE_ENV === 'test') return;
    this.tick = setInterval(() => void this.processOnce(), TICK_MS);
    void this.catchUpDaily();
    this.scheduleDaily();
    void this.repo.purgeOutbox().catch(() => undefined);
  }

  onApplicationShutdown() {
    this.stopped = true;
    if (this.tick) clearInterval(this.tick);
    if (this.dailyTimer) clearTimeout(this.dailyTimer);
  }

  /** Server hisobot vaqtida o'chiq bo'lgan bo'lsa — yonganda bugungi hisobot (bir marta) yuboriladi. */
  private async catchUpDaily() {
    try {
      if (dailyDue(this.notify.dailyAt)) await this.notify.enqueueDaily(this.db, tashkentDay());
    } catch (e) {
      this.logger.warn(`Kun yakunini navbatga qo'yib bo'lmadi: ${(e as Error).message}`);
    }
  }

  private scheduleDaily() {
    if (this.stopped) return;
    const at = nextDailyAt(this.notify.dailyAt);
    this.dailyTimer = setTimeout(async () => {
      try {
        await this.notify.enqueueDaily(this.db, tashkentDay());
      } catch (e) {
        this.logger.warn(`Kun yakunini navbatga qo'yib bo'lmadi: ${(e as Error).message}`);
      }
      this.scheduleDaily();
    }, Math.max(1_000, at.getTime() - Date.now()));
  }

  /** Bir aylanish: test va e2e dan to'g'ridan-to'g'ri ham chaqiriladi. Yuborilgan hodisalar soni. */
  async processOnce(): Promise<number> {
    if (this.busy || Date.now() < this.pausedUntil) return 0;
    this.busy = true;
    let done = 0;
    try {
      const rows = await this.repo.pending();
      if (!rows.length) return 0;
      const chats = await this.repo.chats(true);
      for (const row of rows) {
        if (this.stopped || Date.now() < this.pausedUntil) break;
        if (await this.deliver(row, chats)) done++;
      }
    } catch (e) {
      this.logger.warn(`Navbatni qayta ishlashda xato: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
    return done;
  }

  /** Bitta hodisa → mos chatlar. Hammasiga yetib borsa true. */
  private async deliver(row: OutboxRow, chats: TelegramChatRow[]): Promise<boolean> {
    let ctx: EventCtx = { branchId: row.branchId };
    let render: (chat: TelegramChatRow) => Promise<{ html: string; menu?: boolean } | null>;

    if (row.kind === 'sale' || row.kind === 'void' || row.kind === 'debt_payment') {
      const data = row.refId ? await this.report.saleData(row.refId) : null;
      if (!data) {
        await this.repo.updateOutbox(row.id, { status: 'failed', lastError: 'Chek topilmadi' });
        return false;
      }
      ctx = { branchId: data.s.branchId, total: data.s.totalAmount, remainingDebt: data.s.remainingDebt };
      const html = row.kind === 'sale' ? saleMessage(data.sale) : row.kind === 'void' && data.voided ? voidMessage(data.voided) : debtPaymentMessage(data.debt);
      render = async () => ({ html });
    } else if (row.kind === 'daily') {
      const day = typeof row.payload?.day === 'string' ? row.payload.day : tashkentDay();
      const cache = new Map<string, ReturnType<SalesReportService['dayReport']>>();
      render = async (chat) => {
        const key = chat.branchIds?.length ? [...chat.branchIds].sort().join(',') : 'all';
        if (!cache.has(key)) cache.set(key, this.report.dayReport(day, chat.branchIds?.length ? chat.branchIds : null));
        const r = await cache.get(key)!;
        return { html: dailyReportMessage(r, { showProfit: chat.showProfit, asOf: day === tashkentDay() ? new Date() : undefined }), menu: true };
      };
    } else {
      // test
      const by = typeof row.payload?.by === 'string' ? row.payload.by : '';
      render = async () => ({ html: `✅ <b>Sinov xabari</b>\nOmbor Control boti shu chatga ulangan va ishlayapti.${by ? `\nYubordi: ${esc(by)}` : ''}`, menu: true });
    }

    const targets = chats.filter((c) => (row.kind === 'test' ? c.chatId === row.payload?.chatId : wants(c, row.kind, ctx)) && !row.sentChatIds.includes(c.chatId));
    const sent = [...row.sentChatIds];
    let error: string | undefined;
    for (const chat of targets) {
      try {
        const msg = await render(chat);
        if (!msg) continue;
        await this.tg.sendMessage(chat.chatId, msg.html, msg.menu ? MENU_INLINE : undefined);
        sent.push(chat.chatId);
        await new Promise((r) => setTimeout(r, process.env.NODE_ENV === 'test' ? 0 : SEND_GAP_MS));
      } catch (e) {
        if (e instanceof TelegramError && e.permanent) {
          // Bot guruhdan chiqarilgan / chat o'chgan — chatni o'chiramiz, qolganlariga davom
          this.logger.warn(`Chat ${chat.title} (${chat.chatId}) o'chirildi: ${e.message}`);
          await this.repo.deactivateByChatId(chat.chatId);
          sent.push(chat.chatId);
          continue;
        }
        if (e instanceof TelegramError && e.code === 429) this.pausedUntil = Date.now() + (e.retryAfter ?? 5) * 1000;
        error = (e as Error).message;
        break;
      }
    }

    if (!error) {
      await this.repo.updateOutbox(row.id, { status: 'sent', sentAt: new Date(), sentChatIds: sent, lastError: null });
      return true;
    }
    const attempts = row.attempts + 1;
    const delay = RETRY_DELAYS_S[Math.min(attempts - 1, RETRY_DELAYS_S.length - 1)];
    await this.repo.updateOutbox(row.id, {
      attempts, sentChatIds: sent, lastError: error.slice(0, 500),
      status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
      nextAttemptAt: new Date(Math.max(Date.now() + delay * 1000, this.pausedUntil)),
    });
    this.logger.warn(`Telegram xabari yuborilmadi (${row.kind}, urinish ${attempts}/${MAX_ATTEMPTS}): ${error}`);
    return false;
  }
}
