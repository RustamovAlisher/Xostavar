import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { BranchId, BranchScoped, CurrentUser, Perms, type AuthUser } from '../../../common/decorators/auth-context.js';
import { Idempotent } from '../../../common/interceptors/idempotency.interceptor.js';
import { PageQuery } from '../../../common/utils/pagination.js';
import { ShiftsService } from '../services/shifts.service.js';

class OpenShiftDto {
  @IsOptional() @IsInt() @Min(0) openingCash?: number;
}
class CloseShiftDto {
  @IsOptional() @IsInt() @Min(0) countedCash?: number;
  /** Boshqa xodimning ochiq smenasini yopish (faqat manage_users); berilmasa — o'zingizniki. */
  @IsOptional() @IsUUID() shiftId?: string;
}
class ShiftListQuery extends PageQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

@ApiTags('shifts')
@ApiBearerAuth()
@Controller('shifts')
@BranchScoped()
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get('current')
  @Perms('view_pos')
  async current(@CurrentUser() u: AuthUser, @BranchId() branchId: string) {
    const s = await this.shifts.current(branchId, u.id);
    return s ? { ...s, totals: await this.shifts.totals(s.id) } : null;
  }

  /** Filialdagi barcha ochiq smenalar: administrator unutilgan smenani yopadi. */
  @Get('open')
  @Perms('manage_users')
  openList(@BranchId() branchId: string) {
    return this.shifts.listOpen(branchId);
  }

  @Post('open')
  @Perms('view_pos')
  @Idempotent()
  open(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Body() dto: OpenShiftDto) {
    return this.shifts.open(u, branchId, dto.openingCash ?? 0);
  }

  @Post('close')
  @Perms('view_pos')
  @Idempotent()
  close(@CurrentUser() u: AuthUser, @BranchId() branchId: string, @Body() dto: CloseShiftDto) {
    return this.shifts.close(u, branchId, dto.countedCash, dto.shiftId);
  }

  @Get()
  @Perms('view_analytics')
  list(@BranchId() branchId: string, @Query() q: ShiftListQuery) {
    return this.shifts.list(branchId, q);
  }

  @Get(':id/report')
  @Perms('view_pos', 'view_analytics')
  report(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.shifts.report(id, u);
  }
}
