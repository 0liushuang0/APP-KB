import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 工作任务实体 —— 业务流程之外的日常工作记录。
 *
 * 客户→需求→方案→报价→合同→项目→售后 是业务链单据（由客户需求驱动）；
 * 还有一类"每天都要做但不在业务链上的事"：会议、出差、报告编制、
 * 跨部门协作、资料整理、培训学习……本表就是它们的落点：
 * - 按工作日期记录（日志性质），可回溯"某天做了什么"
 * - 附件走 document_links（entityType=workTask，source=输入 / deliverable=输出）
 * - 来源人/交付对象对应参考系统（智能工作系统）的 source_person / deliver_to
 */
@Entity('work_tasks')
@Index(['ownerId'])
@Index(['workDate'])
@Index(['status'])
@Index(['category'])
export class WorkTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  taskNo: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  content: string;

  /** daily / meeting / trip / report / support / organize / training / other */
  @Column({ default: 'daily' })
  category: string;

  /** 工作日期：这件事是哪天做的/要哪天做（区别于系统创建时间） */
  @Column({ type: 'date', nullable: true })
  workDate: string;

  /** 开始时间 / 截止时间：跨天工作（出差、长周期报告）的时间窗 */
  @Column({ type: 'date', nullable: true })
  startDate: string;

  @Column({ type: 'date', nullable: true })
  dueDate: string;

  /** 所属项目：可关联项目跟踪（projectId），也可手写项目名（projectName 兜底） */
  @Column({ nullable: true })
  projectId: string;

  @Column({ nullable: true })
  projectName: string;

  /** 所属客户：关联客户中心（可空，纯内部工作可不挂） */
  @Column({ nullable: true })
  customerId: string;

  /** todo / doing / done */
  @Column({ default: 'todo' })
  status: string;

  /** urgent / high / medium / low */
  @Column({ default: 'medium' })
  priority: string;

  /** 来源：谁交办的 / 与谁协同 */
  @Column({ nullable: true })
  sourcePerson: string;

  /** 交付：成果交给谁 */
  @Column({ nullable: true })
  deliverTo: string;

  /** 耗时（小时），工作量的量化依据 */
  @Column({ type: 'numeric', nullable: true })
  spentHours: number;

  // ── 权限快照 ──
  @Column({ nullable: true })
  ownerId: string;

  @Column({ nullable: true })
  departmentId: string;

  /** 工作记录偏个人，默认仅自己可见 */
  @Column({ type: 'varchar', default: 'private' })
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
