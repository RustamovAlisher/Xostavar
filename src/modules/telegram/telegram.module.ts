import { Global, Module } from '@nestjs/common';
import { TelegramController } from './controllers/telegram.controller.js';
import { TelegramRepository } from './repositories/telegram.repository.js';
import { NotifyService } from './services/notify.service.js';
import { NotifyWorker } from './services/notify.worker.js';
import { SalesReportService } from './services/sales-report.service.js';
import { TelegramBotService } from './services/telegram-bot.service.js';
import { TelegramClient } from './services/telegram.client.js';
import { TelegramService } from './services/telegram.service.js';

/** Global: kassa (sotuv, bekor, qarz to'lovi) `NotifyService` orqali hodisani navbatga yozadi. */
@Global()
@Module({
  controllers: [TelegramController],
  providers: [TelegramClient, TelegramRepository, NotifyService, SalesReportService, TelegramBotService, NotifyWorker, TelegramService],
  exports: [NotifyService],
})
export class TelegramModule {}
