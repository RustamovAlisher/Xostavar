import { Module } from '@nestjs/common';
import { ReportsController } from './controllers/reports.controller.js';
import { ReportsService } from './services/reports.service.js';

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
