import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { PageQuery } from '../../common/pagination.js';

export class CutDto {
  @IsNumber() @Min(0.01) lengthMeters: number;
  @IsInt() @Min(1) quantity: number;
}

export class SaleLineDto {
  @IsUUID() productId: string;
  @IsOptional() @IsUUID() variantId?: string;
  @Matches(/^[a-z0-9_]{1,20}$/) unit: string;
  @IsNumber() @Min(0) qty: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => CutDto) cuts?: CutDto[];
}

export class SalePaymentDto {
  @IsUUID() methodId: string;
  @IsInt() @Min(1) amount: number;
  @IsOptional() @IsString() @MaxLength(100) ref?: string;
}

/** POST /sales/quote va POST /sales (TZ 9.6). Server narxga ishonmaydi: faqat mahsulot, birlik, miqdor, kesim. */
export class SaleDto {
  @ApiPropertyOptional({ description: 'Oflayn yaratilgan chek id (takror yuborishdan himoya)' }) @IsOptional() @IsUUID() clientId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => SaleLineDto) lines: SaleLineDto[];
  @IsOptional() @IsInt() @Min(0) discountAmount?: number;
  @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional({ description: "To'lov qismlari (aralash to'lov). Bo'sh bo'lsa + onCredit — to'liq nasiya" })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SalePaymentDto)
  payments?: SalePaymentDto[];
  @ApiPropertyOptional({ description: "Yetmagan summa mijoz nasiyasiga yoziladi (customerId majburiy)" }) @IsOptional() @IsBoolean() onCredit?: boolean;
}

export class VoidSaleDto {
  @IsString() @MaxLength(300) reason: string;
}

export class SalesListQuery extends PageQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsUUID() cashierId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() shiftId?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() q?: string;
}
