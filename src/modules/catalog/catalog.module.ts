import { Module, forwardRef } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { CatalogController } from './controllers/catalog.controller.js';
import { CatalogService } from './services/catalog.service.js';

@Module({ imports: [forwardRef(() => InventoryModule)], controllers: [CatalogController], providers: [CatalogService], exports: [CatalogService] })
export class CatalogModule {}
