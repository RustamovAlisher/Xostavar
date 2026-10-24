import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateBranchDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) receiptFooter?: string;
  @ApiPropertyOptional({ description: "Bo'sh bo'lsa nomdan yasaladi: CHILONZOR" })
  @IsOptional()
  @Matches(/^[A-Z0-9]{2,10}$/, { message: 'Kod 2–10 ta katta lotin harf yoki raqam' })
  code?: string;
}

export class UpdateBranchDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @IsOptional() @IsString() @MaxLength(500) receiptFooter?: string;
  @IsOptional() @IsInt() version?: number;
}
