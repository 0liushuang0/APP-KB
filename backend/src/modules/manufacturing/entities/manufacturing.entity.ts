import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type BusinessType = 'equipment' | 'repeat_part' | 'service_retrofit' | 'development';

@Entity('manufacturing_cases')
@Index(['customerId'])
@Index(['requirementId'])
@Index(['businessType', 'stage'])
export class ManufacturingCase {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() customerId: string;
  @Column({ nullable: true }) requirementId: string;
  @Column({ nullable: true }) quotationId: string;
  @Column({ nullable: true }) contractId: string;
  @Column({ nullable: true }) projectId: string;
  @Column() title: string;
  @Column({ type: 'varchar' }) businessType: BusinessType;
  @Column({ default: 'qualification' }) stage: string;
  @Column({ default: 'open' }) status: string;
  @Column({ nullable: true }) ownerId: string;
  @Column({ nullable: true }) technicalOwnerId: string;
  @Column('simple-array', { nullable: true }) participantIds: string[];
  @Column({ nullable: true }) expectedDealDate: string;
  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true }) expectedAmount: number;
  @Column({ nullable: true }) nextAction: string;
  @Column({ nullable: true }) nextActionDue: string;
  @Column({ type: 'text', nullable: true }) decisionContext: string;
  @Column({ type: 'text', nullable: true }) competitorContext: string;
  @Column({ type: 'text', nullable: true }) lossReason: string;
  @Column({ default: 1 }) version: number;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('customer_equipment')
@Index(['customerId'])
@Index(['serialNo'])
export class CustomerEquipment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() customerId: string;
  @Column() ownerId: string;
  @Column() siteName: string;
  @Column({ nullable: true }) lineName: string;
  @Column({ nullable: true }) equipmentNo: string;
  @Column() model: string;
  @Column({ nullable: true }) serialNo: string;
  @Column({ nullable: true }) contractId: string;
  @Column({ nullable: true }) projectId: string;
  @Column({ nullable: true }) drawingNo: string;
  @Column({ nullable: true }) drawingVersion: string;
  @Column({ nullable: true }) acceptedAt: string;
  @Column({ type: 'text', nullable: true }) operatingContext: string;
  @Column({ type: 'text', nullable: true }) configuration: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('technical_compliance')
@Index(['caseId'])
export class TechnicalCompliance {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() caseId: string;
  @Column() requirementText: string;
  @Column({ nullable: true }) sourceRef: string;
  @Column({ type: 'text', nullable: true }) response: string;
  @Column({ default: 'unconfirmed' }) verdict: string;
  @Column({ type: 'text', nullable: true }) deviation: string;
  @Column({ nullable: true }) verificationMethod: string;
  @Column({ nullable: true }) ownerId: string;
  @Column({ nullable: true }) confirmedBy: string;
  @Column({ nullable: true }) confirmedAt: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('manufacturing_reviews')
@Index(['caseId', 'department'], { unique: true })
export class ManufacturingReview {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() caseId: string;
  @Column() department: string;
  @Column({ default: 'pending' }) verdict: string;
  @Column({ type: 'text', nullable: true }) note: string;
  @Column({ nullable: true }) conditionText: string;
  @Column({ nullable: true }) reviewedBy: string;
  @Column({ nullable: true }) reviewedAt: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('engineering_changes')
@Index(['caseId'])
@Index(['projectId'])
export class EngineeringChange {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() caseId: string;
  @Column({ nullable: true }) projectId: string;
  @Column() title: string;
  @Column({ type: 'text' }) reason: string;
  @Column({ type: 'text' }) beforeState: string;
  @Column({ type: 'text' }) afterState: string;
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 }) costDelta: number;
  @Column({ type: 'integer', default: 0 }) scheduleDeltaDays: number;
  @Column({ default: 'draft' }) status: string;
  @Column({ nullable: true }) customerEvidenceRef: string;
  @Column({ nullable: true }) raisedBy: string;
  @Column({ nullable: true }) approvedBy: string;
  @Column({ nullable: true }) approvedAt: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('delivery_milestones')
@Index(['projectId'])
export class DeliveryMilestone {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() projectId: string;
  @Column() name: string;
  @Column({ default: 'other' }) kind: string;
  @Column({ nullable: true }) promisedAt: string;
  @Column({ nullable: true }) forecastAt: string;
  @Column({ nullable: true }) actualAt: string;
  @Column({ default: 'pending' }) status: string;
  @Column({ nullable: true }) ownerId: string;
  @Column({ nullable: true }) evidenceRef: string;
  @Column({ nullable: true }) externalSystem: string;
  @Column({ nullable: true }) externalId: string;
  @Column({ type: 'text', nullable: true }) blocker: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
