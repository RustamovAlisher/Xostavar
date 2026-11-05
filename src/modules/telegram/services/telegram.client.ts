import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.js';

export interface InlineButton { text: string; callback_data: string }
export type ReplyMarkup =
  | { inline_keyboard: InlineButton[][] }
  | { keyboard: { text: string }[][]; resize_keyboard?: boolean; is_persistent?: boolean }
  | { remove_keyboard: true };

export interface TgChat { id: number; type: 'private' | 'group' | 'supergroup' | 'channel'; title?: string; first_name?: string; last_name?: string; username?: string }
export interface TgMessage { message_id: number; chat: TgChat; from?: { id: number; first_name?: string; username?: string }; text?: string }
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: { id: number; first_name?: string }; message?: TgMessage; data?: string };
  my_chat_member?: { chat: TgChat; new_chat_member: { status: string } };
}

/** Telegram Bot API xatosi: `permanent` — chat yo'q / bot chiqarilgan (qayta urinish foydasiz). */
export class TelegramError extends Error {
  constructor(public readonly code: number, message: string, public readonly retryAfter?: number) {
    super(message);
  }
  get permanent() {
    return this.code === 403 || (this.code === 400 && /chat not found|bot was kicked|user is deactivated|group chat was upgraded|not enough rights/i.test(this.message));
  }
}

/** Bot API ustidagi yupqa qatlam (qo'shimcha kutubxonasiz, Node `fetch` + `FormData`). */
@Injectable()
export class TelegramClient {
  private readonly token?: string;

  constructor(config: ConfigService<Env, true>) {
    this.token = config.get('TELEGRAM_BOT_TOKEN', { infer: true }) || undefined;
  }

  get configured() {
    return !!this.token;
  }

  private async call<T>(method: string, body: Record<string, unknown> | FormData, timeoutMs = 20_000): Promise<T> {
    if (!this.token) throw new TelegramError(0, 'TELEGRAM_BOT_TOKEN berilmagan');
    const isForm = body instanceof FormData;
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: isForm ? undefined : { 'content-type': 'application/json' },
        body: isForm ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new TelegramError(0, `Telegram'ga ulanib bo'lmadi: ${(e as Error).message}`);
    }
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } };
    if (!data.ok) throw new TelegramError(data.error_code ?? res.status, data.description ?? `HTTP ${res.status}`, data.parameters?.retry_after);
    return data.result as T;
  }

  getMe() {
    return this.call<{ id: number; username: string; first_name: string }>('getMe', {});
  }

  /** Long polling: `timeout` soniya kutadi (so'rov vaqti undan uzunroq bo'lishi kerak). */
  getUpdates(offset: number, timeout = 25) {
    return this.call<TgUpdate[]>('getUpdates', { offset, timeout, allowed_updates: ['message', 'callback_query', 'my_chat_member'] }, (timeout + 10) * 1000);
  }

  sendMessage(chatId: string | number, html: string, replyMarkup?: ReplyMarkup) {
    return this.call<TgMessage>('sendMessage', {
      chat_id: chatId, text: html, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  sendDocument(chatId: string | number, file: Buffer, filename: string, captionHtml?: string, replyMarkup?: ReplyMarkup) {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('document', new Blob([new Uint8Array(file)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
    if (captionHtml) { form.set('caption', captionHtml); form.set('parse_mode', 'HTML'); }
    if (replyMarkup) form.set('reply_markup', JSON.stringify(replyMarkup));
    return this.call<TgMessage>('sendDocument', form, 60_000);
  }

  answerCallback(id: string, text?: string) {
    return this.call<boolean>('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) }).catch(() => false);
  }

  sendChatAction(chatId: string | number, action: 'typing' | 'upload_document') {
    return this.call<boolean>('sendChatAction', { chat_id: chatId, action }).catch(() => false);
  }
}
