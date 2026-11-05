import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';

/** Ulangan chat sozlamalari (faqat yuborilgan maydonlar o'zgaradi). */
export class UpdateTelegramChatDto {
  @ApiPropertyOptional({ description: "Filiallar; null yoki bo'sh — barcha filiallar", type: [String], nullable: true })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true })
  branchIds?: string[] | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifySales?: boolean;
  @ApiPropertyOptional({ description: "Har sotuv xabari shu summadan (so'm) boshlab; 0 — hammasi" })
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000_000) minAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyVoids?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyDebts?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() dailyReport?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showProfit?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
