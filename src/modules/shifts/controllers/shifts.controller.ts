import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { BranchId, BranchScoped, CurrentUser, Perms, type AuthUser } from '../../../common/decorators/auth-context.js';
import { Idempotent } from '../../../common/interceptors/idempotency.interceptor.js';
import { PageQuery } from '../../../common/utils/pagination.js';
import { ShiftsService } from '../services/shifts.service.js';

class OpenShiftDto {
  @IsOptional() @IsInt() @Min(0) openingCash?: number;
}
class CloseShiftDto {
  @IsOptional() @IsInt() @Min(0) countedCash?: number;
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
  async current(@BranchId() branchId: string) {
    const s = await this.shifts.current(branchId);
    return s ? { ...s, totals: await this.shifts.totals(s.id) } : null;
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
    return this.shifts.close(u, branchId, dto.countedCash);
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
