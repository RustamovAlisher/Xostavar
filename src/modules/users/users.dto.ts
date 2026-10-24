import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PERMISSIONS, type Permission } from '../../common/permissions.js';

const USERNAME = /^[a-z0-9._-]{3,40}$/i;

export class CreateUserDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @Matches(USERNAME, { message: 'Login kamida 3 ta lotin harf/raqam (., _, -)' }) username: string;
  @ValidateIf((o) => o.email) @IsEmail({}, { message: "Email noto'g'ri" }) @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsUUID() roleId: string;
  @ApiPropertyOptional({ description: "Bo'sh bo'lsa rol shablonidan olinadi", enum: PERMISSIONS, isArray: true })
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(PERMISSIONS, { each: true })
  permissions?: Permission[];
  @IsOptional() @IsBoolean() active?: boolean;
  @IsString() @MinLength(8) @MaxLength(200) password: string;
  @ApiPropertyOptional({ description: 'Filial admini uchun e\'tiborsiz (o\'z filiali)' })
  @IsOptional() @IsArray() @IsUUID('4', { each: true })
  branchIds?: string[];
  @IsOptional() @IsUUID() defaultBranchId?: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @Matches(USERNAME, { message: 'Login kamida 3 ta lotin harf/raqam (., _, -)' }) username?: string;
  @IsOptional() @ValidateIf((o) => o.email) @IsEmail({}, { message: "Email noto'g'ri" }) @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsUUID() roleId?: string;
  @ApiPropertyOptional({ description: 'Rol o\'zgarganda huquqlarni yangi rol shabloniga moslash' })
  @IsOptional() @IsBoolean() resetPermissionsToRole?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(200) password?: string;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) branchIds?: string[];
  @IsOptional() @IsUUID() defaultBranchId?: string;
  @IsOptional() @IsInt() version?: number;
}

export class SetPermissionsDto {
  @IsArray() @ArrayUnique() @IsIn(PERMISSIONS, { each: true }) permissions: Permission[];
}

export class SetBranchesDto {
  @IsArray() @IsUUID('4', { each: true }) branchIds: string[];
  @IsOptional() @IsUUID() defaultBranchId?: string;
}

export class ResetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(200) password: string;
}

export class RoleDto {
  @IsString() @MinLength(1) @MaxLength(60) name: string;
  @IsArray() @ArrayUnique() @IsIn(PERMISSIONS, { each: true }) permissions: Permission[];
  @IsOptional() @IsBoolean() allBranches?: boolean;
  @IsOptional() @IsInt() version?: number;
}
