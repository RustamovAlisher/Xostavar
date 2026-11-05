import { Global, Module } from '@nestjs/common';
import { CurrencyController } from './controllers/currency.controller.js';
import { CurrencyRepository } from './repositories/currency.repository.js';
import { CbuClient } from './services/cbu.client.js';
import { CurrencyScheduler } from './services/currency.scheduler.js';
import { CurrencyService } from './services/currency.service.js';

/** Global: katalog (dollar narx) va kassa (dollar to'lov) joriy kursni shu yerdan oladi. */
@Global()
@Module({ controllers: [CurrencyController], providers: [CurrencyService, CurrencyRepository, CbuClient, CurrencyScheduler], exports: [CurrencyService] })
export class CurrencyModule {}
