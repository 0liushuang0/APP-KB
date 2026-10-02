import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { PartialType, OmitType } from '@nestjs/mapped-types';

export class CreateCustomerDto {
  @IsString()
  name: string;

  @IsOptional() @IsString()
  code?: string;

  @IsOptional() @IsString()
  customerCode?: string;

  @IsOptional() @IsString()
  industry?: string;

  @IsOptional() @IsString()
  scale?: string;

  /** 客户等级 A/B/C/D */
  @IsOptional() @IsString()
  level?: string;

  /** 业务状态 活跃/沉默/流失 */
  @IsOptional() @IsString()
  businessStatus?: string;

  @IsOptional() @IsString()
  customerType?: string;

  /** 所属区域 */
  @IsOptional() @IsString()
  region?: string;

  @IsOptional() @IsString()
  address?: string;

  /** 统一社会信用代码 */
  @IsOptional() @IsString()
  creditCode?: string;

  @IsOptional() @IsString()
  website?: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString()
  salesPerson?: string;

  @IsOptional() @IsString()
  ownerId?: string;

  @IsOptional() @IsString()
  departmentId?: string;

  @IsOptional()
  firstCooperationDate?: string;

  @IsOptional() @IsArray()
  tags?: string[];

  @IsOptional() @IsEnum(['public', 'department', 'group', 'role', 'private'] as const)
  visibility?: 'public' | 'department' | 'group' | 'role' | 'private';

  @IsOptional() @IsArray()
  groupIds?: string[];

  @IsOptional() @IsArray()
  roleCodes?: string[];
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsDateString()
  lastDealDate?: string;

  @IsOptional()
  totalDealAmount?: number;
}

export class CreateContactPersonDto {
  @IsString()
  customerId: string;

  @IsString()
  name: string;

  @IsOptional() @IsString()
  title?: string;

  @IsOptional() @IsString()
  department?: string;

  @IsOptional() @IsString()
  phone?: string;

  @IsOptional() @IsString()
  email?: string;

  @IsOptional() @IsString()
  fax?: string;

  @IsOptional() @IsString()
  wechat?: string;

  @IsOptional() @IsString()
  otherContact?: string;

  @IsOptional() @IsString()
  decisionRole?: string;

  @IsOptional() @IsBoolean()
  isPrimary?: boolean;

  @IsOptional() @IsDateString()
  birthday?: string;

  @IsOptional() @IsString()
  remark?: string;
}

/**
 * 修改联系人。
 *
 * 用 OmitType 去掉 customerId：联系人不能改挂到别的客户名下 ——
 * 真要换客户应该是"在原客户下删除、在新客户下新增"两步，
 * 否则权限校验（按 customerId 查客户再判 canAccess）会被绕过。
 */
export class UpdateContactPersonDto extends PartialType(
  OmitType(CreateContactPersonDto, ['customerId'] as const),
) {}

export class CreateFollowUpDto {
  @IsString()
  customerId: string;

  @IsString()
  content: string;

  @IsOptional()
  followUpAt?: Date;

  @IsOptional() @IsString()
  method?: string;

  @IsOptional() @IsString()
  participants?: string;

  @IsOptional() @IsString()
  customerParticipants?: string;

  @IsOptional() @IsString()
  focusPoints?: string;

  @IsOptional() @IsString()
  nextAction?: string;

  @IsOptional() @IsDateString()
  deadline?: string;

  @IsOptional() @IsString()
  requirementId?: string;
}

export class QueryCustomerDto extends PaginationQueryDto {
  @IsOptional() @IsString()
  keyword?: string;

  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString()
  level?: string;

  @IsOptional() @IsString()
  businessStatus?: string;

  @IsOptional() @IsString()
  industry?: string;

  @IsOptional() @IsString()
  region?: string;

  @IsOptional() @IsString()
  customerType?: string;
}
