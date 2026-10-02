import { IsArray, IsISO8601, IsOptional, IsString, Length, MaxLength, ArrayMaxSize } from 'class-validator';

export class ZhDocumentItemDto {
  @IsString() @Length(1, 160)
  id: string;

  @IsString() @Length(1, 240)
  title: string;

  @IsString() @MaxLength(4_000_000)
  content: string;

  @IsString() @Length(1, 160)
  source: string;

  @IsISO8601({ strict: true })
  updated_at: string;

  @IsOptional() @IsString() @MaxLength(240)
  project_ref?: string;
}

export class ZhDocumentBatchDto {
  // Item validation happens separately so one invalid row cannot reject a batch.
  @IsArray() @ArrayMaxSize(100)
  items: ZhDocumentItemDto[];
}
