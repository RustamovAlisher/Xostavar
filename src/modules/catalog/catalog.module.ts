import { Module, forwardRef } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { CatalogController } from './controllers/catalog.controller.js';
import { CatalogRepository } from './repositories/catalog.repository.js';
import { CatalogService } from './services/catalog.service.js';
import { ProductImageService } from './services/product-image.service.js';

@Module({ imports: [forwardRef(() => InventoryModule)], controllers: [CatalogController], providers: [CatalogService, CatalogRepository, ProductImageService], exports: [CatalogService] })
export class CatalogModule {}
