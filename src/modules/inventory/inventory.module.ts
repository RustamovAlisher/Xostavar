import { Module, forwardRef } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { SuppliersModule } from '../suppliers/suppliers.module.js';
import { InventoryController } from './controllers/inventory.controller.js';
import { InventoryRepository } from './repositories/inventory.repository.js';
import { InventoryService } from './services/inventory.service.js';

@Module({ imports: [forwardRef(() => CatalogModule), SuppliersModule], controllers: [InventoryController], providers: [InventoryService, InventoryRepository], exports: [InventoryService] })
export class InventoryModule {}
