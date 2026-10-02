import { IsString, IsOptional } from 'class-validator';

export class CreateParamTemplateDto {
  @IsString()
  category: string;

  /** 可省略：允许先建分类、字段随后在表格里逐条添加 */
  @IsOptional()
  @IsString()
  fields?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateParamTemplateDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  fields?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
