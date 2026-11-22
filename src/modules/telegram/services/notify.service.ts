import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.js';
import type { DbOrTx } from '../../../db/db.module.js';
import { TelegramRepository, type OutboxKind } from '../repositories/telegram.repository.js';

/**
 * Savdo hodisalarini Telegram navbatiga yozadi — chaqiruvchining tranzaksiyasi ichida (chek saqlanmasa xabar ham yo'q).
 * Bot o'chiq bo'lsa hech narsa yozilmaydi (navbat bekorga o'smasin).
 */
@Injectable()
export class NotifyService {
  readonly enabled: boolean;
  readonly dailyAt: string;

  constructor(private readonly repo: TelegramRepository, config: ConfigService<Env, true>) {
    this.enabled = config.get('SALES_BOT_ENABLED', { infer: true }) && !!config.get('TELEGRAM_BOT_TOKEN', { infer: true });
    this.dailyAt = config.get('SALES_BOT_DAILY_AT', { infer: true });
  }

  async enqueue(tx: DbOrTx, kind: Exclude<OutboxKind, 'daily' | 'test' | 'own_use'>, refId: string, branchId: string) {
    if (!this.enabled) return;
    await this.repo.enqueue(tx, { kind, refId, branchId, dedupeKey: `${kind}:${refId}` });
  }

  /** «O'zimga olindi»: chek yo'q (sotuv emas), shuning uchun xabar ma'lumoti navbat yozuvining o'zida (payload) saqlanadi. */
  async enqueueOwnUse(tx: DbOrTx, expenseId: string, branchId: string, payload: Record<string, unknown>) {
    if (!this.enabled) return;
    await this.repo.enqueue(tx, { kind: 'own_use', refId: expenseId, branchId, payload, dedupeKey: `own_use:${expenseId}` });
  }

  /** Kun yakuni (bir kunga bitta). */
  async enqueueDaily(tx: DbOrTx, day: string) {
    if (!this.enabled) return;
    await this.repo.enqueue(tx, { kind: 'daily', payload: { day }, dedupeKey: `daily:${day}` });
  }

  async enqueueTest(tx: DbOrTx, chatId: string, by: string) {
    await this.repo.enqueue(tx, { kind: 'test', payload: { chatId, by }, dedupeKey: `test:${chatId}:${Date.now()}` });
  }
}
