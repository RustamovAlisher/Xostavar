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
const dtFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
/** "22.11.2026 10:15" (Toshkent vaqti) */
export const dateTimeTk = (d: Date) => dtFmt.format(d).replace(',', '');
/** "2026-11-06" → "06.11.2026" */
export const dayDots = (day: string) => day.split('-').reverse().join('.');

const KIND_ICON: Record<string, string> = { cash: '💵', card: '💳', transfer: '🏦', other: '📱', debt: '📒' };
export const kindIcon = (kind: string) => KIND_ICON[kind] ?? '💠';

export interface PayView { kind: string; label: string; amount: number; amountUsd?: number | null }
export interface CutView { lengthMeters: number; quantity: number }
export interface LineView { name: string; variantName?: string | null; qty: number; unit: string; unitPrice: number; lineTotal: number; cuts?: CutView[] | null }

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

/** Telegram xabari 4096 belgidan oshmasin: mahsulot bloklari shu chegaraga sig'gancha ko'rsatiladi. */
const MSG_LIMIT = 3900;
const RULE = '──────────────';

/** Bitta mahsulot bloki: raqam, nom, «miqdor × narx = summa» va (bo'lsa) kesish tafsiloti. Oddiy so'zlar bilan. */
function lineBlock(l: LineView, i: number): string {
  const name = esc(l.variantName ? `${l.name} — ${l.variantName}` : l.name);
  const out = [
    `<b>${i + 1}.</b> ${name}`,
    `     ${qtyStr(l.qty)} ${esc(l.unit)} × ${money(l.unitPrice)} = <b>${money(l.lineTotal)} so'm</b>`,
  ];
  if (cutsOf(l).length) out.push('     ✂️ <i>kesib beriladi — pastda yozilgan</i>');
  return out.join('\n');
}

const cutsOf = (l: LineView) => (l.cuts ?? []).filter((c) => c.lengthMeters > 0 && c.quantity > 0);

/**
 * «Kesib berish» bo'limi: temir mahsulotlar (truba, armatura, ugolok …) qaysi o'lchamda va nechta kesilishi — qalin yozuvda,
 * kesuvchi bir qarashda ko'rsin. Faqat kesimli qatorlar bo'lsa chiqadi.
 */
function cutSection(lines: LineView[], limit = 1500): string {
  const rows = lines.map((l, i) => ({ l, i, cuts: cutsOf(l) })).filter((x) => x.cuts.length);
  if (!rows.length) return '';
  const out: string[] = ['✂️ <b>KESIB BERISH KERAK</b>'];
  let used = out[0].length;
  for (let k = 0; k < rows.length; k++) {
    const { l, i, cuts } = rows[k];
    const net = Math.round(cuts.reduce((a, c) => a + c.lengthMeters * c.quantity, 0) * 100) / 100;
    const block = [
      `<b>${i + 1}. ${esc(l.variantName ? `${l.name} — ${l.variantName}` : l.name)}</b>`,
      ...cuts.map((c) => `     ▪️ <b>${qtyStr(c.lengthMeters)} m × ${c.quantity} ta</b>`),
      `     jami: <b>${qtyStr(net)} m</b>`,
    ].join('\n');
    if (used + block.length > limit && k > 0) { out.push(`<i>… yana ${rows.length - k} ta mahsulot kesiladi (chekka qarang)</i>`); break; }
    out.push(block);
    used += block.length;
  }
  return out.join('\n');
}

/** Mahsulot bloklari (har biri bo'sh qator bilan ajratilgan); `budget` belgidan oshsa oxirida «yana N ta». */
function linesBlock(lines: LineView[], budget = MSG_LIMIT): string {
  const blocks: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const b = lineBlock(lines[i], i);
    if (used + b.length + 2 > budget && blocks.length) {
      blocks.push(`<i>… va yana ${lines.length - i} ta mahsulot (hammasi chekda)</i>`);
      return blocks.join('\n\n');
    }
    blocks.push(b);
    used += b.length + 2;
  }
  return blocks.join('\n\n');
}

/**
 * Sotuv xabari — chekning o'zi kabi, oddiy so'zlar bilan: kim, qachon, kimga; har mahsulot (kesilgan bo'lsa tafsiloti bilan);
 * jami; qanday to'langan (har usul alohida) va nasiya bo'lsa mijozning umumiy qarzi.
 */
export function saleMessage(s: SaleMsgInput): string {
  const credit = s.remainingDebt > 0;
  const head = [
    credit ? '📒 <b>NASIYAGA SOTUV</b>' : '🧾 <b>SOTUV</b>',
    `🕐 ${dateTimeTk(s.createdAt)} · Kassir: <b>${esc(s.cashierName)}</b>`,
    `👤 Mijoz: <b>${esc(s.customerName?.trim() || 'Oddiy mijoz')}</b>`,
    RULE,
  ].join('\n');

  const foot: string[] = [RULE];
  if (s.discount > 0) {
    foot.push(`Mahsulotlar: ${money(s.subtotal)} so'm`, `🏷 Chegirma: −${money(s.discount)} so'm`);
  }
  foot.push(`💰 <b>JAMI: ${money(s.total)} so'm</b>${s.usdRate ? `  (≈ ${usd(s.total / s.usdRate)})` : ''}`);
  if (s.payments.length || credit) {
    foot.push('', "<b>To'lov:</b>");
    for (const p of s.payments) {
      foot.push(`${kindIcon(p.kind)} ${esc(p.label)}: ${money(p.amount)} so'm${p.amountUsd ? ` (${usd(p.amountUsd)})` : ''}`);
    }
    if (credit) foot.push(`📒 Nasiyaga (qarzga): <b>${money(s.remainingDebt)} so'm</b>`);
  }
  if (credit && s.customerDebtAfter != null) foot.push(`⚠️ Mijozning umumiy qarzi: <b>${money(s.customerDebtAfter)} so'm</b>`);
  foot.push('', `<i>Chek № ${esc(s.number)} · ${esc(s.branchName)}</i>`);

  const cuts = cutSection(s.lines);
  const footStr = (cuts ? [RULE, cuts, ...foot] : foot).join('\n');
  return `${head}\n${linesBlock(s.lines, MSG_LIMIT - head.length - footStr.length - 4)}\n${footStr}`;
}

export interface OwnUseMsgInput { branchName: string; userName: string; createdAt: Date; lines: LineView[]; amount: number }

/** «O'zimga olindi» xabari: kim nimani oldi, qancha (kassadagi narxda) va u xarajatga yozilgani. Sotuv emas — foydaga kirmaydi. */
export function ownUseMessage(o: OwnUseMsgInput): string {
  const head = [
    '🏠 <b>O\'ZIMGA OLINDI</b>',
    `🕐 ${dateTimeTk(o.createdAt)} · Kim: <b>${esc(o.userName)}</b>`,
    RULE,
  ].join('\n');
  const cuts = cutSection(o.lines);
  const foot = [
    ...(cuts ? [RULE, cuts] : []),
    RULE,
    `💸 <b>Xarajatga yozildi (tannarxda): ${money(o.amount)} so'm</b>`,
    "<i>Bu sotuv emas: pul olinmadi, sotuv narxi olinmadi — tannarx xarajatlar bo'limiga tushdi.</i>",
    '',
    `<i>${esc(o.branchName)}</i>`,
  ].join('\n');
  return `${head}\n${linesBlock(o.lines, MSG_LIMIT - head.length - foot.length - 4)}\n${foot}`;
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
    ...(v.lines.length ? ['', RULE, linesBlock(v.lines, 2600)] : []),
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
