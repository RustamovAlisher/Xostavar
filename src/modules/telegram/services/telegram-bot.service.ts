import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AuditService } from '../../audit/services/audit.service.js';
import { dailyReportMessage, esc, receiptsListMessages } from '../mappers/telegram.format.js';
import { tashkentDay } from '../mappers/telegram.rules.js';
import { TelegramRepository, type TelegramChatRow } from '../repositories/telegram.repository.js';
import { NotifyService } from './notify.service.js';
import { SalesReportService } from './sales-report.service.js';
import { TelegramClient, TelegramError, type ReplyMarkup, type TgChat, type TgUpdate } from './telegram.client.js';

/** Hisobot xabarlari ostidagi tugmalar (guruhda ham ishlaydi — callback privacy rejimida ham keladi). */
export const MENU_INLINE: ReplyMarkup = {
  inline_keyboard: [
    [{ text: '📊 Bugungi savdo', callback_data: 'r:t' }, { text: '📅 Kecha', callback_data: 'r:y' }],
    [{ text: "🧾 Cheklar ro'yxati", callback_data: 'l:t' }, { text: '📥 Excel (bugun)', callback_data: 'x:t' }],
    [{ text: "🧾 Kechagi cheklar", callback_data: 'l:y' }, { text: '📥 Excel (kecha)', callback_data: 'x:y' }],
  ],
};

/** Shaxsiy chatda pastki doimiy klaviatura. */
const MENU_REPLY: ReplyMarkup = {
  keyboard: [[{ text: '📊 Bugungi savdo' }, { text: '📅 Kecha' }], [{ text: "🧾 Cheklar ro'yxati" }, { text: '📥 Excel' }]],
  resize_keyboard: true,
  is_persistent: true,
};

type Action = 'report' | 'list' | 'excel';
type Day = 't' | 'y';

/** Buyruq / tugma matni → amal. */
const TEXT_ACTIONS: Record<string, [Action, Day] | 'menu' | 'help'> = {
  '/bugun': ['report', 't'], '/kecha': ['report', 'y'], '/cheklar': ['list', 't'], '/excel': ['excel', 't'],
  '/menu': 'menu', '/help': 'help', '/yordam': 'help',
  '📊 bugungi savdo': ['report', 't'], '📅 kecha': ['report', 'y'], "🧾 cheklar ro'yxati": ['list', 't'], '📥 excel': ['excel', 't'],
};

const HELP = [
  '<b>Ombor Control — savdo boti</b>',
  '',
  'Har bir sotuv, bekor qilingan chek va nasiya haqida xabar keladi; har kuni kechqurun kun yakuni yuboriladi.',
  '',
  '/bugun — bugungi savdo',
  '/kecha — kechagi savdo',
  "/cheklar — bugungi cheklar ro'yxati",
  '/excel — bugungi savdo Excel faylda',
  '/menu — tugmalar',
].join('\n');

const POLL_ERROR_WAIT_MS = 5_000;
const POLL_CONFLICT_WAIT_MS = 60_000;
/** Og'ir amal (Excel) bir chatda shuncha vaqtda bir marta. */
const HEAVY_COOLDOWN_MS = 10_000;

/**
 * Bot: `getUpdates` long polling (webhook va ochiq port kerak emas), chatni bir martalik kod bilan ulash,
 * hisobot tugmalari. Ulanmagan chatlarga savdo ma'lumoti hech qachon berilmaydi.
 */
@Injectable()
export class TelegramBotService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('TelegramBot');
  private stopped = false;
  private offset = 0;
  private heavyAt = new Map<string, number>();
  botUsername?: string;
  pollError?: string;

  constructor(
    private readonly tg: TelegramClient,
    private readonly repo: TelegramRepository,
    private readonly report: SalesReportService,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    if (!this.notify.enabled || process.env.NODE_ENV === 'test') return;
    void this.loop();
  }

  onApplicationShutdown() {
    this.stopped = true;
  }

  private async loop() {
    while (!this.stopped) {
      try {
        if (!this.botUsername) {
          this.botUsername = (await this.tg.getMe()).username;
          this.logger.log(`Savdo boti ishga tushdi: @${this.botUsername}`);
        }
        const updates = await this.tg.getUpdates(this.offset);
        this.pollError = undefined;
        for (const u of updates) {
          this.offset = u.update_id + 1;
          await this.handleUpdate(u).catch((e) => this.logger.warn(`Telegram yangilanishini qayta ishlab bo'lmadi: ${(e as Error).message}`));
        }
      } catch (e) {
        if (this.stopped) break;
        const code = e instanceof TelegramError ? e.code : 0;
        this.pollError = code === 409
          ? 'Bu bot boshqa serverda ham ishlayapti (409) — SALES_BOT_ENABLED faqat bitta muhitda yoqilsin'
          : code === 401 ? "Bot tokeni noto'g'ri (TELEGRAM_BOT_TOKEN)" : (e as Error).message;
        this.logger.warn(`Telegram polling: ${this.pollError}`);
        // Sozlama xatosi (409 / 401) tez o'zgarmaydi — kamroq urinamiz
        await new Promise((r) => setTimeout(r, code === 409 || code === 401 ? POLL_CONFLICT_WAIT_MS : POLL_ERROR_WAIT_MS));
      }
    }
  }

  /** Bitta Telegram yangilanishi (e2e testdan ham chaqiriladi). */
  async handleUpdate(u: TgUpdate) {
    if (u.my_chat_member) {
      const st = u.my_chat_member.new_chat_member.status;
      if (st === 'kicked' || st === 'left') await this.repo.deactivateByChatId(String(u.my_chat_member.chat.id));
      return;
    }
    if (u.callback_query) {
      const q = u.callback_query;
      const chat = q.message?.chat;
      await this.tg.answerCallback(q.id);
      if (!chat) return;
      const linked = await this.linked(chat);
      if (!linked) return;
      const [a, d] = (q.data ?? '').split(':');
      const action: Action | null = a === 'r' ? 'report' : a === 'l' ? 'list' : a === 'x' ? 'excel' : null;
      if (action && (d === 't' || d === 'y')) await this.run(linked, action, d);
      return;
    }
    const m = u.message;
    if (!m?.text) return;
    const text = m.text.trim();
    // "/start@ombor_control_bot ABC123" → "/start", "ABC123"
    const [rawCmd, ...args] = text.split(/\s+/);
    const cmd = rawCmd.replace(/@\w+$/, '').toLowerCase();

    if (cmd === '/start') return this.start(m.chat, args[0]);
    const known = TEXT_ACTIONS[cmd] ?? TEXT_ACTIONS[text.toLowerCase()];
    if (!known) return;
    const linked = await this.linked(m.chat);
    if (!linked) {
      if (cmd.startsWith('/')) await this.tg.sendMessage(m.chat.id, this.notLinkedText());
      return;
    }
    if (known === 'help') return void (await this.tg.sendMessage(m.chat.id, HELP, m.chat.type === 'private' ? MENU_REPLY : MENU_INLINE));
    if (known === 'menu') return void (await this.tg.sendMessage(m.chat.id, 'Kerakli hisobotni tanlang:', MENU_INLINE));
    await this.run(linked, known[0], known[1]);
  }

  private notLinkedText() {
    return "Bu chat hali ulanmagan.\nAdmin: Ombor Control → <b>Sozlamalar → Telegram bot</b> → «Chat ulash» tugmasini bosib, berilgan kod bilan <code>/start KOD</code> yuboring.";
  }

  private async linked(chat: TgChat): Promise<TelegramChatRow | null> {
    const row = await this.repo.chatByChatId(String(chat.id));
    return row?.active ? row : null;
  }

  private chatTitle(chat: TgChat) {
    return chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(' ') || (chat.username ? `@${chat.username}` : String(chat.id)));
  }

  /** `/start KOD` — chatni ulash; kodsiz `/start` — ulangan bo'lsa menyu, aks holda yo'riqnoma. */
  private async start(chat: TgChat, code?: string) {
    if (code) {
      const c = await this.repo.consumeLinkCode(code.trim().toUpperCase());
      if (!c) {
        await this.tg.sendMessage(chat.id, "❗️ Kod noto'g'ri yoki muddati o'tgan (15 daqiqa). Sozlamalardan yangi kod oling.");
        return;
      }
      const row = await this.repo.upsertChat({ chatId: String(chat.id), type: chat.type, title: this.chatTitle(chat), linkedBy: c.createdBy, linkedByName: c.createdByName });
      await this.audit.log(c.createdBy ? { id: c.createdBy, name: c.createdByName, roleName: '' } : null, {
        action: 'add', module: 'Sozlamalar', targetId: row.id, targetName: `Telegram: ${row.title}`, details: `Telegram chat ulandi (${row.type}, ${row.chatId})`,
      });
      await this.tg.sendMessage(chat.id, `✅ <b>${esc(row.title)}</b> ulandi.\n\n${HELP}`, chat.type === 'private' ? MENU_REPLY : MENU_INLINE);
      return;
    }
    const linked = await this.linked(chat);
    if (linked) await this.tg.sendMessage(chat.id, HELP, chat.type === 'private' ? MENU_REPLY : MENU_INLINE);
    else await this.tg.sendMessage(chat.id, this.notLinkedText());
  }

  private async run(chat: TelegramChatRow, action: Action, d: Day) {
    const day = d === 't' ? tashkentDay() : tashkentDay(new Date(Date.now() - 86_400_000));
    const scope = chat.branchIds?.length ? chat.branchIds : null;
    if (action === 'report') {
      const r = await this.report.dayReport(day, scope);
      await this.tg.sendMessage(chat.chatId, dailyReportMessage(r, { showProfit: chat.showProfit, title: d === 't' ? 'Bugungi savdo' : 'Kechagi savdo', asOf: d === 't' ? new Date() : undefined }), MENU_INLINE);
      return;
    }
    if (action === 'list') {
      const parts = receiptsListMessages(day, await this.report.scopeName(scope), await this.report.receipts(day, scope));
      for (let i = 0; i < parts.length; i++) await this.tg.sendMessage(chat.chatId, parts[i], i === parts.length - 1 ? MENU_INLINE : undefined);
      return;
    }
    // excel
    const last = this.heavyAt.get(chat.chatId) ?? 0;
    if (Date.now() - last < HEAVY_COOLDOWN_MS) return;
    this.heavyAt.set(chat.chatId, Date.now());
    await this.tg.sendChatAction(chat.chatId, 'upload_document');
    const { buffer, filename } = await this.report.dayExcel(day, scope, chat.showProfit);
    const r = await this.report.dayReport(day, scope);
    await this.tg.sendDocument(chat.chatId, buffer, filename, `📥 <b>Savdo · ${day.split('-').reverse().join('.')}</b>\n${r.receipts} ta chek · ${r.revenue.toLocaleString('ru-RU').replace(/ /g, ' ')} so'm`, MENU_INLINE);
  }
}
