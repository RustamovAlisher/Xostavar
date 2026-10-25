import { Module, forwardRef } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { InventoryController } from './controllers/inventory.controller.js';
import { InventoryService } from './services/inventory.service.js';

@Module({ imports: [forwardRef(() => CatalogModule)], controllers: [InventoryController], providers: [InventoryService], exports: [InventoryService] })
export class InventoryModule {}
