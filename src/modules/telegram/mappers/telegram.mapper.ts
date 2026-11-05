import type { TelegramChatRow } from '../repositories/telegram.repository.js';

export interface TelegramChatView {
  id: string;
  chatId: string;
  type: TelegramChatRow['type'];
  title: string;
  branchIds: string[] | null;
  notifySales: boolean;
  minAmount: number;
  notifyVoids: boolean;
  notifyDebts: boolean;
  dailyReport: boolean;
  showProfit: boolean;
  active: boolean;
  linkedByName?: string;
  createdAt: Date;
}

export interface TelegramStatusView {
  /** Serverda savdo boti yoqilganmi (SALES_BOT_ENABLED + token). */
  enabled: boolean;
  botUsername?: string;
  /** Polling xatosi (masalan, bot boshqa serverda ham ishlayapti). */
  pollError?: string;
  /** Kun yakuni vaqti (Toshkent). */
  dailyAt: string;
  chats: TelegramChatView[];
}

export const toChatView = (c: TelegramChatRow): TelegramChatView => ({
  id: c.id, chatId: c.chatId, type: c.type, title: c.title, branchIds: c.branchIds?.length ? c.branchIds : null,
  notifySales: c.notifySales, minAmount: c.minAmount, notifyVoids: c.notifyVoids, notifyDebts: c.notifyDebts,
  dailyReport: c.dailyReport, showProfit: c.showProfit, active: c.active, createdAt: c.createdAt,
  ...(c.linkedByName ? { linkedByName: c.linkedByName } : {}),
});
