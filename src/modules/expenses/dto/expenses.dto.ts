import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { PageQuery } from '../../../common/utils/pagination.js';

export class ExpenseDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
  @IsUUID() categoryId: string;
  @IsInt() @Min(1) amount: number;
  @IsUUID() methodId: string;
  @IsIn(['cash_register', 'other']) source: 'cash_register' | 'other';
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class ExpensePatchDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class ExpenseListQuery extends PageQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsIn(['cash_register', 'other']) source?: 'cash_register' | 'other';
  @IsOptional() @IsString() branchId?: string;
}
