import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsString, IsOptional, IsEnum, IsArray, IsNumber } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

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
  boms?: CreateProductBomDto[];

  /** 型号价格表：系列下各型号的多档价格，整体覆盖式保存 */
  @IsOptional()
  @IsArray()
  priceList?: ProductPriceItemDto[];

  /** 技术参数：参数名/参数值列表，整体覆盖式保存 */
  @IsOptional()
  @IsArray()
  specs?: ProductSpecItemDto[];
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class CreateProductBomDto {
  @IsString()
  materialName: string;

  @IsOptional()
  @IsString()
  specification?: string;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  cost?: number;
}

export class QueryProductDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  category?: string;
}

export class ProductPriceItemDto {
  @IsString()
  model: string;

  @IsOptional()
  @IsString()
  spec?: string;

  @IsOptional()
  @IsNumber()
  costPrice?: number;

  @IsOptional()
  @IsNumber()
  referencePrice?: number;

  @IsOptional()
  @IsNumber()
  standardPrice?: number;

  @IsOptional()
  @IsNumber()
  salePrice?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsString()
  updatedAt?: string;
}

export class ProductSpecItemDto {
  @IsString()
  name: string;

  @IsString()
  value: string;
}
