import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 售后工单实体。
 *
 * 业务链第 8 步：项目跟踪 → 售后管理 →（回流）需求管理。
 * 工单覆盖 4 类售后场景：故障报修 / 定期保养 / 备件需求 / 客户回访。
 * 备件需求可一键转需求管理（convertToRequirement），开启新一轮业务闭环。
 * 故障处理经验可一键转知识库 FAQ（convertToFaq）。
 */
@Entity('after_sales_tickets')
@Index(['customerId'])
@Index(['contractId'])
@Index(['projectId'])
@Index(['status'])
@Index(['type'])
export class AfterSalesTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  ticketNo: string;

  @Column({ nullable: true })
  customerId: string;

  @Column({ nullable: true })
  contractId: string;

  @Column({ nullable: true })
  projectId: string;

  /** fault / maintenance / spare_part / visit */
  @Column({ default: 'fault' })
  type: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  productModel: string;

  /** urgent / high / medium / low */
  @Column({ default: 'medium' })
  priority: string;

  /** open / assigned / in_progress / resolved / closed / converted */
  @Column({ default: 'open' })
  status: string;

  @Column({ nullable: true })
  assignedTo: string;

  @Column({ type: 'date', nullable: true })
  resolvedAt: Date;

  @Column({ type: 'text', nullable: true })
  resolution: string;

  @Column({ type: 'text', nullable: true })
  spareParts: string;

  /** 1-5 回访满意度 */
  @Column({ nullable: true })
  satisfactionScore: number;

  @Column({ type: 'date', nullable: true })
  visitDate: Date;

  @Column({ type: 'text', nullable: true })
  visitNotes: string;

  // ── 权限快照 ──
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
