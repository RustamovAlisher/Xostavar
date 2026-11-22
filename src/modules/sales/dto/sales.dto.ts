import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PageQuery } from '../../../common/utils/pagination.js';

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
  @ApiPropertyOptional({ description: "Kassir o'zgartirgan narx (shu birlik uchun, so'm). Katalog narxi o'zgarmaydi" })
  @IsOptional() @IsInt() @Min(1) unitPrice?: number;
  @ApiPropertyOptional({ description: "Kassir o'zgartirgan qator summasi (so'm). Berilsa unitPrice dan ustun" })
  @IsOptional() @IsInt() @Min(1) lineTotal?: number;
}

export class SalePaymentDto {
  @IsUUID() methodId: string;
  @IsInt() @Min(1) amount: number;
  @ApiPropertyOptional({ description: "Dollar bilan to'langan bo'lsa — dollar summasi; `amount` uning so'mdagi qiymati (joriy kurs bo'yicha)" })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amountUsd?: number;
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
  @IsString() @MinLength(1) @MaxLength(300) reason: string;
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
  @ApiPropertyOptional({ description: "To'lov turi bo'yicha: usul kodi (cash, card, transfer, …) yoki 'debt' — nasiyali sotuvlar" })
  @IsOptional() @IsString() @MaxLength(40) method?: string;
}

/** POST /sales/own-use: kassadagi savat o'zimga olinadi (sotuv emas, pul olinmaydi). */
export class OwnUseDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => SaleLineDto) lines: SaleLineDto[];
  @ApiPropertyOptional({ description: "Izoh (ixtiyoriy): masalan «uy uchun»" }) @IsOptional() @IsString() @MaxLength(200) note?: string;
}

/** GET /sales/own-use: «O'zimga olingan» yozuvlar ro'yxati (davr bo'yicha). */
export class OwnUseListQuery {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsUUID() userId?: string;
}
