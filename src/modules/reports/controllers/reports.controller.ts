import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { BranchId, BranchScoped, CurrentUser, Perms, PermsAll, type AuthUser } from '../../../common/decorators/auth-context.js';
import { addDays, todayISO } from '../../../common/utils/numbers.js';
import { periodStart } from '../mappers/reports.mapper.js';
import { ReportsService } from '../services/reports.service.js';

class RangeQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}
class PeriodsQuery extends RangeQuery {
  @IsOptional() @IsIn(['week', 'month', 'year']) granularity?: 'week' | 'month' | 'year';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) top?: number;
}
class DashboardQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @IsString() branchId?: string;
}

const range = (q: RangeQuery) => ({ from: q.from ?? addDays(todayISO(), -29), to: q.to ?? todayISO(), branchId: q.branchId, limit: q.limit });
/** Davr hisobotining standart oralig'i: oxirgi 12 hafta, 12 oy yoki 5 yil (bugungi davr bilan). */
const periodRange = (q: PeriodsQuery) => {
  const g = q.granularity ?? 'month';
  const today = todayISO();
  const d = new Date(today + 'T00:00:00Z');
  let def: string;
  if (g === 'week') def = periodStart(addDays(today, -77), 'week');
  else if (g === 'month') { d.setUTCMonth(d.getUTCMonth() - 11, 1); def = d.toISOString().slice(0, 10); }
  else def = `${d.getUTCFullYear() - 4}-01-01`;
  return { from: q.from ?? def, to: q.to ?? today, branchId: q.branchId, granularity: g, top: q.top };
};

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
@BranchScoped()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  @Perms('view_analytics')
  dashboard(@CurrentUser() u: AuthUser, @BranchId() b: string, @Query() q: DashboardQuery) {
    return this.reports.dashboard(u, b, q.branchId, q.date);
  }

  @Get('revenue')
  @Perms('view_analytics')
  revenue(@CurrentUser() u: AuthUser, @BranchId() b: string, @Query() q: RangeQuery) {
    return this.reports.revenue(u, b, range(q));
  }

  @Get('products')
  @Perms('view_analytics')
  products(@CurrentUser() u: AuthUser, @BranchId() b: string, @Query() q: RangeQuery) {
    return this.reports.productsReport(u, b, range(q));
  }

  @Get('cashiers')
  @Perms('view_analytics')
  cashiers(@CurrentUser() u: AuthUser, @BranchId() b: string, @Query() q: RangeQuery) {
    return this.reports.cashiers(u, b, range(q));
  }

  @Get('payments')
  @Perms('view_analytics')
  payments(@CurrentUser() u: AuthUser, @BranchId() b: string, @Query() q: RangeQuery) {
    return this.reports.paymentsReport(u, b, range(q));
  }

  @Get('debts')
  @Perms('view_analytics', 'view_debts')
  debts() {
    return this.reports.debts();
  }

  /** Davrlar dinamikasi: ?granularity=week|month|year&from&to&branchId. */
  @Get('periods')
  @Perms('view_analytics')
  periods(@CurrentUser() u: AuthUser, @BranchId() b: string, @Query() q: PeriodsQuery) {
    return this.reports.periods(u, b, periodRange(q));
  }

  /** Qarzlar sahifasi: holat, aging, dinamika, eng katta qarzdorlar. */
  @Get('debts/overview')
  @Perms('view_analytics', 'view_debts')
  debtsOverview(@CurrentUser() u: AuthUser, @BranchId() b: string, @Query() q: PeriodsQuery) {
    return this.reports.debtsOverview(u, b, periodRange(q));
  }

  @Get('low-stock')
  @Perms('view_analytics', 'view_inventory')
  lowStock(@CurrentUser() u: AuthUser, @BranchId() b: string, @Query() q: RangeQuery) {
    return this.reports.lowStockList(u, b, q.branchId);
  }

  /** TZ 9.12: view_expenses + view_cost_price. */
  @Get('profit-loss')
  @PermsAll('view_expenses', 'view_cost_price')
  profitLoss(@CurrentUser() u: AuthUser, @BranchId() b: string, @Query() q: RangeQuery) {
    return this.reports.profitLoss(u, b, range(q));
  }

  @Get('cash-flow')
  @Perms('view_expenses')
  cashFlow(@CurrentUser() u: AuthUser, @BranchId() b: string, @Query() q: RangeQuery) {
    return this.reports.cashFlow(u, b, range(q));
  }
}
