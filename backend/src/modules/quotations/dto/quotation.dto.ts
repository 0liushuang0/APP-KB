import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsString, IsOptional, IsEnum, IsArray, IsNumber } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateQuotationDto {
  @IsString()
  quotationNo: string;

  @IsString()
  customerId: string;

  @IsOptional()
  @IsString()
  proposalId?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  /** 币种 CNY / USD / EUR */
  @IsOptional()
  @IsEnum(['CNY', 'USD', 'EUR'] as const)
  currency?: 'CNY' | 'USD' | 'EUR';

  /** 1 单据币种 = x 人民币（外币报价必填，人民币忽略） */
  @IsOptional()
  @IsNumber()
  exchangeRate?: number;

  /** 报价单语言 zh / en */
  @IsOptional()
  @IsEnum(['zh', 'en'] as const)
  language?: 'zh' | 'en';

  /** 报价日期 YYYY-MM-DD（业务发生日，不填按创建日） */
  @IsOptional()
  @IsString()
  quotedAt?: string;

  @IsOptional()
  @IsString()
  costBreakdown?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsNumber()
  deliveryDays?: number;

  @IsOptional()
  @IsNumber()
  warrantyMonths?: number;

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

  @IsOptional()
  @IsArray()
  items?: CreateQuotationItemDto[];
}

export class UpdateQuotationDto extends PartialType(CreateQuotationDto) {
  /**
   * 状态。
   *
   * 只允许流转非审批态（草稿/已发送/赢单/输单）：
   * approved / pending 属于审批结果，只能走 /approve 与"修改后重新送审"，
   * 在 update 里直接传这两个值会被服务端拒绝 —— 防止单据管理者
   * 绕过审批把自己写的报价直接置为已审核。
   */
  @IsOptional()
  @IsEnum(['draft', 'sent', 'won', 'lost'] as const)
  status?: 'draft' | 'sent' | 'won' | 'lost';

  /**
   * 乐观锁版本号：客户端提交时带上读取时的 version。
   * 与服务器当前值不一致会返回 409，防止两人同时编辑时后保存者
   * 静默覆盖先保存者的修改。
   */
  @IsOptional()
  @IsNumber()
  version?: number;

  /** 项目名称：主数据在需求上，这里收到后会写回那条需求 */
  @IsOptional()
  @IsString()
  projectName?: string;
}

export class CreateQuotationItemDto {
  /** 关联的自有产品；从产品库选择时带上，手工录入可留空 */
  @IsOptional()
  @IsString()
  productId?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  specification?: string;

  @IsOptional()
  @IsString()
  nameEn?: string;

  @IsOptional()
  @IsString()
  specificationEn?: string;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsNumber()
  unitPrice?: number;

  @IsOptional()
  @IsNumber()
  totalPrice?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  /** 引用的供应产品，用于回溯这一行的价格来自哪家供应商 */
  @IsOptional()
  @IsString()
  supplierProductId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  supplierName?: string;

  @IsOptional()
  @IsNumber()
  cost?: number;

  @IsOptional()
  @IsString()
  costSource?: string;

  @IsOptional()
  @IsNumber()
  deliveryDays?: number;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class SuggestQuotationDto {
  @IsString()
  customerId: string;

  @IsString()
  requirements: string;
}

export class QueryQuotationDto extends PaginationQueryDto {
  /** owner=me：只看我负责的（工作台「我的今天」按人直达时带上） */
  @IsOptional()
  @IsString()
  owner?: string;

  /** 工作台「我的今天」直达筛选（见各 service 的 focus 分支） */
  @IsOptional()
  @IsString()
  focus?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  status?: string;

  /** 客户筛选；'none' 表示未关联客户的报价 */
  @IsOptional()
  @IsString()
  customerId?: string;
}
