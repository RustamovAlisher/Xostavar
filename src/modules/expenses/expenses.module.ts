import { Module } from '@nestjs/common';
import { ShiftsModule } from '../shifts/shifts.module.js';
import { ExpensesController } from './controllers/expenses.controller.js';
import { ExpensesRepository } from './repositories/expenses.repository.js';
import { ExpensesService } from './services/expenses.service.js';

@Module({ imports: [ShiftsModule], controllers: [ExpensesController], providers: [ExpensesService, ExpensesRepository], exports: [ExpensesService] })
export class ExpensesModule {}
