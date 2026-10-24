import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Perms, type AuthUser } from '../../common/auth-context.js';
import { CreateBranchDto, UpdateBranchDto } from './branches.dto.js';
import { BranchesService } from './branches.service.js';

@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.branches.listFor(user);
  }

  /** Bosh admin sahifasi. Ombor qiymati faqat `view_cost_price` bilan. */
  @Get('overview')
  @Perms('manage_branches')
  overview(@CurrentUser() user: AuthUser) {
    return this.branches.overview(user.permissions.includes('view_cost_price'));
  }

  @Post()
  @Perms('manage_branches')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBranchDto) {
    return this.branches.create(user, dto);
  }

  @Patch(':id')
  @Perms('manage_branches')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(user, id, dto);
  }

  @Post(':id/deactivate')
  @Perms('manage_branches')
  deactivate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.branches.setActive(user, id, false);
  }

  @Post(':id/activate')
  @Perms('manage_branches')
  activate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.branches.setActive(user, id, true);
  }
}
