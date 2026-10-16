import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsNumber,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  SupplierOrigin,
  SupplierTier,
  CooperationLevel,
  Currency,
  PriceSource,
} from '../entities/supplier.entity';
import { PartialType } from '@nestjs/mapped-types';

export class CreateSupplierCapabilityDto {
  @IsString()
  capability: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateSupplierDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['domestic', 'overseas'] as const)
  origin?: SupplierOrigin;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsEnum(['tier1', 'tier2', 'tier3'] as const)
  tier?: SupplierTier;

  @IsOptional()
  @IsArray()
  productCategories?: string[];

  @IsOptional()
  @IsArray()
  qualification?: string[];

  @IsOptional()
  @IsEnum(['strategic', 'qualified', 'candidate', 'blacklist'] as const)
  cooperationLevel?: CooperationLevel;

  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @IsOptional()
  @IsDateString()
  firstCooperationAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  onTimeRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  qualifiedRate?: number;

  @IsOptional()
  @IsString()
  rating?: string;

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
  capabilities?: CreateSupplierCapabilityDto[];
}

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}

export class QuerySupplierDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  origin?: SupplierOrigin;

  @IsOptional()
  @IsString()
  tier?: SupplierTier;

  /** 逗号分隔多选 */
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  cooperationLevel?: string;

  @IsOptional()
  @IsString()
  rating?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateSupplierProductDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsString()
  productName: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  specification?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  materialId?: string;

  /** 对应的我方产品 id；传空串表示取消映射 */
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  specs?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  priceMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  priceMax?: number;

  @IsOptional()
  @IsEnum(['CNY', 'USD', 'EUR'] as const)
  currency?: Currency;

  @IsOptional()
  @IsDateString()
  priceDate?: string;

  @IsOptional()
  @IsEnum(['quote', 'contract', 'estimate'] as const)
  priceSource?: PriceSource;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  deliveryDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  moq?: number;

  @IsOptional()
  @IsBoolean()
  isSubstitutable?: boolean;

  @IsOptional()
  @IsString()
  substituteFor?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateSupplierProductDto extends PartialType(CreateSupplierProductDto) {
  @IsOptional()
  @IsString()
  productName: string;

  /** 状态：停用某条目录项时用。新建时由服务端给默认值 */
  @IsOptional()
  @IsString()
  status?: string;
}

export class QuerySupplierProductDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  /** 只看映射到该我方产品的供应产品 */
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  priceMax?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  deliveryDaysMax?: number;
}

export class CreateSupplierQuoteDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  quantity?: number;

  @Type(() => Number)
  @IsNumber()
  unitPrice: number;

  @IsOptional()
  @IsEnum(['CNY', 'USD', 'EUR'] as const)
  currency?: Currency;

  @IsOptional()
  @IsDateString()
  quotedAt?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsString()
  quotationId?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class CompareSupplierDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  materialId?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  origin?: SupplierOrigin;

  @IsOptional()
  @IsString()
  tier?: SupplierTier;
}
