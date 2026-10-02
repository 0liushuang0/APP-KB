import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

@Entity('approval_flows')
@Index(['objectType', 'objectId'])
@Index(['status'])
export class ApprovalFlow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  objectType: string;

  @Column()
  objectId: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: ApprovalStatus;

  @Column({ nullable: true })
  submittedBy: string;

  @Column({ nullable: true })
  reviewedBy: string;

  @Column({ type: 'text', nullable: true })
  comment: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
