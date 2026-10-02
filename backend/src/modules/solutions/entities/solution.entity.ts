import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm';

@Entity('solutions')
@Index(['category'])
@Index(['productId'])
export class Solution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 方案编号，如 SOL-2026-001。历史数据迁移时按 rowid 回填 */
  @Column({ nullable: true })
  solutionNo: string;

  @Column({ nullable: true })
  productId: string;

  @Column()
  name: string;

  /** 方案类型：standard 标准 / optional 选配 / custom_template 定制模板 */
  @Column({ nullable: true })
  solutionType: string;

  /** 目录路径（斜杠分层），如 普碳钢/酸洗线；左侧据此还原成父/子目录树 */
  @Column({ nullable: true })
  directory: string;

  /** 方案摘要（沿用 description 字段承载） */
  @Column({ type: 'text', nullable: true })
  description: string;

  /** 适用场景 */
  @Column({ type: 'text', nullable: true })
  scenario: string;

  /** 关键参数标签（JSON 字符串），用于需求匹配，如 {"板厚":"0.3-3mm"} */
  @Column({ type: 'text', nullable: true })
  keyParams: string;

  /** 适用参数摘要（人读的一段范围概述） */
  @Column({ type: 'text', nullable: true })
  paramSummary: string;

  /** 参考价格区间，如 200-350万 */
  @Column({ nullable: true })
  priceRange: string;

  /** 典型交付周期，如 90-120天 */
  @Column({ nullable: true })
  deliveryCycle: string;

  @Column({ nullable: true })
  cadTemplateUrl: string;

  @Column({ nullable: true })
  agreementTemplateUrl: string;

  @Column({ nullable: true })
  quotationTemplate: string;

  @Column({ type: 'text', nullable: true })
  defaultConfig: string;

  @Column('simple-array', { nullable: true })
  tags: string[];

  @Column({ nullable: true })
  category: string;

  @Column({ default: 1 })
  version: number;

  @Column({ default: 'approved' })
  status: string;

  @Column({ nullable: true })
  ownerId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('config_options')
@Index(['solutionId'])
export class ConfigOption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  solutionId: string;

  @Column()
  key: string;

  @Column()
  label: string;

  @Column({ type: 'text', nullable: true })
  choices: string;

  @Column({ type: 'text', nullable: true })
  constraintRules: string;

  @Column({ nullable: true })
  sortOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('price_tables')
@Index(['solutionId'])
export class PriceTable {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  solutionId: string;

  @Column()
  optionKey: string;

  @Column()
  optionValue: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  priceDelta: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  cost: number;

  @Column({ nullable: true })
  leadTime: string;

  @Column({ nullable: true })
  supplyLevel: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
