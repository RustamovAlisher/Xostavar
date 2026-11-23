import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchId, BranchScoped, CurrentUser, Perms, Req, requestIdOf, type AuthRequest, type AuthUser } from '../../../common/decorators/auth-context.js';
import { Idempotent } from '../../../common/interceptors/idempotency.interceptor.js';
import { PageQuery } from '../../../common/utils/pagination.js';
import { SalesService } from '../../sales/services/sales.service.js';
import { CustomerDeleteQuery, CustomerDto, CustomerListQuery, DebtPaymentDto, ManualDebtDto, SetDebtDto } from '../dto/customers.dto.js';
import { CustomersService } from '../services/customers.service.js';

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

  /** Mijoz kartasi: savdolar tarixi, har savdo bo'yicha qarz/to'lovlar, umumiy qarz. */
  @Get(':id/profile')
  @Perms('view_debts')
  profile(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.profile(id);
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

  /** O'chirish (yumshoq). Qarzi bor mijoz faqat `?writeOff=true` bilan: qarz avval hisobdan chiqariladi (jurnalga yoziladi). */
  @Delete(':id')
  @Perms('manage_users')
  @BranchScoped()
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: CustomerDeleteQuery) {
    return this.customers.remove(u, id, { branchId, writeOff: q.writeOff === 'true' });
  }

  /** Qarzni tahrirlash: mijoz qarzini yangi summaga o'rnatadi (farq `adjustment` bilan jurnalga yoziladi, kassaga tegmaydi). */
  @Put(':id/debt')
  @Perms('manage_users')
  @BranchScoped()
  setDebt(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetDebtDto) {
    return this.customers.setDebt(u, branchId, id, dto);
  }

  /** Qo'lda qarz qo'shish (savdosiz): kassaga tegmaydi, qarz jurnaliga `adjustment` yoziladi. */
  @Post(':id/debts')
  @Perms('give_debt')
  @BranchScoped()
  @Idempotent()
  addDebt(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ManualDebtDto) {
    return this.customers.addManualDebt(u, branchId, id, dto);
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
