import { Module } from '@nestjs/common';
import { BranchesController } from './controllers/branches.controller.js';
import { BranchesRepository } from './repositories/branches.repository.js';
import { BranchesService } from './services/branches.service.js';

@Module({ controllers: [BranchesController], providers: [BranchesService, BranchesRepository], exports: [BranchesService] })
export class BranchesModule {}
