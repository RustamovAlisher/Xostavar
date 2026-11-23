import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';

export class SupplierDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(300) note?: string | null;
}

/** Yetkazib beruvchiga to'lov: qarz kamayadi. */
export class SupplierPaymentDto {
  @ApiProperty({ description: "To'langan summa, so'm (qarzdan katta bo'lmasin)" }) @IsInt() @Min(1) amount: number;
  @ApiPropertyOptional({ description: "To'lov usuli (naqd, karta, o'tkazma…)" }) @IsOptional() @IsUUID() methodId?: string;
  @ApiPropertyOptional({ description: "To'lov sanasi (berilmasa — bugun)" }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

/** Qo'lda qarz qo'shish (kirimsiz: eski daftar, kelishuv): qarz oshadi. */
export class SupplierManualDebtDto {
  @IsInt() @Min(1) amount: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

/** Umumiy qarzni yangi summaga o'rnatish (tuzatish). */
export class SupplierSetDebtDto {
  @ApiProperty({ description: "Yangi umumiy qarz, so'm (0 — qarz yopiladi)" }) @IsInt() @Min(0) amount: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class SupplierListQuery {
  @IsOptional() @IsString() q?: string;
  /** 'true' — faqat qarzi borlar. */
  @IsOptional() @IsString() debtOnly?: string;
}
