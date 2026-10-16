import { IsOptional, IsInt, Min, Max, IsIn, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { SelectQueryBuilder } from 'typeorm';

/** 列表接口统一的分页 / 排序入参 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /**
   * 上限 200：单机场景偶尔要一次导出较多数据，但不能无上限，
   * 否则等于回到"整表返回"的老问题。
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  sortOrder?: 'ASC' | 'DESC' | 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;

/**
 * 执行分页查询。
 *
 * @param qb           已经拼好 where 与 join 的查询构建器
 * @param alias        主表别名，用于拼排序列
 * @param query        分页入参
 * @param sortWhitelist 允许排序的列名白名单 —— sortBy 直接来自 URL，
 *                      不做白名单就是 SQL 注入面
 * @param defaultSort  默认排序（用户没点表头时生效）：业务单据列表
 *                     传编号升序（REQ-26-001 → REQ-26-010），
 *                     对账/找单按编号走比按创建时间直观；不传则沿用白名单首列 DESC
 */
export async function paginate<T extends object>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  query: PaginationQueryDto,
  sortWhitelist: string[] = ['createdAt'],
  defaultSort?: { field: string; order: 'ASC' | 'DESC' },
): Promise<PaginatedResult<T>> {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize || DEFAULT_PAGE_SIZE));

  const sortBy =
    query.sortBy && sortWhitelist.includes(query.sortBy)
      ? query.sortBy
      : defaultSort && sortWhitelist.includes(defaultSort.field)
        ? defaultSort.field
        : sortWhitelist[0];
  const sortOrder =
    (query.sortOrder || (defaultSort && sortBy === defaultSort.field ? defaultSort.order : 'DESC') || 'DESC')
      .toUpperCase() === 'ASC'
      ? 'ASC'
      : 'DESC';

  qb.orderBy(`${alias}.${sortBy}`, sortOrder as 'ASC' | 'DESC')
    .skip((page - 1) * pageSize)
    .take(pageSize);

  const [list, total] = await qb.getManyAndCount();

  return {
    list,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
