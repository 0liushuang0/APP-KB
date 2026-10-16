import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm';

@Entity('quotations')
@Index(['customerId'])
@Index(['proposalId'])
@Index(['status'])
export class Quotation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  quotationNo: string;

  @Column()
  customerId: string;

  @Column({ nullable: true })
  proposalId: string;

  /** 报价金额（单据币种）。汇总到工作台/周报时按 exchangeRate 折人民币 */
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  amount: number;

  /** 币种：CNY / USD / EUR（海外客户直接出美元、欧元报价） */
  @Column({ type: 'varchar', default: 'CNY' })
  currency: string;

  /** 出单时锁定的汇率：1 单据币种 = x 人民币；人民币单据为空 */
  @Column({ type: 'decimal', precision: 14, scale: 6, nullable: true })
  exchangeRate: number;

  /** 报价单语言：zh 中文 / en 英文（打印模板随之切换） */
  @Column({ type: 'varchar', default: 'zh' })
  language: string;

  /**
   * 报价日期（业务发生日）。
   * 历史单据多为集中补录，创建时间不代表报价时间 ——「需求→报价」周期指标按它算，空时才退回创建时间。
   */
  @Column({ type: 'date', nullable: true })
  quotedAt: string;

  @Column({ default: 'pending' })
  status: string;

  /**
   * 乐观锁版本号：每次保存 +1。
   * 多人同时编辑同一张报价时，后保存者必须带上自己读到的版本号；
   * 与服务器不一致说明期间有人改过，直接拒绝（409）而不是静默覆盖。
   */
  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({ type: 'text', nullable: true })
  costBreakdown: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  /** 付款条件（如：预付 30%，发货前 60%，验收后 10%） */
  @Column({ type: 'text', nullable: true })
  paymentTerms: string;

  /** 交货期：合同生效后多少天交货 */
  @Column({ type: 'integer', nullable: true })
  deliveryDays: number;

  /** 质保期（月） */
  @Column({ type: 'integer', nullable: true })
  warrantyMonths: number;

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

@Entity('quotation_items')
@Index(['quotationId'])
export class QuotationItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  quotationId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  specification: string;

  /** 英文品名 / 英文规格：英文报价单用，空时打印中文 */
  @Column({ nullable: true })
  nameEn: string;

  @Column({ type: 'text', nullable: true })
  specificationEn: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  quantity: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalPrice: number;

  // ── 成本与供应商溯源：报出去的价从哪来、赚多少，要能回查 ──
  @Column({ nullable: true })
  brand: string;

  /**
   * 引用的自有产品。
   * 有了它，产品详情才能回答「这个产品被哪几单报过价、价格区间多少」——
   * 之前只有 name 这个自由文本，产品库和报价之间没有可追溯的联系。
   */
  @Column({ nullable: true })
  @Index()
  productId: string;

  /** 引用的供应产品，报价单能回溯到具体供应商的哪一条目录价 */
  @Column({ nullable: true })
  supplierProductId: string;

  @Column({ nullable: true })
  supplierId: string;

  @Column({ nullable: true })
  supplierName: string;

  /** 单位成本（人民币）。只对有成本查看权限的人返回 */
  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  cost: number;

  /** 成本从哪来：型号价格表 / 供应商采购价 / BOM 汇总 / 手填（给人核对） */
  @Column({ nullable: true })
  costSource: string;

  @Column({ nullable: true })
  deliveryDays: number;

  @Column({ nullable: true })
  unit: string;

  @Column({ nullable: true })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
