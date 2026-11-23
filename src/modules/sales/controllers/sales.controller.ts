import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchId, BranchScoped, CurrentUser, Perms, Req, requestIdOf, type AuthRequest, type AuthUser } from '../../../common/decorators/auth-context.js';
import { Idempotent } from '../../../common/interceptors/idempotency.interceptor.js';
import { EditSaleLineDto, OwnUseDto, OwnUseListQuery, RemoveSaleLineDto, SaleDto, SalesListQuery, VoidSaleDto } from '../dto/sales.dto.js';
import { SalesService } from '../services/sales.service.js';

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

  /** Kassadan «O'zimga»: mollar ombordan chiqariladi va xarajatga yoziladi (sotuv emas). */
  @Post('own-use')
  @Perms('view_pos')
  @Idempotent()
  ownUse(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Req() req: AuthRequest, @Body() dto: OwnUseDto) {
    return this.sales.ownUse(u, branchId, dto, requestIdOf(req));
  }

  /** «O'zimga olish»ni bekor qilish: qoldiq qaytadi. */
  @Post('own-use/:id/void')
  @Perms('view_pos', 'manage_expenses')
  @Idempotent()
  ownUseVoid(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.ownUseVoid(u, branchId, id, requestIdOf(req));
  }

  @Get()
  @Perms('view_pos')
  list(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Query() q: SalesListQuery) {
    return this.sales.list(u, branchId, q);
  }

  /** «O'zimga olingan» yozuvlar ro'yxati (Sotuvlar sahifasidagi «O'zimga» bo'limi). `:id` dan oldin turishi shart. */
  @Get('own-use')
  @Perms('view_pos')
  ownUseList(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Query() q: OwnUseListQuery) {
    return this.sales.ownUseList(u, branchId, q);
  }

  /** Kategoriyalar mashhurligi (kassa chiplari tartibi). `:id` dan oldin turishi shart. */
  @Get('category-rank')
  @Perms('view_pos')
  categoryRank(@BranchId() branchId: string) {
    return this.sales.categoryRank(branchId);
  }

  @Get(':id')
  @Perms('view_pos', 'view_analytics')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.sales.get(u, id, true);
  }

  /** Storno (TZ 7.9): `void_sale` huquqi, sabab bilan. */
  @Post(':id/void')
  @Perms('void_sale')
  @Idempotent()
  void(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidSaleDto) {
    return this.sales.void(u, branchId, id, dto.reason, requestIdOf(req));
  }

  /** Nasiya chekdan bitta mahsulotni olib tashlash: qoldiq qaytadi, chek summasi va mijoz qarzi shuncha kamayadi. */
  @Post(':id/lines/:lineId/remove')
  @Perms('void_sale')
  @Idempotent()
  removeLine(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Param('lineId', ParseUUIDPipe) lineId: string, @Body() dto: RemoveSaleLineDto) {
    return this.sales.removeLine(u, branchId, id, lineId, dto.reason?.trim() || '', requestIdOf(req));
  }

  /** Nasiya chekdagi mahsulotni tahrirlash (miqdor/narx): qoldiq farqi ombordan chiqadi yoki qaytadi, chek summasi va mijoz qarzi farqcha o'zgaradi. */
  @Patch(':id/lines/:lineId')
  @Perms('void_sale')
  editLine(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Param('lineId', ParseUUIDPipe) lineId: string, @Body() dto: EditSaleLineDto) {
    return this.sales.editLine(u, branchId, id, lineId, dto, requestIdOf(req));
  }
}
