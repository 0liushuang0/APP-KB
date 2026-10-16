import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index
} from 'typeorm';
import { Department } from '../../departments/entities/department.entity';

@Entity('customers')
@Index(['status'])
@Index(['name'])
@Index(['level'])
@Index(['businessStatus'])
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  /** 客户简称（字段名 code 为历史遗留） */
  @Column({ nullable: true, unique: true })
  code: string;

  /** 客户编号：自动生成 CUST-2026-001 */
  @Column({ nullable: true })
  customerCode: string;

  /** 所属行业：冶金/有色轧制/金属加工/汽车/家电/其他 */
  @Column({ nullable: true })
  industry: string;

  /** 企业规模：大型/中型/小型（恢复本义，不再借用为等级） */
  @Column({ nullable: true })
  scale: string;

  /** 客户等级：A(战略)/B(重点)/C(普通)/D(潜在) */
  @Column({ nullable: true })
  level: string;

  /** 业务状态：活跃/沉默/流失（独立于审批 status） */
  @Column({ nullable: true })
  businessStatus: string;

  /** 客户类型：制造企业/贸易商/设计院/代理商/其他 */
  @Column({ nullable: true })
  customerType: string;

  /** 所属区域（受控字典，见 common/utils/region.util.ts）：华北区/华东区/华中区/华南区/西北区/西南区/东北区/海外 */
  @Column({ nullable: true })
  region: string;

  /** 国家/地区（海外客户用；区域里原来写的「俄罗斯」「南亚区域」归并后落在这里） */
  @Column({ nullable: true })
  country: string;

  /** 注册地址（恢复本义，不再借用为城市） */
  @Column({ nullable: true })
  address: string;

  /** 统一社会信用代码 */
  @Column({ nullable: true })
  creditCode: string;

  /** 企业网址（恢复本义，不再借用为区域） */
  @Column({ nullable: true })
  website: string;

  /** 官方邮箱（公司通用邮箱, 不是联系人个人邮箱） */
  @Column({ nullable: true })
  email: string;

  /** 官方电话（公司总机/前台） */
  @Column({ nullable: true })
  phone: string;

  /** 邮编 */
  @Column({ nullable: true })
  postalCode: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  salesPerson: string;

  @Column({ nullable: true })
  ownerId: string;

  @Column({ nullable: true })
  departmentId: string;

  // 同上：findOne 里 relations 带了 department，连接列同样要对准 departmentId
  @ManyToOne(() => Department, { nullable: true })
  @JoinColumn({ name: 'departmentId' })
  department: Department;

  /** 首次合作日期 */
  @Column({ type: 'date', nullable: true })
  firstCooperationDate: Date;

  /** 最近成交日期（自动更新） */
  @Column({ type: 'date', nullable: true })
  lastDealDate: Date;

  /** 累计成交额（自动汇总） */
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalDealAmount: number;

  /** 审批流状态：pending/approved（与业务状态 businessStatus 分离） */
  @Column({ default: 'pending' })
  status: string;

  @Column({ type: 'varchar', default: 'public' })
  visibility: 'public' | 'department' | 'group' | 'role' | 'private';

  @Column('simple-array', { nullable: true })
  groupIds: string[];

  @Column('simple-array', { nullable: true })
  roleCodes: string[];

  /** 客户标签：如 铝板带/拉矫线/老客户/价格敏感 */
  @Column('simple-array', { nullable: true })
  tags: string[];

  @OneToMany(() => ContactPerson, (cp) => cp.customer)
  contacts: ContactPerson[];

  @OneToMany(() => FollowUpRecord, (fr) => fr.customer)
  followUps: FollowUpRecord[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('contact_persons')
@Index(['customerId'])
export class ContactPerson {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  /*
   * 关系的连接列必须就是上面那个 customerId。
   *
   * 原先写的是 @JoinColumn({ name: 'customer_id' }) —— 建表时因此多出一个
   * snake_case 的影子列，而写入走的一直是 customerId，customer_id 全是 NULL。
   * 后果是 relations: ['contacts'] 永远查回空数组：联系人存得进去、但客户详情
   * 和编辑弹窗里一个都看不到（实测库里 2 条联系人 customerId 有值、
   * customer_id 全空）。
   */
  @ManyToOne(() => Customer, (c) => c.contacts)
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  @Column()
  name: string;

  @Column({ nullable: true })
  title: string;

  /** 部门 */
  @Column({ nullable: true })
  department: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  /** 传真 */
  @Column({ nullable: true })
  fax: string;

  /** 微信 */
  @Column({ nullable: true })
  wechat: string;

  /** 其他联系方式（飞书、QQ等） */
  @Column({ nullable: true })
  otherContact: string;

  /** 决策角色：决策人/影响人/使用者/信息人/把关人 */
  @Column({ nullable: true })
  decisionRole: string;

  @Column({ nullable: true })
  isPrimary: boolean;

  /** 生日 */
  @Column({ type: 'date', nullable: true })
  birthday: Date;

  /** 备注：沟通偏好、性格特点等 */
  @Column({ type: 'text', nullable: true })
  remark: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('follow_up_records')
@Index(['customerId'])
export class FollowUpRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  customerId: string;

  // 同 ContactPerson：连接列要对准实际写入的 customerId，否则 followUps 也查不出来
  @ManyToOne(() => Customer, (c) => c.followUps)
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  /** 沟通内容 */
  @Column({ type: 'text' })
  content: string;

  /** 沟通日期 */
  @Column({ nullable: true })
  followUpAt: Date;

  /** 沟通方式：拜访/电话/邮件/微信/会议/展会 */
  @Column({ nullable: true })
  method: string;

  /** 我方参与人 */
  @Column({ nullable: true })
  participants: string;

  /** 客户方参与人 */
  @Column({ nullable: true })
  customerParticipants: string;

  /** 客户关注点 */
  @Column({ type: 'text', nullable: true })
  focusPoints: string;

  /** 下一步行动 */
  @Column({ type: 'text', nullable: true })
  nextAction: string;

  /** 跟进截止日期 */
  @Column({ type: 'date', nullable: true })
  deadline: Date;

  /** 关联需求 */
  @Column({ nullable: true })
  requirementId: string;

  @Column({ nullable: true })
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
