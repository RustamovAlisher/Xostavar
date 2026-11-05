import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { dayDots, timeTk, type DayReport, type DebtPayMsgInput, type LineView, type PayView, type ReceiptRow, type SaleMsgInput, type VoidMsgInput } from '../mappers/telegram.format.js';
import { TelegramRepository } from '../repositories/telegram.repository.js';

const SALE_PAY_FALLBACK: Record<string, string> = { cash: 'Naqd', card: 'Karta', transfer: "Bank o'tkazmasi", other: 'Boshqa', debt: 'Nasiya', mixed: 'Aralash' };

/** Telegram xabarlari va hisobotlar uchun ma'lumot yig'ish (shablonlar `telegram.format.ts` da). */
@Injectable()
export class SalesReportService {
  constructor(private readonly repo: TelegramRepository) {}

  private async unitShort() {
    const u = await this.repo.units();
    return (id: string) => u.find((x) => x.id === id)?.short ?? id;
  }

  private async methodLabel() {
    const m = await this.repo.methods();
    return (code: string) => m.find((x) => x.code === code)?.label ?? SALE_PAY_FALLBACK[code] ?? code;
  }

  async scopeName(branchIds: string[] | null) {
    const all = await this.repo.branches();
    if (!branchIds) return all.length > 1 ? 'Barcha filiallar' : (all[0]?.name ?? 'Do\'kon');
    return all.filter((b) => branchIds.includes(b.id)).map((b) => b.name).join(', ') || '—';
  }

  /** Bitta chek xabari uchun ma'lumot (sotuv / bekor / qarz to'lovi). */
  async saleData(saleId: string) {
    const row = await this.repo.sale(saleId);
    if (!row) return null;
    const { s, branchName } = row;
    const [lines, pays, unit] = await Promise.all([this.repo.saleLines(saleId), this.repo.salePayments([saleId]), this.unitShort()]);
    const lineViews: LineView[] = lines.map((l) => ({ name: l.name, variantName: l.variantName, qty: Number(l.qty), unit: unit(l.unit), unitPrice: l.unitPrice, lineTotal: l.lineTotal }));
    const payViews: PayView[] = pays.map((p) => ({ kind: p.kind, label: p.label ?? SALE_PAY_FALLBACK[p.kind] ?? p.methodCode, amount: p.amount, amountUsd: p.amountUsd }));
    const sale: SaleMsgInput = {
      number: s.number, branchName, cashierName: s.cashierName, customerName: s.customerName, createdAt: s.createdAt, lines: lineViews,
      subtotal: s.subtotal, discount: s.discountAmount, total: s.totalAmount, remainingDebt: s.remainingDebt, customerDebtAfter: s.customerDebtAfter, usdRate: s.usdRate, payments: payViews,
    };
    const voided: VoidMsgInput | null = s.status === 'voided' && s.voidedAt
      ? { number: s.number, branchName, cashierName: s.cashierName, customerName: s.customerName, total: s.totalAmount, createdAt: s.createdAt, voidedAt: s.voidedAt, voidedByName: s.voidedByName, reason: s.voidReason, lines: lineViews }
      : null;
    const debt: DebtPayMsgInput = { number: s.number, branchName, cashierName: s.cashierName, customerName: s.customerName, amount: s.totalAmount, debtAfter: s.customerDebtAfter, createdAt: s.createdAt, payments: payViews };
    return { s, sale, voided, debt };
  }

  /** Kun hisoboti: `branchIds` null — barcha filiallar. */
  async dayReport(day: string, branchIds: string[] | null): Promise<DayReport> {
    const [rows, voids, exp, lowStock, scopeName, unit] = await Promise.all([
      this.repo.daySales(day, branchIds), this.repo.dayVoids(day, branchIds), this.repo.dayExpenses(day, branchIds),
      this.repo.lowStockCount(branchIds), this.scopeName(branchIds), this.unitShort(),
    ]);
    const done = rows.filter((r) => r.s.status === 'completed');
    const sales = done.filter((r) => r.s.type === 'sale');
    const debtPays = done.filter((r) => r.s.type === 'debt_payment');
    const pays = await this.repo.salePayments(sales.map((r) => r.s.id));

    const byMethod = new Map<string, { kind: string; label: string; amount: number }>();
    let usdTotal = 0;
    for (const p of pays) {
      const k = p.methodCode;
      const cur = byMethod.get(k) ?? { kind: p.kind, label: p.label ?? SALE_PAY_FALLBACK[p.kind] ?? k, amount: 0 };
      cur.amount += p.amount;
      byMethod.set(k, cur);
      usdTotal += Number(p.amountUsd ?? 0);
    }
    const credit = sales.filter((r) => r.s.remainingDebt > 0);

    // Eng ko'p sotilgan: qatorlar summasi bo'yicha
    const lines = await this.repo.dayLines(day, branchIds);
    const prod = new Map<string, { name: string; qty: number; unit: string; total: number }>();
    for (const { l } of lines) {
      const key = `${l.productId}|${l.variantId ?? ''}|${l.unit}`;
      const cur = prod.get(key) ?? { name: l.variantName ? `${l.name} (${l.variantName})` : l.name, qty: 0, unit: unit(l.unit), total: 0 };
      cur.qty += Number(l.qty);
      cur.total += l.lineTotal;
      prod.set(key, cur);
    }
    const group = (key: (r: (typeof sales)[number]) => string) => {
      const m = new Map<string, { name: string; count: number; total: number }>();
      for (const r of sales) {
        const k = key(r);
        const cur = m.get(k) ?? { name: k, count: 0, total: 0 };
        cur.count++;
        cur.total += r.s.totalAmount;
        m.set(k, cur);
      }
      return [...m.values()].sort((a, b) => b.total - a.total);
    };

    return {
      day, scopeName,
      revenue: sales.reduce((a, r) => a + r.s.totalAmount, 0),
      receipts: sales.length,
      discount: sales.reduce((a, r) => a + r.s.discountAmount, 0),
      profit: sales.reduce((a, r) => a + r.s.profit, 0),
      byMethod: [...byMethod.values()].filter((m) => m.amount > 0).sort((a, b) => b.amount - a.amount),
      usdTotal: Math.round(usdTotal * 100) / 100,
      creditGiven: credit.reduce((a, r) => a + r.s.remainingDebt, 0),
      creditCount: credit.length,
      debtPayments: debtPays.reduce((a, r) => a + r.s.totalAmount, 0),
      debtPaymentCount: debtPays.length,
      voids,
      expenses: exp.sum,
      topProducts: [...prod.values()].sort((a, b) => b.total - a.total).slice(0, 5),
      cashiers: group((r) => r.s.cashierName),
      branches: group((r) => r.branchName),
      lowStock,
    };
  }

  async receipts(day: string, branchIds: string[] | null): Promise<ReceiptRow[]> {
    const [rows, label] = await Promise.all([this.repo.daySales(day, branchIds), this.methodLabel()]);
    return rows.map(({ s, branchName }) => ({
      createdAt: s.createdAt, number: s.number, type: s.type, status: s.status, total: s.totalAmount, remainingDebt: s.remainingDebt,
      payLabel: label(s.paymentSummary), cashierName: s.cashierName, customerName: s.customerName, branchName,
    }));
  }

  /** Kunlik savdo Excel fayli: Jami, Cheklar, Mahsulotlar (har qator), Mahsulot bo'yicha. */
  async dayExcel(day: string, branchIds: string[] | null, showProfit: boolean): Promise<{ buffer: Buffer; filename: string }> {
    const [report, rows, lines, label, unit] = await Promise.all([
      this.dayReport(day, branchIds), this.repo.daySales(day, branchIds), this.repo.dayLines(day, branchIds), this.methodLabel(), this.unitShort(),
    ]);
    const pays = await this.repo.salePayments(rows.map((r) => r.s.id));
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Ombor Control';
    wb.created = new Date();
    const MONEY = '#,##0';
    const head = (ws: ExcelJS.Worksheet) => {
      const r = ws.getRow(1);
      r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
      r.alignment = { vertical: 'middle' };
      r.height = 20;
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
    };

    // 1) Jami
    const sum = wb.addWorksheet('Jami');
    sum.columns = [{ header: "Ko'rsatkich", key: 'k', width: 34 }, { header: 'Qiymat', key: 'v', width: 22 }];
    const add = (k: string, v: number | string, money = true) => { const r = sum.addRow({ k, v }); if (money && typeof v === 'number') r.getCell('v').numFmt = MONEY; };
    add('Sana', dayDots(day), false);
    add('Filial', report.scopeName, false);
    add("Tushum (so'm)", report.revenue);
    add('Cheklar soni', report.receipts, false);
    add("O'rtacha chek", report.receipts ? Math.round(report.revenue / report.receipts) : 0);
    add('Chegirmalar', report.discount);
    for (const m of report.byMethod) add(`  ${m.label}`, m.amount);
    if (report.usdTotal) add('  shundan dollarda ($)', report.usdTotal, false);
    add('Nasiyaga berildi', report.creditGiven);
    add("Qarz to'lovlari", report.debtPayments);
    add('Bekor qilingan cheklar', `${report.voids.count} ta · ${report.voids.sum.toLocaleString('ru-RU')} so'm`, false);
    add('Xarajatlar', report.expenses);
    if (showProfit) { add('Yalpi foyda', report.profit); add('Xarajatdan keyingi foyda', report.profit - report.expenses); }
    head(sum);
    sum.autoFilter = undefined as unknown as ExcelJS.AutoFilter;

    // 2) Cheklar
    const ch = wb.addWorksheet('Cheklar');
    ch.columns = [
      { header: 'Vaqt', key: 't', width: 8 }, { header: 'Chek №', key: 'n', width: 22 }, { header: 'Turi', key: 'type', width: 13 }, { header: 'Holat', key: 'st', width: 12 },
      { header: 'Filial', key: 'b', width: 18 }, { header: 'Kassir', key: 'c', width: 18 }, { header: 'Mijoz', key: 'cu', width: 22 },
      { header: 'Oraliq', key: 'sub', width: 13 }, { header: 'Chegirma', key: 'd', width: 11 }, { header: 'Jami', key: 'tot', width: 13 },
      { header: "To'lov usuli", key: 'pm', width: 16 }, { header: 'Naqd', key: 'cash', width: 12 }, { header: 'Karta', key: 'card', width: 12 },
      { header: 'Bank', key: 'tr', width: 12 }, { header: 'Boshqa', key: 'oth', width: 11 }, { header: 'Dollar ($)', key: 'usd', width: 11 },
      { header: 'Nasiya', key: 'debt', width: 12 }, ...(showProfit ? [{ header: 'Foyda', key: 'pr', width: 12 }] : []), { header: 'Bekor sababi', key: 'vr', width: 24 },
    ];
    for (const { s, branchName } of rows) {
      const p = pays.filter((x) => x.saleId === s.id);
      const by = (k: string) => p.filter((x) => x.kind === k).reduce((a, x) => a + x.amount, 0) || null;
      const r = ch.addRow({
        t: timeTk(s.createdAt), n: s.number, type: s.type === 'sale' ? 'Sotuv' : "Qarz to'lovi", st: s.status === 'voided' ? 'Bekor' : 'Bajarilgan',
        b: branchName, c: s.cashierName, cu: s.customerName, sub: s.subtotal, d: s.discountAmount || null, tot: s.totalAmount,
        pm: label(s.paymentSummary), cash: by('cash'), card: by('card'), tr: by('transfer'), oth: by('other'),
        usd: p.reduce((a, x) => a + Number(x.amountUsd ?? 0), 0) || null, debt: s.remainingDebt || null, pr: s.type === 'sale' ? s.profit : null, vr: s.voidReason ?? '',
      });
      for (const k of ['sub', 'd', 'tot', 'cash', 'card', 'tr', 'oth', 'debt', 'pr']) if (ch.getColumn(k)) r.getCell(k).numFmt = MONEY;
      if (s.status === 'voided') r.font = { strike: true, color: { argb: 'FF9CA3AF' } };
    }
    head(ch);

    // 3) Mahsulotlar (har qator)
    const ln = wb.addWorksheet('Mahsulotlar');
    ln.columns = [
      { header: 'Vaqt', key: 't', width: 8 }, { header: 'Chek №', key: 'n', width: 22 }, { header: 'Filial', key: 'b', width: 18 }, { header: 'Kassir', key: 'c', width: 18 },
      { header: 'Mahsulot', key: 'p', width: 40 }, { header: 'Variant', key: 'v', width: 16 }, { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Miqdor', key: 'q', width: 10 }, { header: 'Birlik', key: 'u', width: 8 }, { header: 'Narx', key: 'pr', width: 12 }, { header: 'Summa', key: 'sum', width: 13 },
    ];
    for (const { l, number, createdAt, branchName, cashierName } of lines) {
      const r = ln.addRow({ t: timeTk(createdAt), n: number, b: branchName, c: cashierName, p: l.name, v: l.variantName ?? '', sku: l.sku, q: Number(l.qty), u: unit(l.unit), pr: l.unitPrice, sum: l.lineTotal });
      r.getCell('pr').numFmt = MONEY;
      r.getCell('sum').numFmt = MONEY;
    }
    head(ln);

    // 4) Mahsulot bo'yicha jamlama
    const ag = wb.addWorksheet("Mahsulot bo'yicha");
    ag.columns = [{ header: 'Mahsulot', key: 'p', width: 44 }, { header: 'Miqdor', key: 'q', width: 10 }, { header: 'Birlik', key: 'u', width: 8 }, { header: 'Summa', key: 'sum', width: 14 }, { header: 'Cheklar', key: 'n', width: 9 }];
    const m = new Map<string, { p: string; q: number; u: string; sum: number; n: Set<string> }>();
    for (const { l, number } of lines) {
      const key = `${l.productId}|${l.variantId ?? ''}|${l.unit}`;
      const cur = m.get(key) ?? { p: l.variantName ? `${l.name} (${l.variantName})` : l.name, q: 0, u: unit(l.unit), sum: 0, n: new Set<string>() };
      cur.q += Number(l.qty);
      cur.sum += l.lineTotal;
      cur.n.add(number);
      m.set(key, cur);
    }
    for (const v of [...m.values()].sort((a, b) => b.sum - a.sum)) ag.addRow({ p: v.p, q: Math.round(v.q * 10_000) / 10_000, u: v.u, sum: v.sum, n: v.n.size }).getCell('sum').numFmt = MONEY;
    head(ag);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { buffer, filename: `savdo-${day}.xlsx` };
  }
}
