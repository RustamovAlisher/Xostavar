import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { PageQuery } from '../../../common/utils/pagination.js';

export class CustomerDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiPropertyOptional({ example: '+998 90 123-45-67' }) @IsString() @MaxLength(30) phone: string;
  @IsOptional() @IsUUID() groupId?: string | null;
  @IsOptional() @IsInt() @Min(0) creditLimit?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string | null;
  @IsOptional() @IsInt() version?: number;
}

export class DebtPaymentDto {
  @IsInt() @Min(1) amount: number;
  @IsUUID() methodId: string;
}

export class CustomerListQuery extends PageQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() overdue?: string;
  @IsOptional() @IsString() hasDebt?: string;
}
