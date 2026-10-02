import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm';

export type DealStage =
  | 'requirement_registered'
  | 'requirement_analyzed'
  | 'solution_drafting'
  | 'quotation_drafting'
  | 'quotation_reviewed'
  | 'submitted'
  | 'contract_signed'
  | 'won'
  | 'lost';

@Entity('projects')
@Index(['customerId'])
@Index(['dealStage'])
@Index(['status'])
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  projectNo: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  customerId: string;

  @Column({ nullable: true })
  requirementId: string;

  @Column({ nullable: true })
  proposalId: string;

  @Column({ nullable: true })
  quotationId: string;

  @Column({ nullable: true })
  contractId: string;

  /** 项目类型：设备制造/安装调试/技改/服务 */
  @Column({ nullable: true })
  projectType: string;

  /** 实际开始日期 */
  @Column({ type: 'date', nullable: true })
  actualStartDate: Date;

  /** 实际结束日期 */
  @Column({ type: 'date', nullable: true })
  actualEndDate: Date;

  /** 业务状态：未启动/进行中/暂停/已完成/已延期 */
  @Column({ nullable: true })
  businessStatus: string;

  /** 进度百分比（0-100，自动按已完成阶段数计算） */
  @Column({ type: 'integer', default: 0 })
  progress: number;

  /** 健康度：green/yellow/red（自动计算） */
  @Column({ nullable: true })
  health: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  startDate: Date;

  @Column({ nullable: true })
  endDate: Date;

  @Column({ default: 'pending' })
  status: string;

  @Column({ type: 'varchar', default: 'requirement_registered' })
  dealStage: DealStage;

  @Column({ type: 'varchar', default: 'new' })
  dealType: 'new' | 'repeat' | 'expansion';

  @Column({ nullable: true })
  managerId: string;

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

@Entity('project_stages')
@Index(['projectId'])
export class ProjectStage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  projectId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  startDate: Date;

  @Column({ nullable: true })
  endDate: Date;

  /** 未开始/进行中/已完成/已延期 */
  @Column({ default: 'pending' })
  status: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  /** 负责人 */
  @Column({ nullable: true })
  assignedTo: string;

  /** 交付物文件名 */
  @Column({ nullable: true })
  deliverable: string;

  /** 验收结果：通过/不通过/待验收 */
  @Column({ nullable: true })
  acceptanceResult: string;

  @Column({ type: 'integer', default: 0 })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('project_risks')
@Index(['projectId'])
export class ProjectRisk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  projectId: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  /** 风险类型：技术/进度/成本/质量/外部 */
  @Column({ nullable: true })
  riskType: string;

  /** 概率：高/中/低 */
  @Column({ nullable: true })
  probability: string;

  /** 影响程度：高/中/低 */
  @Column({ nullable: true })
  impact: string;

  /** 风险等级（自动计算） */
  @Column({ default: 'medium' })
  level: string;

  /** 已识别/处理中/已关闭/已发生 */
  @Column({ default: 'open' })
  status: string;

  @Column({ nullable: true })
  mitigation: string;

  /** 责任人 */
  @Column({ nullable: true })
  owner: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/**
 * 项目任务（挂在里程碑/阶段下）
 */
@Entity('project_tasks')
@Index(['projectId'])
@Index(['stageId'])
export class ProjectTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  projectId: string;

  /** 所属里程碑/阶段 */
  @Column({ nullable: true })
  stageId: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  /** 负责人（展示名，兼容历史数据；新数据以 assignedUserId 为准） */
  @Column({ nullable: true })
  assignedTo: string;

  /** 负责人账号 ID：可校验、可通知；展示名从账号资料回填 */
  @Column({ nullable: true })
  assignedUserId: string;

  /** 协作人（逗号分隔） */
  @Column({ nullable: true })
  collaborators: string;

  @Column({ type: 'date', nullable: true })
  startDate: Date;

  @Column({ type: 'date', nullable: true })
  endDate: Date;

  /** 进度 0-100 */
  @Column({ type: 'integer', default: 0 })
  progress: number;

  /** 高/中/低 */
  @Column({ default: 'medium' })
  priority: string;

  /** 待开始/进行中/已完成/已取消 */
  @Column({ default: 'pending' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
