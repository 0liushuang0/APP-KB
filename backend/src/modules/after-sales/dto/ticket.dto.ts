import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsString, IsOptional, IsNumber, IsDateString, IsInt } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateTicketDto {
  @IsOptional() @IsString()
  customerId?: string;

  @IsOptional() @IsString()
  contractId?: string;

  @IsOptional() @IsString()
  projectId?: string;

  @IsOptional() @IsString()
  type?: string;

  @IsString()
  title: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString()
  productModel?: string;

  @IsOptional() @IsString()
  priority?: string;

  @IsOptional() @IsString()
  assignedTo?: string;
}

export class UpdateTicketDto extends PartialType(CreateTicketDto) {
  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString()
  resolution?: string;

  @IsOptional() @IsString()
  spareParts?: string;

  @IsOptional() @IsDateString()
  resolvedAt?: string;

  @IsOptional() @IsInt()
  satisfactionScore?: number;

  @IsOptional() @IsDateString()
  visitDate?: string;

  @IsOptional() @IsString()
  visitNotes?: string;
}

export class QueryTicketDto extends PaginationQueryDto {
  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString()
  type?: string;

  @IsOptional() @IsString()
  customerId?: string;

  @IsOptional() @IsString()
  keyword?: string;
}
