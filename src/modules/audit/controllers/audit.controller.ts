import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CurrentUser, Perms, type AuthUser } from '../../../common/decorators/auth-context.js';
import { PageQuery } from '../../../common/utils/pagination.js';
import { AuditService } from '../services/audit.service.js';

class AuditListQuery extends PageQuery {
  @IsOptional() @IsString() module?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** TZ 9.10. Filial admini faqat o'z filiali yozuvlarini oladi (serverda majburlanadi). */
  @Get()
  @Perms('view_audit_logs')
  list(@CurrentUser() user: AuthUser, @Query() q: AuditListQuery) {
    return this.audit.list(user, q);
  }
}
