import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsString, IsOptional, IsNumber, IsDateString, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

export class CreateContractDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  quotationId?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsDateString()
  signedDate?: string;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  /** 交货期（合同约定的交货日期） */
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsDateString()
  deliveryDate?: string | null;

  /** 质保期（月）：从报价带过来；签约/生效时据此算质保到期日 */
  @IsOptional()
  @IsNumber()
  warrantyMonths?: number;

  @IsOptional()
  @IsString()
  deliveryTerms?: string;
}

export class UpdateContractDto extends PartialType(CreateContractDto) {
  /**
   * 状态：只允许业务流转态。
   * pending / approved 是审批结果，只能由审批路径产生 ——
   * 否则单据管理者可以绕过审批，把合同直接改成"内部已批准"。
   */
  @IsOptional()
  @IsEnum(['draft', 'signed', 'executing', 'completed', 'terminated'] as const)
  status?: 'draft' | 'signed' | 'executing' | 'completed' | 'terminated';
}

export class QueryContractDto extends PaginationQueryDto {
  /** 工作台「我的今天」直达筛选（见各 service 的 focus 分支） */
  @IsOptional()
  @IsString()
  focus?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}
