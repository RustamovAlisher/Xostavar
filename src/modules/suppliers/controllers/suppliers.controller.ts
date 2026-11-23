import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchId, BranchScoped, CurrentUser, Perms, type AuthUser } from '../../../common/decorators/auth-context.js';
import { Idempotent } from '../../../common/interceptors/idempotency.interceptor.js';
import { SupplierDto, SupplierListQuery, SupplierManualDebtDto, SupplierPaymentDto, SupplierSetDebtDto } from '../dto/suppliers.dto.js';
import { SuppliersService } from '../services/suppliers.service.js';

/** Yetkazib beruvchilar va ularga qarzimiz. Ko'rish — `view_expenses`, o'zgartirish — `manage_expenses`. */
@ApiTags('suppliers')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @Perms('view_expenses')
  list(@Query() q: SupplierListQuery) {
    return this.suppliers.list(q);
  }

  /** Karta: kirimlar (tovar, miqdor, summa, to'langan, qolgan qarz) va to'lovlar jurnali. */
  @Get(':id')
  @Perms('view_expenses')
  profile(@Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.profile(id);
  }

  @Post()
  @Perms('manage_expenses')
  @Idempotent()
  create(@CurrentUser() u: AuthUser, @Body() dto: SupplierDto) {
    return this.suppliers.create(u, dto);
  }

  @Patch(':id')
  @Perms('manage_expenses')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupplierDto) {
    return this.suppliers.update(u, id, dto);
  }

  /** Faqat qarzi va qarz yozuvlari yo'q yetkazib beruvchi o'chadi; kirimlarida nomi qoladi. */
  @Delete(':id')
  @Perms('manage_expenses')
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.suppliers.remove(u, id);
  }

  @Post(':id/payments')
  @Perms('manage_expenses')
  @BranchScoped()
  @Idempotent()
  pay(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupplierPaymentDto) {
    return this.suppliers.pay(u, branchId, id, dto);
  }

  @Post(':id/debts')
  @Perms('manage_expenses')
  @BranchScoped()
  @Idempotent()
  addDebt(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupplierManualDebtDto) {
    return this.suppliers.addDebt(u, branchId, id, dto);
  }

  @Put(':id/debt')
  @Perms('manage_expenses')
  @BranchScoped()
  setDebt(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupplierSetDebtDto) {
    return this.suppliers.setDebt(u, branchId, id, dto);
  }
}
