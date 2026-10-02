import { IsString, IsOptional, IsNumber, IsDateString, Min } from 'class-validator';

/** 新建回款节点 */
export class CreateContractPaymentDto {
  /** 节点名：首付款 / 发货款 / 验收款 / 质保金 / 自定义 */
  @IsString()
  nodeName: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  dueAmount?: number;

  @IsOptional()
  @IsDateString()
  receivedDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  receivedAmount?: number;

  @IsOptional()
  @IsString()
  invoiceNo?: string;

  @IsOptional()
  @IsDateString()
  invoiceDate?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

/** 更新回款节点（登记实收/发票或调整应收） */
export class UpdateContractPaymentDto {
  @IsOptional()
  @IsString()
  nodeName?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  dueAmount?: number;

  @IsOptional()
  @IsDateString()
  receivedDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  receivedAmount?: number;

  @IsOptional()
  @IsString()
  invoiceNo?: string;

  @IsOptional()
  @IsDateString()
  invoiceDate?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
