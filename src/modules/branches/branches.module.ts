import { Module } from '@nestjs/common';
import { BranchesController } from './controllers/branches.controller.js';
import { BranchesService } from './services/branches.service.js';

@Module({ controllers: [BranchesController], providers: [BranchesService], exports: [BranchesService] })
export class BranchesModule {}
