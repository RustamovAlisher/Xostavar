import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
import { PageQuery } from '../../../common/utils/pagination.js';

export class CustomerDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiPropertyOptional({ example: '+998 90 123-45-67', description: "Ixtiyoriy: bo'sh yoki berilmasa telefonsiz mijoz" }) @IsOptional() @IsString() @MaxLength(30) phone?: string | null;
  @IsOptional() @IsUUID() groupId?: string | null;
  @IsOptional() @IsInt() @Min(0) creditLimit?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string | null;
  @IsOptional() @IsInt() version?: number;
}

/** Qo'lda qarz qo'shish (eski daftardan, savdosiz): mijoz qarzi oshadi, `adjustment` yozuvi ochiladi. */
export class ManualDebtDto {
  @IsInt() @Min(1) amount: number;
  @ApiPropertyOptional({ description: "Izoh: qarz nima uchun (masalan, eski daftardan)" }) @IsOptional() @IsString() @MaxLength(200) note?: string;
  @ApiPropertyOptional({ description: "To'lov muddati (berilmasa mavjud muddat saqlanadi)" }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string | null;
}

export class DebtPaymentDto {
  @IsInt() @Min(1) amount: number;
  @IsUUID() methodId: string;
  /** Qaysi nasiya savdo uchun (ixtiyoriy). Berilmasa — eng eski qarzdan (FIFO). */
  @IsOptional() @IsUUID() saleId?: string;
}

export class CustomerListQuery extends PageQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() overdue?: string;
  @IsOptional() @IsString() hasDebt?: string;
}
