import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Matches, Max, Min } from 'class-validator';

/** Admin qo'lda kiritadigan kurs (Markaziy bank ishlamasa yoki do'kon o'z kursini qo'ysa). */
export class ManualRateDto {
  @ApiProperty({ example: 12750.5, description: "1 USD necha so'm" })
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(100) @Max(1_000_000)
  rate: number;
}

export class RateHistoryQuery {
  @ApiPropertyOptional({ default: 14 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

/** Brauzer cbu.uz dan olgan kurs (server chet elda bo'lsa cbu.uz unga yopiq). */
export class CbuReportDto {
  @ApiProperty({ example: 11935.37 }) @IsNumber({ maxDecimalPlaces: 4 }) @Min(100) @Max(1_000_000) rate: number;
  @ApiProperty({ example: '2026-11-05' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
}
