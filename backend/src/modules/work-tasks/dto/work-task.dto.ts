import { IsOptional, IsString, IsNumber } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class QueryWorkTaskDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  status?: string;

  /** 工作日期起（YYYY-MM-DD，含） */
  @IsOptional()
  @IsString()
  dateFrom?: string;

  /** 工作日期止（YYYY-MM-DD，含） */
  @IsOptional()
  @IsString()
  dateTo?: string;

  /** 客户筛选；'none' 表示未关联客户 */
  @IsOptional()
  @IsString()
  customerId?: string;
}

export class CreateWorkTaskDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  category?: string;

  /**
   * 日期列不收空串：PG 的 date 类型收到 '' 会直接报错
   * （新建客户 Internal server error 的同款坑），前端清空传 null。
   */
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  workDate?: string | null;

  /** 开始时间 */
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  startDate?: string | null;

  /** 截止时间 */
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  dueDate?: string | null;

  /** 所属项目（关联项目跟踪的 id，可空） */
  @IsOptional()
  @IsString()
  projectId?: string | null;

  /** 所属项目名（手写兜底；与项目跟踪重名时服务端自动回填 projectId） */
  @IsOptional()
  @IsString()
  projectName?: string | null;

  /** 所属客户（关联客户中心的 id，可空） */
  @IsOptional()
  @IsString()
  customerId?: string | null;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  sourcePerson?: string;

  @IsOptional()
  @IsString()
  deliverTo?: string;

  @IsOptional()
  @IsNumber()
  spentHours?: number;
}

/** 全字段可选的更新 DTO；日期空串转 null 表示清空 */
export class UpdateWorkTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  workDate?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  startDate?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  dueDate?: string | null;

  @IsOptional()
  @IsString()
  projectId?: string | null;

  @IsOptional()
  @IsString()
  projectName?: string | null;

  @IsOptional()
  @IsString()
  customerId?: string | null;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  sourcePerson?: string;

  @IsOptional()
  @IsString()
  deliverTo?: string;

  @IsOptional()
  @IsNumber()
  spentHours?: number;
}
