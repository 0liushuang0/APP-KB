import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm';

@Entity('requirements')
@Index(['customerId'])
@Index(['isCurrent'])
@Index(['rootRequirementId'])
@Index(['status'])
export class Requirement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  requirementNo: string;

  @Column()
  title: string;

  @Column({ nullable: true })
  customerId: string;

  @Column({ nullable: true })
  projectId: string;

  /** 需求来源：主动拜访/客户来询/展会/转介绍/其他 */
  @Column({ nullable: true })
  category: string;

  /** 需求类型：新设备采购/技改升级/备件需求/咨询服务 */
  @Column({ nullable: true })
  requirementType: string;

  /** 产品类型（决定使用哪个参数模板），原 templateCategory */
  @Column({ nullable: true })
  templateCategory: string;

  /** 联系人姓名 */
  @Column({ nullable: true })
  contactName: string;

  /** 联系人电话 */
  @Column({ nullable: true })
  contactPhone: string;

  /** 联系人邮箱 */
  @Column({ nullable: true })
  contactEmail: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: 'medium' })
  priority: string;

  // ── 商机管理（销售过程）：漏斗按金额说话就靠这几个字段 ──
  /** 预计成交金额 */
  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  expectedAmount: number;

  /** 预计成交日期 */
  @Column({ type: 'date', nullable: true })
  expectedDealDate: Date;

  /** 赢单概率 0-100 */
  @Column({ type: 'integer', nullable: true })
  winProbability: number;

  /** 下次跟进日期 */
  @Column({ type: 'date', nullable: true })
  nextFollowUpDate: Date;

  /** 输单原因（失单时填写，沉淀为经验） */
  @Column({ type: 'text', nullable: true })
  lossReason: string;

  @Column({ default: 'pending' })
  status: string;

  @Column({ type: 'text', nullable: true })
  aiAnalysis: string;

  @Column({ type: 'text', nullable: true })
  structuredSpec: string;

  @Column({ type: 'varchar', default: 'pending' })
  specStatus: 'pending' | 'analyzing' | 'done' | 'rejected';

  @Column({ nullable: true })
  analyzedBy: string;

  @Column({ nullable: true })
  analyzedAt: Date;

  @Column({ nullable: true })
  specDocumentId: string;

  // ── 版本管理：需求变更时留痕，报价争议时能追溯"当时客户是怎么提的" ──
  @Column({ default: 1 })
  version: number;

  /** 指向初版需求；同一条链上的所有版本共享这个 id */
  @Column({ nullable: true })
  rootRequirementId: string;

  @Column({ type: 'text', nullable: true })
  changeReason: string;

  /** 是否为当前生效版本；旧版本置 false，列表默认只显示当前版本 */
  @Column({ default: true })
  isCurrent: boolean;

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

/**
 * 需求记录（沟通 / 变更 / 确认）。
 *
 * 取代了原先「创建新版本」的做法：变更不再 fork 出一条新需求（那样会丢掉
 * 已关联的方案、资料、参数，逼着重做），而是在**同一条需求**下累加一条记录。
 * 记录「变更」时可选地把改动明细存进 metadata（JSON），保留报价争议时的证据链。
 */
export type RequirementLogType = 'communication' | 'change' | 'confirm' | 'other';

@Entity('requirement_logs')
@Index(['requirementId'])
export class RequirementLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  requirementId: string;

  /** 记录类型：沟通交流 / 需求变更 / 客户确认 / 其他 */
  @Column({ type: 'varchar', default: 'communication' })
  type: RequirementLogType;

  @Column({ type: 'text' })
  content: string;

  @Column({ nullable: true })
  actorId: string;

  @Column({ nullable: true })
  actorName: string;

  /** 变更快照（JSON 字符串）：[{ field, from, to }]，仅「变更」类型可能有值 */
  @Column({ type: 'text', nullable: true })
  metadata: string;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('requirement_attachments')
@Index(['requirementId'])
export class RequirementAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  requirementId: string;

  @Column()
  fileName: string;

  @Column()
  fileKey: string;

  @Column({ nullable: true })
  fileUrl: string;

  @Column({ default: 0 })
  fileSize: number;

  @Column({ nullable: true })
  mimeType: string;

  @Column({ type: 'text', nullable: true })
  parsedText: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
