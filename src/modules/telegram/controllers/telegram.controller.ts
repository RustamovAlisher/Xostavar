import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Perms, type AuthUser } from '../../../common/decorators/auth-context.js';
import { UpdateTelegramChatDto } from '../dto/telegram.dto.js';
import { TelegramService } from '../services/telegram.service.js';

/** Savdo boti sozlamalari (faqat admin). */
@ApiTags('telegram')
@ApiBearerAuth()
@Controller('telegram')
@Perms('manage_settings')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Get()
  status() {
    return this.telegram.status();
  }

  /** Chat ulash uchun bir martalik kod (15 daqiqa). */
  @Post('link-code')
  @HttpCode(200)
  linkCode(@CurrentUser() u: AuthUser) {
    return this.telegram.createLinkCode(u);
  }

  @Patch('chats/:id')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTelegramChatDto) {
    return this.telegram.updateChat(u, id, dto);
  }

  @Delete('chats/:id')
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.telegram.removeChat(u, id);
  }

  @Post('chats/:id/test')
  @HttpCode(200)
  test(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.telegram.sendTest(u, id);
  }
}
