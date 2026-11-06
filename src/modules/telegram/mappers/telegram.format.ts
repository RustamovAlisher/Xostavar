/**
 * Telegram xabar shablonlari (HTML parse_mode). Sof funksiyalar — bazaga murojaat yo'q, unit testda tekshiriladi.
 * Telegram HTML: faqat <b>, <i>, <s>, <code>, <a> va h.k.; `<`, `>`, `&` har doim ekranlanadi.
 */

export const esc = (s: string | null | undefined) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 1234567 → "1 234 567" (bo'shliq — oddiy probel, Telegram'da buzilmasin). */
export function money(n: number): string {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? '−' : ''}${Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}

export function usd(n: number): string {
  const [i, f] = Math.abs(n).toFixed(2).split('.');
  return `$${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${f}`;
}

/** Miqdor: ortiqcha nollarsiz, 4 xonagacha. */
export function qtyStr(q: number): string {
  return String(Math.round(Number(q) * 10_000) / 10_000).replace('.', ',');
}

const tkFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Tashkent', hour: '2-digit', minute: '2-digit', hour12: false });
export const timeTk = (d: Date) => tkFmt.format(d);
/** "2026-11-06" → "06.11.2026" */
export const dayDots = (day: string) => day.split('-').reverse().join('.');

const KIND_ICON: Record<string, string> = { cash: '💵', card: '💳', transfer: '🏦', other: '📱', debt: '📒' };
export const kindIcon = (kind: string) => KIND_ICON[kind] ?? '💠';

export interface PayView { kind: string; label: string; amount: number; amountUsd?: number | null }
export interface LineView { name: string; variantName?: string | null; qty: number; unit: string; unitPrice: number; lineTotal: number }

export interface SaleMsgInput {
  number: string;
  branchName: string;
  cashierName: string;
  customerName: string;
  createdAt: Date;
  lines: LineView[];
  subtotal: number;
  discount: number;
  total: number;
  remainingDebt: number;
  customerDebtAfter?: number | null;
  usdRate?: number | null;
  payments: PayView[];
}

/** Xabarda ko'rsatiladigan qatorlar chegarasi (Telegram 4096 belgi). */
const MAX_LINES = 25;

function linesBlock(lines: LineView[]): string {
  const shown = lines.slice(0, MAX_LINES).map((l) => {
    const name = esc(l.variantName ? `${l.name} (${l.variantName})` : l.name);
    return `• ${name} — ${qtyStr(l.qty)} ${esc(l.unit)} × ${money(l.unitPrice)} = <b>${money(l.lineTotal)}</b>`;
  });
  if (lines.length > MAX_LINES) shown.push(`<i>… va yana ${lines.length - MAX_LINES} ta mahsulot</i>`);
  return shown.join('\n');
}

/** Sotuv xabari: nima, qancha va jami. Chek raqami, filial va kassir — pastda bitta kichik qatorda. */
export function saleMessage(s: SaleMsgInput): string {
  const credit = s.remainingDebt > 0;
  const out = [
    `${credit ? '📒 <b>Nasiyaga sotuv</b>' : '🧾 <b>Sotuv</b>'} · ${timeTk(s.createdAt)}`,
    '',
    linesBlock(s.lines),
    '',
  ];
  if (s.discount > 0) out.push(`🏷 Chegirma: −${money(s.discount)}`);
  out.push(`💰 <b>Jami: ${money(s.total)} so'm</b>${s.usdRate ? `  (≈ ${usd(s.total / s.usdRate)})` : ''}`);
  if (credit) out.push(`📒 Qarzga: <b>${money(s.remainingDebt)}</b> · ${esc(s.customerName || 'Oddiy mijoz')}${s.customerDebtAfter != null ? ` (jami qarzi ${money(s.customerDebtAfter)})` : ''}`);
  out.push('', `<i>${esc(s.number)} · ${esc(s.branchName)} · ${esc(s.cashierName)}</i>`);
  return out.join('\n');
}

export interface VoidMsgInput { number: string; branchName: string; cashierName: string; customerName: string; total: number; createdAt: Date; voidedAt: Date; voidedByName?: string | null; reason?: string | null; lines: LineView[] }

export function voidMessage(v: VoidMsgInput): string {
  return [
    `❌ <b>Chek bekor qilindi</b> · <code>${esc(v.number)}</code>`,
    `🏬 ${esc(v.branchName)} · 🕐 ${timeTk(v.voidedAt)}`,
    '',
    `Summa: <b><s>${money(v.total)}</s> so'm</b> · ${v.lines.length} ta qator`,
    `Sotgan: ${esc(v.cashierName)} (${timeTk(v.createdAt)}) · Mijoz: ${esc(v.customerName || 'Oddiy mijoz')}`,
    `Bekor qildi: <b>${esc(v.voidedByName ?? '—')}</b>`,
    `Sabab: <i>${esc(v.reason || '—')}</i>`,
  ].join('\n');
}

export interface DebtPayMsgInput { number: string; branchName: string; cashierName: string; customerName: string; amount: number; debtAfter?: number | null; createdAt: Date; payments: PayView[] }

export function debtPaymentMessage(d: DebtPayMsgInput): string {
  return [
    `💰 <b>Qarz to'landi</b> · <code>${esc(d.number)}</code>`,
    `🏬 ${esc(d.branchName)} · 👤 ${esc(d.cashierName)} · 🕐 ${timeTk(d.createdAt)}`,
    '',
    `👥 Mijoz: <b>${esc(d.customerName)}</b>`,
    `To'lov: <b>${money(d.amount)} so'm</b>${d.payments[0] ? ` · ${kindIcon(d.payments[0].kind)} ${esc(d.payments[0].label)}` : ''}`,
    `Qolgan qarz: ${d.debtAfter != null ? `${money(d.debtAfter)} so'm` : '—'}`,
  ].join('\n');
}

/* ───────── Kunlik hisobot ───────── */

export interface DayReport {
  day: string;
  /** Hisobot qamragan filiallar nomi (bitta bo'lsa — o'sha, hammasi bo'lsa — "Barcha filiallar"). */
  scopeName: string;
  revenue: number;
  receipts: number;
  discount: number;
  profit: number;
  byMethod: { kind: string; label: string; amount: number }[];
  usdTotal: number;
  creditGiven: number;
  creditCount: number;
  debtPayments: number;
  debtPaymentCount: number;
  voids: { count: number; sum: number };
  expenses: number;
  topProducts: { name: string; qty: number; unit: string; total: number }[];
  cashiers: { name: string; count: number; total: number }[];
  branches: { name: string; count: number; total: number }[];
  lowStock: number;
}

export function dailyReportMessage(r: DayReport, opts: { showProfit: boolean; asOf?: Date; title?: string }): string {
  const out: string[] = [
    `📊 <b>${esc(opts.title ?? 'Kun yakuni')} · ${dayDots(r.day)}</b>${opts.asOf ? ` <i>(${timeTk(opts.asOf)} holatiga)</i>` : ''}`,
    `🏬 ${esc(r.scopeName)}`,
    '',
  ];
  if (!r.receipts && !r.debtPaymentCount && !r.voids.count) {
    out.push('Bu kunda sotuv bo\'lmadi.');
    if (r.expenses) out.push(`💸 Xarajatlar: ${money(r.expenses)} so'm`);
    return out.join('\n');
  }
  out.push(`💰 Tushum: <b>${money(r.revenue)} so'm</b>`);
  out.push(`🧾 Cheklar: <b>${r.receipts}</b> ta${r.receipts ? ` · o'rtacha ${money(Math.round(r.revenue / r.receipts))}` : ''}`);
  if (r.discount) out.push(`🏷 Chegirmalar: ${money(r.discount)} so'm`);
  if (r.byMethod.length) {
    out.push('');
    for (const m of r.byMethod) out.push(`${kindIcon(m.kind)} ${esc(m.label)}: ${money(m.amount)}`);
    if (r.usdTotal) out.push(`   shundan dollarda: ${usd(r.usdTotal)}`);
  }
  if (r.creditGiven || r.debtPayments) {
    out.push('');
    if (r.creditGiven) out.push(`📒 Nasiyaga berildi: ${money(r.creditGiven)} so'm (${r.creditCount} ta)`);
    if (r.debtPayments) out.push(`💵 Qarz to'lovlari: ${money(r.debtPayments)} so'm (${r.debtPaymentCount} ta)`);
  }
  if (r.voids.count) out.push(`❌ Bekor qilingan: ${r.voids.count} ta (${money(r.voids.sum)} so'm)`);
  if (r.expenses) out.push(`💸 Xarajatlar: ${money(r.expenses)} so'm`);
  if (opts.showProfit) out.push(`📈 Yalpi foyda: <b>${money(r.profit)} so'm</b>${r.expenses ? ` · xarajatdan keyin ${money(r.profit - r.expenses)}` : ''}`);

  if (r.topProducts.length) {
    out.push('', '🔝 <b>Eng ko\'p sotilgan</b>');
    r.topProducts.forEach((p, i) => out.push(`${i + 1}. ${esc(p.name)} — ${qtyStr(p.qty)} ${esc(p.unit)} · ${money(p.total)}`));
  }
  if (r.branches.length > 1) {
    out.push('', '🏬 <b>Filiallar</b>');
    for (const b of r.branches) out.push(`• ${esc(b.name)}: ${money(b.total)} (${b.count} chek)`);
  }
  if (r.cashiers.length) {
    out.push('', '👤 <b>Kassirlar</b>');
    for (const c of r.cashiers) out.push(`• ${esc(c.name)}: ${money(c.total)} (${c.count} chek)`);
  }
  if (r.lowStock) out.push('', `⚠️ Kam qolgan tovarlar: ${r.lowStock} ta`);
  return out.join('\n');
}

export interface ReceiptRow { createdAt: Date; number: string; type: 'sale' | 'debt_payment'; status: 'completed' | 'voided'; total: number; remainingDebt: number; payLabel: string; cashierName: string; customerName: string; branchName: string }

/**
 * Kun cheklari ro'yxati — Telegram 4096 belgi chegarasi uchun bo'laklarga bo'linadi.
 * `maxParts` dan oshsa oxirida "to'liq ro'yxat — Excel" eslatmasi.
 */
export function receiptsListMessages(day: string, scopeName: string, rows: ReceiptRow[], maxParts = 4, limit = 3800): string[] {
  const head = `🧾 <b>Cheklar · ${dayDots(day)}</b> · ${esc(scopeName)}\n`;
  if (!rows.length) return [`${head}\nBu kunda chek yo'q.`];
  const multiBranch = new Set(rows.map((r) => r.branchName)).size > 1;
  const items = rows.map((r) => {
    const num = r.number.split('-').pop();
    const sum = `${money(r.total)}`;
    const tag = r.type === 'debt_payment' ? '💰 qarz to\'lovi' : r.remainingDebt > 0 ? `📒 nasiya ${money(r.remainingDebt)}` : esc(r.payLabel);
    const body = `${timeTk(r.createdAt)} · №${esc(num)} · <b>${sum}</b> · ${tag} · ${esc(r.cashierName)}${multiBranch ? ` · ${esc(r.branchName)}` : ''}`;
    return r.status === 'voided' ? `❌ <s>${body}</s>` : body;
  });
  const done = rows.filter((r) => r.status === 'completed' && r.type === 'sale');
  const foot = `\nJami: <b>${done.length}</b> ta sotuv · <b>${money(done.reduce((a, r) => a + r.total, 0))} so'm</b>`;
  const parts: string[] = [];
  let cur = head;
  for (const it of items) {
    if ((cur + '\n' + it).length > limit) {
      parts.push(cur);
      if (parts.length >= maxParts) break;
      cur = '';
    }
    cur += (cur ? '\n' : '') + it;
  }
  if (parts.length >= maxParts) {
    parts[parts.length - 1] += `\n\n<i>… ro'yxat uzun — to'liq ma'lumot uchun «📥 Excel» tugmasini bosing</i>${foot}`;
  } else {
    parts.push(cur + '\n' + foot);
  }
  return parts;
}
