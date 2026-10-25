import { Module } from '@nestjs/common';
import { ReportsController } from './controllers/reports.controller.js';
import { ReportsRepository } from './repositories/reports.repository.js';
import { ReportsService } from './services/reports.service.js';

@Module({ controllers: [ReportsController], providers: [ReportsService, ReportsRepository] })
export class ReportsModule {}
