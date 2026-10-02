import { PartialType } from '@nestjs/mapped-types';
import { IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { BusinessType } from '../entities/manufacturing.entity';

const businessTypes = ['equipment', 'repeat_part', 'service_retrofit', 'development'] as const;
const complianceVerdicts = ['unconfirmed', 'compliant', 'deviation', 'customer_accepted'] as const;
const reviewVerdicts = ['approved', 'conditional', 'returned'] as const;

export class CreateManufacturingCaseDto {
  @IsString() customerId: string;
  @IsOptional() @IsString() requirementId?: string;
  @IsOptional() @IsString() quotationId?: string;
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsString() @MaxLength(240) title: string;
  @IsEnum(businessTypes) businessType: BusinessType;
  @IsOptional() @IsString() technicalOwnerId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) participantIds?: string[];
  @IsOptional() @IsDateString() expectedDealDate?: string;
  @IsOptional() @IsNumber() @Min(0) expectedAmount?: number;
  @IsOptional() @IsString() nextAction?: string;
  @IsOptional() @IsDateString() nextActionDue?: string;
  @IsOptional() @IsString() decisionContext?: string;
  @IsOptional() @IsString() competitorContext?: string;
}

export class UpdateManufacturingCaseDto extends PartialType(CreateManufacturingCaseDto) {
  @IsInt() @Min(1) version: number;
  @IsOptional() @IsString() lossReason?: string;
}

export class LoseManufacturingCaseDto {
  @IsInt() @Min(1) version: number;
  @IsString() @MaxLength(2000) reason: string;
}

export class AddEquipmentDto {
  @IsString() customerId: string;
  @IsString() siteName: string;
  @IsOptional() @IsString() lineName?: string;
  @IsOptional() @IsString() equipmentNo?: string;
  @IsString() model: string;
  @IsOptional() @IsString() serialNo?: string;
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() drawingNo?: string;
  @IsOptional() @IsString() drawingVersion?: string;
  @IsOptional() @IsDateString() acceptedAt?: string;
  @IsOptional() @IsString() operatingContext?: string;
  @IsOptional() @IsString() configuration?: string;
}

export class AddComplianceDto {
  @IsString() requirementText: string;
  @IsOptional() @IsString() sourceRef?: string;
  @IsOptional() @IsString() response?: string;
  @IsEnum(complianceVerdicts) verdict: typeof complianceVerdicts[number];
  @IsOptional() @IsString() deviation?: string;
  @IsOptional() @IsString() verificationMethod?: string;
  @IsOptional() @IsString() ownerId?: string;
}

export class RecordReviewDto {
  @IsString() department: string;
  @IsEnum(reviewVerdicts) verdict: typeof reviewVerdicts[number];
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() conditionText?: string;
}

export class CreateEngineeringChangeDto {
  @IsOptional() @IsString() projectId?: string;
  @IsString() title: string;
  @IsString() reason: string;
  @IsString() beforeState: string;
  @IsString() afterState: string;
  @IsOptional() @IsNumber() costDelta?: number;
  @IsOptional() @IsInt() scheduleDeltaDays?: number;
  @IsOptional() @IsString() customerEvidenceRef?: string;
}

export class CreateDeliveryMilestoneDto {
  @IsString() name: string;
  @IsEnum(['plan', 'production', 'shipment', 'installation', 'acceptance', 'other'] as const) kind: string;
  @IsOptional() @IsDateString() promisedAt?: string;
  @IsOptional() @IsDateString() forecastAt?: string;
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsString() externalSystem?: string;
  @IsOptional() @IsString() externalId?: string;
}

export class UpdateDeliveryMilestoneDto {
  @IsOptional() @IsDateString() forecastAt?: string;
  @IsOptional() @IsDateString() actualAt?: string;
  @IsOptional() @IsEnum(['pending', 'in_progress', 'done', 'blocked'] as const) status?: string;
  @IsOptional() @IsString() evidenceRef?: string;
  @IsOptional() @IsString() blocker?: string;
}
