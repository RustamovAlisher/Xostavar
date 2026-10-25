import { Module, forwardRef } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module.js';
import { CustomersController } from './controllers/customers.controller.js';
import { CustomersService } from './services/customers.service.js';

@Module({ imports: [forwardRef(() => SalesModule)], controllers: [CustomersController], providers: [CustomersService], exports: [CustomersService] })
export class CustomersModule {}
