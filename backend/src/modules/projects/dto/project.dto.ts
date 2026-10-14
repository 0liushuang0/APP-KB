import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsString, IsOptional, IsEnum, IsArray, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

/** 日期字段空串按未填处理：前端表单没填日期时会发 ''，IsDateString 会拦成 400 */
const EmptyDateToUndefined = () =>
  Transform(({ value }) => (typeof value === 'string' && !value.trim() ? undefined : value));

export class CreateProjectDto {
  /** 项目编号由后端继承上游生成（PRJ-2026-007），前端可不传 */
  @IsOptional()
  @IsString()
  projectNo?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  requirementId?: string;

  @IsOptional()
  @IsString()
  proposalId?: string;

  @IsOptional()
  @IsString()
  quotationId?: string;

  /** 来源合同：立项以签约为前提，编号与客户优先从合同继承（CON-007 → PRJ-007） */
  @IsOptional()
  @IsString()
  contractId?: string;

  /** 项目类型：设备制造/安装调试/技改/服务 */
  @IsOptional()
  @IsString()
  projectType?: string;

  /** 流程阶段：由 PATCH /:id/stage 单独处理，但也允许 create/update 时传入 */
  @IsOptional()
  @IsString()
  dealStage?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  dealType?: 'new' | 'repeat' | 'expansion';

  @IsOptional()
  @EmptyDateToUndefined()
  @IsDateString()
  startDate?: Date;

  @IsOptional()
  @EmptyDateToUndefined()
  @IsDateString()
  endDate?: Date;

  @IsOptional()
  @IsString()
  managerId?: string;

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

  @IsOptional()
  @IsArray()
  stages?: CreateProjectStageDto[];

  @IsOptional()
  @IsArray()
  risks?: CreateProjectRiskDto[];
}

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
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

  /** 项目名称：主数据在需求上，这里收到后会写回那条需求 */
  @IsOptional()
  @IsString()
  projectName?: string;
}

export class CreateProjectStageDto {
  @IsString()
  name: string;

  @IsOptional()
  @EmptyDateToUndefined()
  @IsDateString()
  startDate?: Date;

  @IsOptional()
  @EmptyDateToUndefined()
  @IsDateString()
  endDate?: Date;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateProjectRiskDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  mitigation?: string;
}

export class QueryProjectDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
