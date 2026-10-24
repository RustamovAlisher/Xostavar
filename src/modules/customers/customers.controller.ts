import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchId, BranchScoped, CurrentUser, Perms, Req, requestIdOf, type AuthRequest, type AuthUser } from '../../common/auth-context.js';
import { Idempotent } from '../../common/idempotency.interceptor.js';
import { PageQuery } from '../../common/pagination.js';
import { SalesService } from '../sales/sales.service.js';
import { CustomerDto, CustomerListQuery, DebtPaymentDto } from './customers.dto.js';
import { CustomersService } from './customers.service.js';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly sales: SalesService,
  ) {}

  @Get()
  @Perms('view_debts', 'view_pos')
  list(@Query() q: CustomerListQuery) {
    return this.customers.list(q);
  }

  @Get(':id')
  @Perms('view_debts', 'view_pos')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.get(id);
  }

  @Get(':id/ledger')
  @Perms('view_debts')
  ledger(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery) {
    return this.customers.ledger(id, q);
  }

  /** Kassada tezkor qo'shish ham shu yerdan (TZ 9.8). */
  @Post()
  @Perms('view_pos', 'view_debts')
  create(@CurrentUser() u: AuthUser, @Body() dto: CustomerDto) {
    return this.customers.create(u, dto);
  }

  @Patch(':id')
  @Perms('give_debt', 'manage_users')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CustomerDto) {
    return this.customers.update(u, id, dto);
  }

  @Delete(':id')
  @Perms('manage_users')
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.remove(u, id);
  }

  /** Qarz to'lovi — filial kassasiga tushadi, `debt_payment` chek yoziladi (TZ 8.8). */
  @Post(':id/payments')
  @Perms('view_debts')
  @BranchScoped()
  @Idempotent()
  pay(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DebtPaymentDto) {
    return this.sales.debtPayment(u, branchId, id, dto, requestIdOf(req));
  }
}
