import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PageQuery } from '../../common/pagination.js';

export class ConversionDto {
  @Matches(/^[a-z0-9_]{1,20}$/) unit: string;
  @IsNumber() @Min(0.000001) factor: number;
  @IsOptional() @IsInt() @Min(0) price?: number | null;
  @IsOptional() @IsString() @MaxLength(64) barcode?: string | null;
}

export class VariantDto {
  @ApiPropertyOptional({ description: "Bo'sh bo'lsa yangi variant" }) @IsOptional() @IsUUID() id?: string;
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(60) sku?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) barcodes?: string[];
  @IsInt() @Min(0) retailPrice: number;
  @IsOptional() @IsInt() @Min(0) wholesalePrice?: number | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ConversionDto) conversions?: ConversionDto[];
}

export class ProductDto {
  @IsString() @MinLength(1) @MaxLength(200) name: string;
  @IsUUID() categoryId: string;
  @ApiPropertyOptional({ description: "Bo'sh bo'lsa avtomatik yasaladi" }) @IsOptional() @IsString() @MaxLength(60) sku?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) barcodes?: string[];
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @Matches(/^[a-z0-9_]{1,20}$/) baseUnit: string;
  @IsBoolean() isDivisible: boolean;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ConversionDto) conversions: ConversionDto[];
  @ApiPropertyOptional({ description: 'Variantsiz mahsulot narxi; 0 = sotilmaydi' }) @IsOptional() @IsInt() @Min(0) retailPrice?: number;
  @IsOptional() @IsInt() @Min(0) wholesalePrice?: number | null;
  @IsBoolean() isVariable: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => VariantDto) variants?: VariantDto[];
  @ApiPropertyOptional({ description: 'Joriy filial uchun kam qoldiq chegarasi (stock_levels)' }) @IsOptional() @IsNumber() @Min(0) minStock?: number | null;
  @ApiPropertyOptional({ description: 'Joriy filial uchun tannarx (faqat view_cost_price)' }) @IsOptional() @IsNumber() @Min(0) costPrice?: number | null;
  @IsOptional() @IsInt() version?: number;
}

export class ProductListQuery extends PageQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ description: 'Faqat joriy filial omboridagilar' }) @IsOptional() @IsString() inBranch?: string;
  @IsOptional() @IsString() lowStock?: string;
}
