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

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  amount: number;

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

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  cost: number;

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
