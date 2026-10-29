import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class StoreSettingsDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(200) subtitle?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsString() @MaxLength(50) taxId?: string;
  @IsOptional() @IsString() @MaxLength(500) receiptFooter?: string;
  @IsOptional() @IsIn(['thermal', 'a4']) printFormat?: 'thermal' | 'a4';
  @IsOptional() @IsIn([58, 80]) paperWidthMm?: 58 | 80;
}

export class BusinessRulesDto {
  @IsNumber() @Min(0.001) pieceLengthMeters: number;
  @IsNumber() @Min(0.001) defaultCutLengthMeters: number;
  @IsIn(['net', 'bars']) cutDeductionMode: 'net' | 'bars';
  @IsNumber() @Min(0) defaultMinStock: number;
  @IsInt() @Min(0) defaultCreditDays: number;
  @IsInt() @Min(0) defaultCreditLimit: number;
  @IsNumber() @Min(0) @Max(100) vatPct: number;
  @IsNumber() @Min(0) @Max(100) estimatedMarginPct: number;
  @IsArray() @ArrayMaxSize(6) @IsInt({ each: true }) @Min(1, { each: true }) @Max(99, { each: true }) quickDownPaymentPcts: number[];
  @IsBoolean() allowNegativeStock: boolean;
  @IsBoolean() requireShift: boolean;
  @IsInt() @Min(0) cashierMaxDiscount: number;
}

export class UnitDto {
  @Matches(/^[a-z0-9_]{1,20}$/, { message: 'Birlik kodi: kichik lotin harf, raqam, _' }) id: string;
  @IsString() @MinLength(1) @MaxLength(50) name: string;
  @IsString() @MinLength(1) @MaxLength(15) short: string;
  @IsInt() @Min(0) @Max(3) precision: number;
}

export class ConversionTemplateDto {
  @IsString() unit: string;
  @IsNumber() @Min(0.000001) factor: number;
}

export class CategoryDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsString() defaultBaseUnit: string;
  @IsOptional() @IsBoolean() defaultIsDivisible?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ConversionTemplateDto) defaultConversions?: ConversionTemplateDto[];
}

export class SizePresetDto {
  @IsOptional() @IsUUID() id?: string;
  @IsUUID() categoryId: string;
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsOptional() @IsNumber() @Min(0.000001) kgPerMeter?: number | null;
}

export class NamedDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MinLength(1) @MaxLength(80) name: string;
}

export class SupplierDto extends NamedDto {
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class PaymentMethodDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MinLength(1) @MaxLength(60) label: string;
  @IsIn(['cash', 'card', 'transfer', 'other', 'debt']) kind: 'cash' | 'card' | 'transfer' | 'other' | 'debt';
  @IsBoolean() enabled: boolean;
  @IsOptional() @IsString() @MaxLength(40) icon?: string | null;
}

export class ExpenseCategoryDto extends NamedDto {
  @IsOptional() @IsBoolean() active?: boolean;
}

/** PUT /settings — frontend "Saqlash" tugmasi: butun to'plam bitta tranzaksiyada (TZ 9.3). */
export class SettingsBundleDto {
  @ValidateNested() @Type(() => StoreSettingsDto) store: StoreSettingsDto;
  @ValidateNested() @Type(() => BusinessRulesDto) rules: BusinessRulesDto;
  @IsArray() @ValidateNested({ each: true }) @Type(() => UnitDto) units: UnitDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => CategoryDto) categories: CategoryDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => SizePresetDto) sizePresets: SizePresetDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => NamedDto) customerGroups: NamedDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentMethodDto) paymentMethods: PaymentMethodDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => SupplierDto) suppliers: SupplierDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => ExpenseCategoryDto) expenseCategories: ExpenseCategoryDto[];
}
