import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public, Req, requestIdOf, type AuthRequest, type AuthUser } from '../../common/auth-context.js';
import { ShiftsService } from '../shifts/shifts.service.js';
import { ChangePasswordDto, LoginDto, RefreshDto } from './auth.dto.js';
import { AuthService } from './auth.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly shifts: ShiftsService,
  ) {}

  private meta(req: AuthRequest) {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: requestIdOf(req) };
  }

  /** TZ 6.1. Login 10/daqiqa/IP. */
  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: LoginDto, @Req() req: AuthRequest) {
    return this.auth.login(dto.login, dto.password, this.meta(req));
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body() dto: RefreshDto, @Req() req: AuthRequest) {
    return this.auth.refresh(dto.refreshToken, this.meta(req));
  }

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(204)
  async logout(@Req() req: AuthRequest) {
    await this.auth.logout(req.sessionId!);
  }

  @Post('logout-all')
  @ApiBearerAuth()
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.auth.logoutAll(user.id);
  }

  /** Joriy foydalanuvchi, huquqlar, filiallar va tanlangan filialdagi smena holati (TZ 9.1). */
  @Get('me')
  @ApiBearerAuth()
  async me(@CurrentUser() user: AuthUser, @Req() req: AuthRequest) {
    const branchId = (req.headers['x-branch-id'] as string | undefined) || user.defaultBranchId;
    const shift = branchId && (user.allBranches || user.branchIds.includes(branchId)) ? await this.shifts.current(branchId) : null;
    return { user, shift };
  }

  @Post('change-password')
  @ApiBearerAuth()
  @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: AuthRequest) {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword, req.sessionId!);
  }

  @Get('sessions')
  @ApiBearerAuth()
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user.id);
  }

  @Delete('sessions/:id')
  @ApiBearerAuth()
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.auth.revokeSession(user.id, id);
  }
}
