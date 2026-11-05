import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { DB, type Db } from '../../../db/db.module.js';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { notFound, unprocessable } from '../../../common/errors/app-error.js';
import { AuditService } from '../../audit/services/audit.service.js';
import type { UpdateTelegramChatDto } from '../dto/telegram.dto.js';
import { toChatView, type TelegramStatusView } from '../mappers/telegram.mapper.js';
import { linkCode } from '../mappers/telegram.rules.js';
import { TelegramRepository } from '../repositories/telegram.repository.js';
import { NotifyService } from './notify.service.js';
import { TelegramBotService } from './telegram-bot.service.js';

const LINK_TTL_MS = 15 * 60_000;

/** Sozlamalar sahifasi uchun: bot holati, chat ulash kodi, chat sozlamalari. */
@Injectable()
export class TelegramService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: TelegramRepository,
    private readonly notify: NotifyService,
    private readonly bot: TelegramBotService,
    private readonly audit: AuditService,
  ) {}

  async status(): Promise<TelegramStatusView> {
    return {
      enabled: this.notify.enabled,
      ...(this.bot.botUsername ? { botUsername: this.bot.botUsername } : {}),
      ...(this.bot.pollError ? { pollError: this.bot.pollError } : {}),
      dailyAt: this.notify.dailyAt,
      chats: (await this.repo.chats()).map(toChatView),
    };
  }

  /** Bir martalik kod: shaxsiy chat yoki guruh uchun havolalar bilan. */
  async createLinkCode(user: AuthUser) {
    if (!this.notify.enabled) throw unprocessable('validation_failed', "Savdo boti serverda yoqilmagan (SALES_BOT_ENABLED)");
    const code = linkCode((n) => randomInt(n));
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await this.repo.insertLinkCode({ code, createdBy: user.id, createdByName: user.name, expiresAt });
    const u = this.bot.botUsername;
    return {
      code, expiresAt,
      ...(u ? { botUsername: u, privateUrl: `https://t.me/${u}?start=${code}`, groupUrl: `https://t.me/${u}?startgroup=${code}` } : {}),
    };
  }

  async updateChat(user: AuthUser, id: string, dto: UpdateTelegramChatDto) {
    const before = await this.repo.chatById(id);
    if (!before) throw notFound('Telegram chat');
    const fields = {
      branchIds: dto.branchIds === undefined ? undefined : dto.branchIds?.length ? dto.branchIds : null,
      notifySales: dto.notifySales, minAmount: dto.minAmount, notifyVoids: dto.notifyVoids, notifyDebts: dto.notifyDebts,
      dailyReport: dto.dailyReport, showProfit: dto.showProfit, active: dto.active,
    };
    const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const row = await this.repo.updateChat(id, patch);
    await this.audit.log(user, { action: 'edit', module: 'Sozlamalar', targetId: id, targetName: `Telegram: ${before.title}`, details: `Telegram chat sozlamalari: ${Object.keys(patch).join(', ')}` });
    return toChatView(row);
  }

  async removeChat(user: AuthUser, id: string) {
    const before = await this.repo.chatById(id);
    if (!before) throw notFound('Telegram chat');
    await this.repo.deleteChat(id);
    await this.audit.log(user, { action: 'delete', module: 'Sozlamalar', targetId: id, targetName: `Telegram: ${before.title}`, details: 'Telegram chat uzildi' });
  }

  async sendTest(user: AuthUser, id: string) {
    const c = await this.repo.chatById(id);
    if (!c) throw notFound('Telegram chat');
    if (!this.notify.enabled) throw unprocessable('validation_failed', 'Savdo boti serverda yoqilmagan');
    await this.notify.enqueueTest(this.db, c.chatId, user.name);
    return { queued: true };
  }
}
