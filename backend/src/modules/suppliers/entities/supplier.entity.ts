import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** 国内 / 国外 —— 报价时区分进口件与国产件的关键维度 */
export type SupplierOrigin = 'domestic' | 'overseas';

/** 品牌层级 */
export type SupplierTier = 'tier1' | 'tier2' | 'tier3';

/** 合作等级 */
export type CooperationLevel = 'strategic' | 'qualified' | 'candidate' | 'blacklist';

export type Currency = 'CNY' | 'USD' | 'EUR';

/** 价格来源，决定这个数字能不能直接拿去报价 */
export type PriceSource = 'quote' | 'contract' | 'estimate';

export const SUPPLIER_ORIGIN_LABELS: Record<SupplierOrigin, string> = {
  domestic: '国内',
  overseas: '国外',
};

export const SUPPLIER_TIER_LABELS: Record<SupplierTier, string> = {
  tier1: '一线品牌',
  tier2: '二线品牌',
  tier3: '其他',
};

export const COOPERATION_LEVEL_LABELS: Record<CooperationLevel, string> = {
  strategic: '战略供应商',
  qualified: '合格供应商',
  candidate: '备选供应商',
  blacklist: '黑名单',
};

/** 外购件品类 —— 覆盖博亚装备的主要外购范围 */
export const PRODUCT_CATEGORY_OPTIONS = [
  '液压',
  '气动',
  '电气',
  '机械传动',
  '仪表',
  '轴承',
  '密封',
  '铸锻件',
  '标准件',
  '表面处理',
  '钢材',
  '其他',
];

@Entity('suppliers')
@Index(['origin'])
@Index(['tier'])
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true, unique: true })
  code: string;

  @Column({ nullable: true })
  contactName: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  address: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  // ── 分级与分类：报价比价的筛选维度 ──────────────────────────
  @Column({ type: 'varchar', nullable: true })
  origin: SupplierOrigin;

  @Column({ nullable: true })
  country: string;

  @Column({ type: 'varchar', nullable: true })
  tier: SupplierTier;

  @Column('simple-array', { nullable: true })
  productCategories: string[];

  @Column('simple-array', { nullable: true })
  qualification: string[];

  /** 供应商性质：finished=成品件 / process=工序外协 / both=两者；空=未分类（两种场景都可选） */
  @Column({ type: 'varchar', nullable: true })
  nature: 'finished' | 'process' | 'both' | null;

  /** 工序外协能力标签（热处理、发黑、焊接…），外协加工页按工序过滤候选厂 */
  @Column('simple-array', { nullable: true })
  processTags: string[];

  @Column({ type: 'varchar', default: 'candidate', nullable: true })
  cooperationLevel: CooperationLevel;

  @Column({ nullable: true })
  paymentTerms: string;

  @Column({ nullable: true })
  firstCooperationAt: Date;

  // ── 履约表现：由统计写入，不手工维护 ────────────────────────
  @Column({ default: 0 })
  orderCount: number;

  @Column({ type: 'decimal', precision: 16, scale: 2, default: 0 })
  orderAmount: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  onTimeRate: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  qualifiedRate: number;

  @Column({ default: 'b', nullable: true })
  rating: string;

  @Column({ default: 'approved' })
  status: string;

  @Column({ type: 'varchar', default: 'public' })
  visibility: 'public' | 'department' | 'group' | 'role' | 'private';

  @Column({ nullable: true })
  ownerId: string;

  @Column({ nullable: true })
  departmentId: string;

  @Column('simple-array', { nullable: true })
  groupIds: string[];

  @Column('simple-array', { nullable: true })
  roleCodes: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('supplier_capabilities')
export class SupplierCapability {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  supplierId: string;

  @Column()
  capability: string;

  @Column({ nullable: true })
  category: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/**
 * 供应产品目录。
 *
 * 价格用 min/max 数值而非策划文档里的 "10万-50万" 字符串 ——
 * 字符串没法排序、没法筛选，而"报价时快速对比供应商"正是这个模块存在的理由。
 * priceDate 同样关键：外购件价格半年就失效，没有采集日期的价格不能直接拿去报价。
 */
@Entity('supplier_products')
@Index(['supplierId'])
@Index(['category'])
export class SupplierProduct {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  supplierId: string;

  @Column()
  productName: string;

  @Column({ nullable: true })
  brand: string;

  @Column({ nullable: true })
  model: string;

  @Column({ type: 'text', nullable: true })
  specification: string;

  @Column({ nullable: true })
  category: string;

  /**
   * 关联物料主档：同规格的外购件归到同一物料，用于跨厂家比价。
   * 可空——未挂物料的供应产品仍能按品类列出，但不参与"同规格比价"。
   */
  @Index()
  @Column({ nullable: true })
  materialId: string;

  /**
   * 对应的我方产品：这条供应产品是我方哪个产品的采购来源（外购件 / 外协件）。
   * 映射后，报价明细选了该产品就自动带出成本（供应价折人民币），毛利随之算出。
   */
  @Index()
  @Column({ nullable: true })
  productId: string;

  /** 结构化规格 [{name,value}]（JSON 文本），用于计算 specSignature 自动匹配物料 */
  @Column({ type: 'text', nullable: true })
  specs: string;

  @Column({ nullable: true, default: '件' })
  unit: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  priceMin: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  priceMax: number;

  @Column({ type: 'varchar', default: 'CNY' })
  currency: Currency;

  @Column({ nullable: true })
  priceDate: Date;

  @Column({ type: 'varchar', default: 'estimate' })
  priceSource: PriceSource;

  @Column({ nullable: true })
  deliveryDays: number;

  @Column({ nullable: true })
  moq: number;

  /** 是否可作为进口件的国产替代 */
  @Column({ default: false })
  isSubstitutable: boolean;

  @Column({ nullable: true })
  substituteFor: string;

  @Column({ type: 'text', nullable: true })
  remark: string;

  @Column({ default: 'active' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/**
 * 历史报价。同一产品在不同数量档、不同时间的实际报价，
 * 用于画价格趋势、判断"这次报的价合不合理"。
 */
@Entity('supplier_quotes')
@Index(['supplierProductId'])
export class SupplierQuote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  supplierProductId: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 1 })
  quantity: number;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  unitPrice: number;

  @Column({ type: 'varchar', default: 'CNY' })
  currency: Currency;

  @Column({ nullable: true })
  quotedAt: Date;

  @Column({ nullable: true })
  validUntil: Date;

  /** 关联到哪一次对外报价 */
  @Column({ nullable: true })
  quotationId: string;

  @Column({ nullable: true })
  attachmentId: string;

  @Column({ nullable: true })
  createdBy: string;

  @Column({ type: 'text', nullable: true })
  remark: string;

  @CreateDateColumn()
  createdAt: Date;
}
