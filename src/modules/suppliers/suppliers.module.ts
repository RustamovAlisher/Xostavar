import { Module } from '@nestjs/common';
import { SuppliersController } from './controllers/suppliers.controller.js';
import { SuppliersRepository } from './repositories/suppliers.repository.js';
import { SuppliersService } from './services/suppliers.service.js';

@Module({ controllers: [SuppliersController], providers: [SuppliersService, SuppliersRepository], exports: [SuppliersService] })
export class SuppliersModule {}
