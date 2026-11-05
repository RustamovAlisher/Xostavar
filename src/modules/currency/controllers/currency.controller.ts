import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Perms, type AuthUser } from '../../../common/decorators/auth-context.js';
import { ManualRateDto, RateHistoryQuery } from '../dto/currency.dto.js';
import { CurrencyService } from '../services/currency.service.js';

@ApiTags('currency')
@ApiBearerAuth()
@Controller('currency/usd')
export class CurrencyController {
  constructor(private readonly currency: CurrencyService) {}

  /** Joriy kurs va avtomatik yangilanish holati — har bir tizimga kirgan xodim uchun. */
  @Get()
  current() {
    return this.currency.current();
  }

  @Get('history')
  history(@Query() q: RateHistoryQuery) {
    return this.currency.history(q.limit ?? 14);
  }

  /** Markaziy bankdan hozir tortish. */
  @Post('refresh')
  @HttpCode(200)
  @Perms('manage_settings')
  refresh(@CurrentUser() u: AuthUser) {
    return this.currency.refreshFromCbu(u);
  }

  /** Qo'lda kurs (keyingi avtomatik yangilanishgacha amal qiladi). */
  @Post()
  @HttpCode(200)
  @Perms('manage_settings')
  setManual(@CurrentUser() u: AuthUser, @Body() dto: ManualRateDto) {
    return this.currency.setManual(u, dto.rate);
  }
}
