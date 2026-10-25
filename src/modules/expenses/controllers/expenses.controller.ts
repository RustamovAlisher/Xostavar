import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchId, BranchScoped, CurrentUser, Perms, Req, requestIdOf, type AuthRequest, type AuthUser } from '../../../common/decorators/auth-context.js';
import { Idempotent } from '../../../common/interceptors/idempotency.interceptor.js';
import { ExpenseDto, ExpenseListQuery, ExpensePatchDto } from '../dto/expenses.dto.js';
import { ExpensesService } from '../services/expenses.service.js';

@ApiTags('expenses')
@ApiBearerAuth()
@Controller('expenses')
@BranchScoped()
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @Perms('view_expenses')
  list(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Query() q: ExpenseListQuery) {
    return this.expenses.list(u, branchId, q);
  }

  @Post()
  @Perms('manage_expenses')
  @Idempotent()
  create(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Req() req: AuthRequest, @Body() dto: ExpenseDto) {
    return this.expenses.create(u, branchId, dto, requestIdOf(req));
  }

  @Patch(':id')
  @Perms('manage_expenses')
  patch(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExpensePatchDto) {
    return this.expenses.patch(u, branchId, id, dto);
  }

  @Post(':id/void')
  @Perms('manage_expenses')
  @Idempotent()
  void(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.void(u, branchId, id, requestIdOf(req));
  }
}
