import { IsString, IsOptional, IsEnum, IsArray } from 'class-validator';
import { DocumentVisibility } from '../entities/document.entity';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateDocumentDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(['public', 'department', 'group', 'role', 'private'] as const)
  visibility?: DocumentVisibility;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsArray()
  groupIds?: string[];

  @IsOptional()
  @IsArray()
  roleCodes?: string[];
}

/** 知识分类改名：from → to，后端级联更新已有资料的 category */
export class RenameKnowledgeCategoryDto {
  @IsString()
  from: string;

  @IsString()
  to: string;
}

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(['public', 'department', 'group', 'role', 'private'] as const)
  visibility?: DocumentVisibility;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsArray()
  groupIds?: string[];

  @IsOptional()
  @IsArray()
  roleCodes?: string[];
}

export class QueryDocumentDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  /** all / customer / business — 资料归属过滤 */
  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsString()
  status?: string;

  /** 逗号分隔支持多选 */
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  uploaderId?: string;

  /** yyyy-MM-dd */
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  /** 文件格式，逗号分隔：pdf,word,excel,cad,image,other */
  @IsOptional()
  @IsString()
  fileType?: string;

  /** 按业务对象反查，需与 entityId 同时提供 */
  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;
}
