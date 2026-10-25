import { Module } from '@nestjs/common';
import { ShiftsController } from './controllers/shifts.controller.js';
import { ShiftsService } from './services/shifts.service.js';

@Module({ controllers: [ShiftsController], providers: [ShiftsService], exports: [ShiftsService] })
export class ShiftsModule {}
