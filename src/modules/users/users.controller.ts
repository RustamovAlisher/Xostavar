import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Perms, type AuthUser } from '../../common/auth-context.js';
import { CreateUserDto, ResetPasswordDto, RoleDto, SetBranchesDto, SetPermissionsDto, UpdateUserDto } from './users.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  @Perms('view_users', 'manage_users')
  list(@CurrentUser() u: AuthUser) {
    return this.users.list(u);
  }

  @Get('users/:id')
  @Perms('view_users', 'manage_users')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(u, id);
  }

  @Post('users')
  @Perms('manage_users')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateUserDto) {
    return this.users.create(u, dto);
  }

  @Patch('users/:id')
  @Perms('manage_users')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(u, id, dto);
  }

  @Put('users/:id/permissions')
  @Perms('manage_users')
  setPermissions(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPermissionsDto) {
    return this.users.setPermissions(u, id, dto);
  }

  @Put('users/:id/branches')
  @Perms('manage_users')
  setBranches(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetBranchesDto) {
    return this.users.setBranches(u, id, dto);
  }

  @Post('users/:id/toggle-active')
  @Perms('manage_users')
  toggle(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.toggleActive(u, id);
  }

  @Post('users/:id/reset-password')
  @Perms('manage_users')
  @HttpCode(204)
  resetPassword(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto) {
    return this.users.resetPassword(u, id, dto);
  }

  @Delete('users/:id')
  @Perms('manage_users')
  @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.remove(u, id);
  }

  /* Rollar */

  @Get('roles')
  @Perms('view_users', 'manage_users', 'manage_settings')
  roles() {
    return this.users.listRoles();
  }

  @Post('roles')
  @Perms('manage_settings')
  createRole(@CurrentUser() u: AuthUser, @Body() dto: RoleDto) {
    return this.users.createRole(u, dto);
  }

  @Patch('roles/:id')
  @Perms('manage_settings')
  updateRole(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoleDto) {
    return this.users.updateRole(u, id, dto);
  }

  @Delete('roles/:id')
  @Perms('manage_settings')
  @HttpCode(204)
  deleteRole(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.deleteRole(u, id);
  }
}
