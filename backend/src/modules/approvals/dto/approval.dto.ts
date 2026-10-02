import { IsString, IsOptional, IsEnum } from 'class-validator';

export class CreateApprovalDto {
  @IsString()
  objectType: string;

  @IsString()
  objectId: string;

  @IsOptional()
  @IsString()
  submittedBy?: string;

  @IsOptional()
  @IsEnum(['pending', 'approved', 'rejected'] as const)
  status?: 'pending' | 'approved' | 'rejected';
}

export class UpdateApprovalDto {
  @IsOptional()
  @IsEnum(['pending', 'approved', 'rejected'] as const)
  status?: 'pending' | 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  comment?: string;
}

export class QueryApprovalDto {
  @IsOptional()
  @IsString()
  objectType?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
