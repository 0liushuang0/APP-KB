import { IsString, IsOptional, IsArray } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateSolutionDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  productId?: string;

  /** 方案类型：standard / optional / custom_template */
  @IsOptional()
  @IsString()
  solutionType?: string;

  /** 目录路径（斜杠分层），如 普碳钢/酸洗线 */
  @IsOptional()
  @IsString()
  directory?: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** 适用场景 */
  @IsOptional()
  @IsString()
  scenario?: string;

  /** 关键参数标签（JSON 字符串） */
  @IsOptional()
  @IsString()
  keyParams?: string;

  /** 适用参数摘要 */
  @IsOptional()
  @IsString()
  paramSummary?: string;

  /** 参考价格区间 */
  @IsOptional()
  @IsString()
  priceRange?: string;

  /** 典型交付周期 */
  @IsOptional()
  @IsString()
  deliveryCycle?: string;

  @IsOptional()
  @IsString()
  cadTemplateUrl?: string;

  @IsOptional()
  @IsString()
  agreementTemplateUrl?: string;

  @IsOptional()
  @IsString()
  quotationTemplate?: string;

  @IsOptional()
  @IsString()
  defaultConfig?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsString()
  category?: string;

  /** 状态：draft / published / disabled */
  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateSolutionDto extends PartialType(CreateSolutionDto) {}

export class CreateConfigOptionDto {
  @IsString()
  solutionId: string;

  @IsString()
  key: string;

  @IsString()
  label: string;

  @IsOptional()
  @IsString()
  choices?: string;

  @IsOptional()
  @IsString()
  constraintRules?: string;

  @IsOptional()
  sortOrder?: number;
}

export class CreatePriceTableDto {
  @IsOptional()
  @IsString()
  solutionId?: string;

  @IsString()
  optionKey: string;

  @IsString()
  optionValue: string;

  @IsOptional()
  priceDelta?: number;

  @IsOptional()
  cost?: number;

  @IsOptional()
  @IsString()
  leadTime?: string;

  @IsOptional()
  @IsString()
  supplyLevel?: string;
}

export class CalculatePriceDto {
  @IsString()
  solutionId: string;

  @IsOptional()
  config?: string;

  @IsOptional()
  discount?: number;
}

/** 批量移动/重命名目录节点：把 from 前缀改成 to */
export class MoveDirectoryDto {
  @IsString()
  from: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class QuerySolutionDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  productId?: string;
}
