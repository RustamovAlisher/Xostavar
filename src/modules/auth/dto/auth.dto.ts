import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin' }) @IsString() @MaxLength(100) login: string;
  @ApiProperty({ example: '1234' }) @IsString() @MaxLength(200) password: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @MaxLength(200) refreshToken: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MaxLength(200) currentPassword: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(200) newPassword: string;
}
