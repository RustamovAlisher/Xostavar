import { Module, forwardRef } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ShiftsModule } from '../shifts/shifts.module.js';
import { SalesController } from './controllers/sales.controller.js';
import { SalesService } from './services/sales.service.js';

@Module({ imports: [InventoryModule, ShiftsModule, forwardRef(() => CustomersModule)], controllers: [SalesController], providers: [SalesService], exports: [SalesService] })
export class SalesModule {}
