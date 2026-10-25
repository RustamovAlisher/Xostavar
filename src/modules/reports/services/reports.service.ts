import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../../common/decorators/auth-context.js';
import { forbidden } from '../../../common/errors/app-error.js';
import { addDays, todayISO } from '../../../common/utils/numbers.js';
import { toCashFlow, toDashboard, toDebts, toLowStockList, toProductsReport, toProfitLoss, toRevenue } from '../mappers/reports.mapper.js';
import { ReportsRepository } from '../repositories/reports.repository.js';

type Range = { from: string; to: string; branchId?: string };

/**
 * Hisobotlar (TZ 8.10, 9.9). Hammasi SQL agregatlari — chek soniga bog'liq bo'lmagan doimiy sonli so'rov.
 * Filial: joriy filial yoki `all` (faqat egasi).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly repo: ReportsRepository) {}

  /** Filial id yoki null (`all`); so'ralgan boshqa filial faqat all_branches uchun, aks holda joriy filial. */
  private scopeId(user: AuthUser, branchId: string, requested: string | undefined): string | null {
    if (requested === 'all') return null;
    return requested && user.allBranches ? requested : branchId;
  }

  /** `scopeId` + ruxsat: `all` faqat all_branches uchun (TZ 8.12 (1)). */
  private scope(user: AuthUser, branchId: string, requested: string | undefined): string | null {
    if (requested === 'all' && !user.allBranches) throw forbidden('Barcha filiallar hisoboti faqat egasi uchun', 'branch_forbidden');
    return this.scopeId(user, branchId, requested);
  }

  /** Frontend "Moliya va statistika" sahifasi uchun bitta javob (TZ 9.9 dashboard). */
  async dashboard(user: AuthUser, branchId: string, requested?: string, date?: string) {
    const today = date ?? todayISO();
    const yesterday = addDays(today, -1);
    const monthStart = addDays(today, -29);
    const withCost = user.permissions.includes('view_cost_price');
    const withExp = user.permissions.includes('view_expenses');
    const scId = this.scope(user, branchId, requested);

    const [byDay, catShare, payToday, debt, inv, lowStock, exp, expByCat, soldCostToday, stockInToday] = await Promise.all([
      this.repo.dashboardByDay(scId, monthStart, today),
      this.repo.categoryShare(scId, monthStart, today),
      this.repo.paymentsOfDay(scId, today),
      this.repo.debtAggregate(today),
      this.repo.inventoryValue(scId, withCost),
      this.repo.lowStockTop(scId, 50),
      withExp ? this.repo.expenseAggregate(scId, today, yesterday, monthStart) : { today: 0, yesterday: 0, month: 0 },
      withExp ? this.repo.expensesByCategory(scId, monthStart, today) : [],
      // Kechagi ombor qiymatini taxminlash uchun: bugun sotilganning tannarxi va bugungi kirim summasi
      this.repo.soldCostOfDay(scId, today),
      this.repo.stockInCostOfDay(scId, today),
    ]);
    return toDashboard({ today, scId, withCost, withExp, byDay, catShare, payToday, debt, inv, lowStock, exp, expByCat, soldCostToday, stockInToday });
  }

  /** Kunlik tushum va foyda (TZ 9.9 revenue). */
  async revenue(user: AuthUser, branchId: string, q: Range) {
    const rows = await this.repo.revenueByDay(this.scope(user, branchId, q.branchId), q.from, q.to);
    return toRevenue(rows, user.permissions.includes('view_cost_price'));
  }

  /** Eng ko'p sotilgan / foydali mahsulotlar. */
  async productsReport(user: AuthUser, branchId: string, q: Range & { limit?: number }) {
    const rows = await this.repo.topProducts(this.scope(user, branchId, q.branchId), q.from, q.to, q.limit ?? 50);
    return toProductsReport(rows, user.permissions.includes('view_cost_price'));
  }

  cashiers(user: AuthUser, branchId: string, q: Range) {
    return this.repo.cashiers(this.scope(user, branchId, q.branchId), q.from, q.to);
  }

  /** Qarzdorlar va yoshi (aging): 0–30, 31–60, 61–90, 90+ kun muddat o'tgan. */
  async debts() {
    return toDebts(await this.repo.debtors(todayISO()));
  }

  paymentsReport(user: AuthUser, branchId: string, q: Range) {
    return this.repo.paymentsByMethod(this.scope(user, branchId, q.branchId), q.from, q.to);
  }

  /** Foyda va zarar (TZ 7.11): tushum, tannarx, yalpi foyda, xarajatlar kategoriya bo'yicha, sof foyda. */
  async profitLoss(user: AuthUser, branchId: string, q: Range) {
    const scId = this.scope(user, branchId, q.branchId);
    const [s, exp] = await Promise.all([this.repo.salesSummary(scId, q.from, q.to), this.repo.expensesByCategory(scId, q.from, q.to)]);
    return toProfitLoss(q, s, exp);
  }

  /** Kassa oqimi: kirim (to'lovlar usul bo'yicha) va chiqim (xarajatlar usul bo'yicha). */
  async cashFlow(user: AuthUser, branchId: string, q: Range) {
    const scId = this.scope(user, branchId, q.branchId);
    const [inflow, outflow] = await Promise.all([this.repo.paymentsByMethod(scId, q.from, q.to), this.repo.expensesByMethod(scId, q.from, q.to)]);
    return toCashFlow(inflow, outflow);
  }

  /** Kam qoldiq ro'yxati (frontend Bosh admin sahifasi `GET /branches/overview` da). `all` egasiga hammasi, filial xodimiga o'z filiallari. */
  async lowStockList(user: AuthUser, branchId: string, requested?: string) {
    const scId = this.scopeId(user, branchId, requested);
    return toLowStockList(await this.repo.lowStockAll(scId ?? (user.allBranches ? null : user.branchIds)));
  }
}
