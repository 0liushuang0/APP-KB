import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsString, IsOptional, IsEnum, IsArray, IsBoolean } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateProposalDto {
  /** 可省略：不传则由 NumberingService 按规则生成，并继承关联需求的流水号 */
  @IsOptional()
  @IsString()
  proposalNo?: string;

  /** 可省略：客户跟随关联需求，创建时自动带入 */
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  requirementId?: string;

  /** 已废弃：项目名称由关联需求提供，不再单独维护 */
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  productDescription?: string;

  @IsOptional()
  @IsString()
  proposalType?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  requirements?: string;

  @IsOptional()
  @IsBoolean()
  aiGenerated?: boolean;

  @IsOptional()
  @IsString()
  sourceProposalId?: string;

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

export class UpdateProposalDto extends PartialType(CreateProposalDto) {
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

export class GenerateProposalDto {
  @IsString()
  customerId: string;

  @IsOptional()
  @IsString()
  requirementId?: string;

  @IsString()
  title: string;

  @IsString()
  requirements: string;
}

export class QueryProposalDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  /** 按来源需求筛选，用于需求详情页的「关联方案」 */
  @IsOptional()
  @IsString()
  requirementId?: string;
}
