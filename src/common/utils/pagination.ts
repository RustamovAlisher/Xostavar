import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** TZ 5: ?page=1&pageSize=50 → { items, total, page, pageSize }. */
export class PageQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 50, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize = 50;

  @ApiPropertyOptional({ description: 'Masalan -createdAt' })
  @IsOptional()
  @IsString()
  sort?: string;

  get offset() {
    return (this.page - 1) * this.pageSize;
  }
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const page = <T>(items: T[], total: number, q: Pick<PageQuery, 'page' | 'pageSize'>): Page<T> => ({
  items,
  total,
  page: q.page,
  pageSize: q.pageSize,
});
