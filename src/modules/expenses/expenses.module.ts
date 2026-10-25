import { Module } from '@nestjs/common';
import { ShiftsModule } from '../shifts/shifts.module.js';
import { ExpensesController } from './controllers/expenses.controller.js';
import { ExpensesService } from './services/expenses.service.js';

@Module({ imports: [ShiftsModule], controllers: [ExpensesController], providers: [ExpensesService], exports: [ExpensesService] })
export class ExpensesModule {}
