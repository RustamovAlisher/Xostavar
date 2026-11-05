import type { OutboxKind, TelegramChatRow } from '../repositories/telegram.repository.js';

export interface EventCtx {
  branchId: string | null;
  total?: number;
  remainingDebt?: number;
}

/** Chat shu filial xabarini oladimi (null — barcha filiallar). */
export const coversBranch = (chat: Pick<TelegramChatRow, 'branchIds'>, branchId: string | null) =>
  !chat.branchIds?.length || !branchId || chat.branchIds.includes(branchId);

/**
 * Hodisa shu chatga yuboriladimi. Nasiyaga sotuv «har sotuv» o'chiq bo'lsa ham «nasiya» yoqilgan chatga boradi;
 * `minAmount` faqat oddiy sotuv xabarini cheklaydi (bekor qilish va nasiya har doim muhim).
 */
export function wants(chat: TelegramChatRow, kind: OutboxKind, ctx: EventCtx): boolean {
  if (!chat.active) return false;
  if (kind === 'test') return true;
  if (kind !== 'daily' && !coversBranch(chat, ctx.branchId)) return false;
  switch (kind) {
    case 'sale': {
      const credit = (ctx.remainingDebt ?? 0) > 0;
      if (credit && chat.notifyDebts) return true;
      return chat.notifySales && (ctx.total ?? 0) >= (chat.minAmount ?? 0);
    }
    case 'void':
      return chat.notifyVoids;
    case 'debt_payment':
      return chat.notifyDebts;
    case 'daily':
      return chat.dailyReport;
    default:
      return false;
  }
}

/** Qayta urinish oralig'i: 10 s, 30 s, 1 min, 2 min, 5 min, 10 min, 30 min. */
export const RETRY_DELAYS_S = [10, 30, 60, 120, 300, 600, 1800];
export const MAX_ATTEMPTS = RETRY_DELAYS_S.length + 1;

/** Toshkent (UTC+5, yozgi vaqt yo'q) bo'yicha bugungi sana. */
const TZ_OFFSET_MS = 5 * 3600_000;
export const tashkentDay = (d = new Date()) => new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);

/** `HH:MM` Toshkent vaqtining shu kungi (yoki ertangi) UTC momenti — keyingi kun yakuni hisoboti uchun. */
export function nextDailyAt(at: string, now = new Date()): Date {
  const [h, m] = at.split(':').map(Number);
  const local = new Date(now.getTime() + TZ_OFFSET_MS);
  let t = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - TZ_OFFSET_MS;
  if (t <= now.getTime()) t += 86_400_000;
  return new Date(t);
}

/** Bugungi hisobot vaqti o'tganmi (server shu paytda o'chiq bo'lgan bo'lsa yonganda yuborish uchun). */
export function dailyDue(at: string, now = new Date()): boolean {
  const [h, m] = at.split(':').map(Number);
  const local = new Date(now.getTime() + TZ_OFFSET_MS);
  return local.getUTCHours() * 60 + local.getUTCMinutes() >= h * 60 + m;
}

/** Ulash kodi: chalkash belgilar (0/O, 1/I/L) siz 6 belgi. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function linkCode(rand: (n: number) => number = (n) => Math.floor(Math.random() * n)): string {
  return Array.from({ length: 6 }, () => ALPHABET[rand(ALPHABET.length)]).join('');
}
