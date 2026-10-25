import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Perms, type AuthUser } from '../../../common/decorators/auth-context.js';
import { SettingsBundleDto } from '../dto/settings.dto.js';
import { SettingsService } from '../services/settings.service.js';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Barcha lug'atlar bir javobda (frontend `AppSettings`). */
  @Get()
  getAll() {
    return this.settings.getAll();
  }

  @Put()
  @Perms('manage_settings')
  saveAll(@CurrentUser() u: AuthUser, @Body() dto: SettingsBundleDto) {
    return this.settings.saveAll(u, dto);
  }

  @Post('reset')
  @Perms('manage_settings')
  reset(@CurrentUser() u: AuthUser) {
    return this.settings.reset(u);
  }
}
