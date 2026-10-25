import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BranchId, BranchScoped, CurrentUser, Perms, Req, type AuthRequest, type AuthUser } from '../../../common/decorators/auth-context.js';
import { BranchPriceDto, ProductDto, ProductListQuery } from '../dto/catalog.dto.js';
import { CatalogService } from '../services/catalog.service.js';
import { InventoryService } from '../../inventory/services/inventory.service.js';

/**
 * Katalog umumiy; qoldiq/tannarx javobda joriy filial bo'yicha (X-Branch-Id yoki standart filial).
 * Filial ko'rsatilmasa qoldiq 0 va inBranch=false qaytadi.
 */
@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryService,
  ) {}

  @Get()
  @Perms('view_inventory', 'view_pos', 'add_product', 'edit_product')
  list(@CurrentUser() u: AuthUser, @Req() req: AuthRequest, @Query() q: ProductListQuery) {
    return this.catalog.list(u, req.branchId ?? null, q);
  }

  @Get('lookup')
  @Perms('view_pos', 'view_inventory')
  lookup(@CurrentUser() u: AuthUser, @Req() req: AuthRequest, @Query('code') code: string) {
    return this.catalog.lookup(u, req.branchId ?? null, code ?? '');
  }

  @Get(':id')
  @Perms('view_inventory', 'view_pos', 'add_product', 'edit_product')
  get(@CurrentUser() u: AuthUser, @Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.get(u, req.branchId ?? null, id);
  }

  /** Kirim va audit tarixi (TZ 9.4); filial admini faqat o'z filiali yozuvlarini ko'radi. */
  @Get(':id/history')
  @Perms('view_inventory')
  history(@CurrentUser() u: AuthUser, @Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.productHistory(u, req.branchId ?? null, id);
  }

  @Post()
  @Perms('add_product')
  create(@CurrentUser() u: AuthUser, @Req() req: AuthRequest, @Body() dto: ProductDto) {
    return this.catalog.create(u, req.branchId ?? null, dto);
  }

  @Put(':id')
  @Perms('edit_product')
  update(@CurrentUser() u: AuthUser, @Req() req: AuthRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProductDto) {
    return this.catalog.update(u, req.branchId ?? null, id, dto);
  }

  /** Filial bo'yicha narx (TZ 7.3, 14.4 (2)) — faqat egasi (edit_product). */
  @Put(':id/branch-price')
  @Perms('edit_product')
  @BranchScoped()
  setBranchPrice(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BranchPriceDto) {
    return this.catalog.setBranchPrice(u, branchId, id, dto);
  }

  @Delete(':id/branch-price')
  @Perms('edit_product')
  @BranchScoped()
  clearBranchPrice(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Param('id', ParseUUIDPipe) id: string, @Query('variantId') variantId?: string) {
    return this.catalog.clearBranchPrice(u, branchId, id, variantId || undefined);
  }

  @Delete(':id')
  @Perms('delete_product')
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.remove(u, id);
  }
}
