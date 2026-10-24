import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchId, BranchScoped, CurrentUser, Perms, Req, requestIdOf, type AuthRequest, type AuthUser } from '../../common/auth-context.js';
import { Idempotent } from '../../common/idempotency.interceptor.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { MovementsQuery, StockAdjustDto, StockInDto, StockInListQuery, StockLevelPatchDto } from './inventory.dto.js';
import { InventoryService } from './inventory.service.js';
import { ProductListQuery } from '../catalog/catalog.dto.js';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller()
@BranchScoped()
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly catalog: CatalogService,
  ) {}

  /** Joriy filial ombori: faqat stock_levels qatori bor mahsulotlar (TZ 7.0.1). `?productId=&branchId=all` — bitta mahsulot barcha filiallarda. */
  @Get('stock-levels')
  @Perms('view_inventory', 'view_pos')
  levels(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Query() q: ProductListQuery & { productId?: string; branchId?: string }) {
    if (q.productId && q.branchId === 'all') return this.inventory.levelsAcrossBranches(u, q.productId);
    return this.catalog.list(u, branchId, { ...q, inBranch: 'true' } as ProductListQuery);
  }

  @Patch('stock-levels/:id')
  @Perms('edit_product', 'stock_in')
  patchLevel(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StockLevelPatchDto) {
    return this.inventory.patchLevel(u, branchId, id, dto);
  }

  @Post('stock-in')
  @Perms('stock_in')
  @Idempotent()
  stockIn(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Req() req: AuthRequest, @Body() dto: StockInDto) {
    return this.inventory.stockIn(u, branchId, dto, requestIdOf(req));
  }

  @Get('stock-in')
  @Perms('view_inventory')
  receipts(@BranchId() branchId: string, @Query() q: StockInListQuery) {
    return this.inventory.listReceipts(branchId, q);
  }

  @Get('stock-in/:id')
  @Perms('view_inventory')
  receipt(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.getReceipt(id);
  }

  @Get('stock-movements')
  @Perms('view_inventory')
  movements(@BranchId() branchId: string, @Query() q: MovementsQuery) {
    return this.inventory.movements(branchId, q.productId, q.variantId, q);
  }

  @Post('stock-adjustments')
  @Perms('edit_product')
  @Idempotent()
  adjust(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Req() req: AuthRequest, @Body() dto: StockAdjustDto) {
    return this.inventory.adjust(u, branchId, dto, requestIdOf(req));
  }
}
