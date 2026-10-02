import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm';

@Entity('proposals')
@Index(['customerId'])
@Index(['requirementId'])
@Index(['status'])
export class Proposal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  proposalNo: string;

  @Column()
  customerId: string;

  /**
   * 来源需求。策划文档 4.2 要求「需求与方案为一对多」——
   * 一个需求可以有多个候选方案，方案要能回指是哪条需求派生的。
   */
  @Column({ nullable: true })
  requirementId: string;

  /**
   * 已废弃：项目名称改为从关联需求带出、只读。
   * 列保留仅为兼容历史数据，新数据一律不写；展示请用 requirement.title。
   */
  @Column({ nullable: true })
  title: string;

  @Column({ type: 'text', nullable: true })
  productDescription: string;

  @Column({ nullable: true })
  proposalType: string;

  @Column({ default: 1 })
  version: number;

  @Column({ default: 'pending' })
  status: string;

  @Column({ type: 'text', nullable: true })
  content: string;

  @Column({ type: 'text', nullable: true })
  requirements: string;

  @Column({ default: false })
  aiGenerated: boolean;

  @Column({ nullable: true })
  sourceProposalId: string;

  @Column({ nullable: true })
  ownerId: string;

  @Column({ nullable: true })
  departmentId: string;

  @Column({ type: 'varchar', default: 'public' })
  visibility: 'public' | 'department' | 'group' | 'role' | 'private';

  @Column('simple-array', { nullable: true })
  groupIds: string[];

  @Column('simple-array', { nullable: true })
  roleCodes: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('proposal_versions')
@Index(['proposalId'])
export class ProposalVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  proposalId: string;

  @Column()
  version: number;

  @Column({ type: 'text', nullable: true })
  content: string;

  @Column({ nullable: true })
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;
}
