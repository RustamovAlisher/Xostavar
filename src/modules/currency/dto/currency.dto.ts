import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/** Admin qo'lda kiritadigan kurs (Markaziy bank ishlamasa yoki do'kon o'z kursini qo'ysa). */
export class ManualRateDto {
  @ApiProperty({ example: 12750.5, description: "1 USD necha so'm" })
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(100) @Max(1_000_000)
  rate: number;
}

export class RateHistoryQuery {
  @ApiPropertyOptional({ default: 14 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}
