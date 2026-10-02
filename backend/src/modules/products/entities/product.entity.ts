import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm';

/**
 * 型号价格行：一个产品系列下的具体型号及其多档价格。
 * 不单独建表 —— 价格行跟着产品档案走，整表存取更简单。
 */
export interface ProductPriceItem {
  /** 型号规格，如 BJ125D-1450 */
  model: string;
  /** 关键参数/配置说明 */
  spec?: string;
  /** 成本价 */
  costPrice?: number;
  /** 市场参考价 */
  referencePrice?: number;
  /** 标配价 */
  standardPrice?: number;
  /** 销售价（对外报价基准） */
  salePrice?: number;
  /** 计价单位 */
  unit?: string;
  /** 备注 */
  remark?: string;
  /** 最近修改时间（前端写入） */
  updatedAt?: string;
}

/** 技术参数项：参数名 + 参数值，编辑入口在产品详情「技术参数」卡片 */
export interface ProductSpecItem {
  name: string;
  value: string;
}

@Entity('products')
@Index(['category'])
@Index(['status'])
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true, unique: true })
  code: string;

  @Column({ nullable: true })
  category: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  price: number;

  @Column({ nullable: true })
  unit: string;

  @Column({ nullable: true })
  supplierId: string;

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

  /** 型号价格表：系列下各型号的多档价格，编辑入口在产品详情「型号价格表」 */
  @Column('simple-json', { nullable: true })
  priceList: ProductPriceItem[];

  /** 技术参数：结构化参数表；旧数据（如化涂机）存于描述 [规格] 段，前端解析后兼容 */
  @Column('simple-json', { nullable: true })
  specs: ProductSpecItem[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('product_attachments')
@Index(['productId'])
export class ProductAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  productId: string;

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

  @Column({ default: 'other' })
  attachmentType: string;

  @Column({ type: 'text', nullable: true })
  parsedText: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('product_boms')
@Index(['productId'])
export class ProductBom {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  productId: string;

  @Column()
  materialName: string;

  @Column({ nullable: true })
  specification: string;

  @Column({ type: 'decimal', precision: 14, scale: 4, default: 0 })
  quantity: number;

  @Column({ nullable: true })
  unit: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  cost: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
