import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { BranchId, BranchScoped, CurrentUser, Perms, PermsAll, type AuthUser } from '../../../common/decorators/auth-context.js';
import { addDays, todayISO } from '../../../common/utils/numbers.js';
import { ReportsService } from '../services/reports.service.js';

class RangeQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}
class DashboardQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @IsString() branchId?: string;
}

const range = (q: RangeQuery) => ({ from: q.from ?? addDays(todayISO(), -29), to: q.to ?? todayISO(), branchId: q.branchId, limit: q.limit });

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
