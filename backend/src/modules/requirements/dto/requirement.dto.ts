import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsString, IsOptional, IsEnum, IsArray, IsBoolean, IsNumber, IsInt, IsDateString, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

export class CreateRequirementDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  /** 需求来源 */
  @IsOptional()
  @IsString()
  category?: string;

  /** 需求类型：新设备采购/技改升级/备件需求/咨询服务 */
  @IsOptional()
  @IsString()
  requirementType?: string;

  /** 产品类型（决定参数模板） */
  @IsOptional()
  @IsString()
  templateCategory?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  // ── 商机管理（销售过程）字段 ──
  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedAmount?: number;

  @IsOptional()
  @IsDateString()
  expectedDealDate?: string;

  /** 赢单概率 0-100 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  winProbability?: number;

  @IsOptional()
  @IsDateString()
  nextFollowUpDate?: string;

  @IsOptional()
  @IsString()
  lossReason?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsEnum(['public', 'department', 'group', 'role', 'private'] as const)
  visibility?: 'public' | 'department' | 'group' | 'role' | 'private';

  @IsOptional()
  @IsArray()
  groupIds?: string[];

  @IsOptional()
  @IsArray()
  roleCodes?: string[];
}

export class UpdateRequirementDto extends PartialType(CreateRequirementDto) {
  /**
   * 状态。
   *
   * 它只能出现在 Update 上：新建时的初始状态由服务端根据审批开关决定，
   * 不该由前端指定。之前四个模块都漏了这个字段，
   * forbidNonWhitelisted 下改状态一律报「property status should not exist」。
   */
  @IsOptional()
  @IsString()
  status?: string;
}

export class QueryRequirementDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  /** 传 true 时把历史版本一并返回；默认只返回当前版本 */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeHistory?: boolean;
}

export class CreateRequirementVersionDto {
  @IsString()
  changeReason: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;
}

/** 一条需求变更快照项：改了哪个字段、从什么改成什么 */
export class RequirementChangeItemDto {
  @IsString()
  field: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

/** 新增一条需求记录（沟通 / 变更 / 确认） */
export class AddRequirementLogDto {
  @IsOptional()
  @IsEnum(['communication', 'change', 'confirm', 'other'] as const)
  type?: 'communication' | 'change' | 'confirm' | 'other';

  @IsString()
  content: string;

  /** 变更明细（选填）：仅「变更」类型需要留痕时带上 */
  @IsOptional()
  @IsArray()
  changes?: RequirementChangeItemDto[];
}
