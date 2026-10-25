import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { PageQuery } from '../../../common/utils/pagination.js';

export class StockInLineDto {
  @IsUUID() productId: string;
  @IsOptional() @IsUUID() variantId?: string;
  @Matches(/^[a-z0-9_]{1,20}$/) unit: string;
  @IsNumber() @Min(0.0001) qty: number;
  @ApiPropertyOptional({ description: "Shu birlik uchun tannarx, so'm. 0 = o'rtacha tannarx o'zgarmaydi" }) @IsOptional() @IsInt() @Min(0) costPerUnit?: number;
  @ApiPropertyOptional({ description: 'Yangi sotish narxi (edit_product kerak)' }) @IsOptional() @IsInt() @Min(0) newRetailPrice?: number;
}

export class StockInDto {
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() @MaxLength(120) supplierName?: string;
  @IsOptional() @IsString() @MaxLength(60) invoice?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => StockInLineDto) lines: StockInLineDto[];
}

export class StockAdjustDto {
  @IsUUID() productId: string;
  @IsOptional() @IsUUID() variantId?: string;
  @ValidateIf((o) => o.delta == null) @IsNumber() @Min(0) newStock?: number;
  @ValidateIf((o) => o.newStock == null) @IsNumber() delta?: number;
  @IsString() @MaxLength(300) reason: string;
}

export class StockLevelPatchDto {
  @IsOptional() @IsNumber() @Min(0) minStock?: number | null;
  @IsOptional() @IsNumber() @Min(0) costPrice?: number | null;
}

export class StockInListQuery extends PageQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsUUID() productId?: string;
}

export class MovementsQuery extends PageQuery {
  @IsUUID() productId: string;
  @IsOptional() @IsUUID() variantId?: string;
}
