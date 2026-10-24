import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchId, BranchScoped, CurrentUser, Perms, Req, requestIdOf, type AuthRequest, type AuthUser } from '../../common/auth-context.js';
import { Idempotent } from '../../common/idempotency.interceptor.js';
import { SaleDto, SalesListQuery, VoidSaleDto } from './sales.dto.js';
import { SalesService } from './sales.service.js';

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales')
@BranchScoped()
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  /** Savatni hisoblab beradi, saqlamaydi (TZ 9.6). */
  @Post('quote')
  @Perms('view_pos')
  @HttpCode(200)
  quote(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Body() dto: SaleDto) {
    return this.sales.quote(u, branchId, dto);
  }

  @Post()
  @Perms('view_pos')
  @Idempotent()
  create(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Req() req: AuthRequest, @Body() dto: SaleDto) {
    return this.sales.create(u, branchId, dto, requestIdOf(req));
  }

  @Get()
  @Perms('view_pos')
  list(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Query() q: SalesListQuery) {
    return this.sales.list(u, branchId, q);
  }

  @Get(':id')
  @Perms('view_pos', 'view_analytics')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.get(u, id, true);
  }

  /** Storno (TZ 7.9): administrator, sabab bilan. */
  @Post(':id/void')
  @Perms('manage_users')
  @Idempotent()
  void(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidSaleDto) {
    return this.sales.void(u, branchId, id, dto.reason, requestIdOf(req));
  }
}
