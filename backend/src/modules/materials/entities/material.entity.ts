import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 规格项：复用产品的 {name,value} 结构，与供应产品、产品规格一致 */
export interface MaterialSpecItem {
  name: string;
  value: string;
}

/**
 * 物料主档（外购件标准库）。
 *
 * 一个物料 = 一种"标准外购件"（如 液压油缸-Φ100-行程200），多家供应商的供应产品
 * 都挂到同一个物料下（supplier_products.materialId），从而能做"同规格跨厂家比价"。
 *
 * category 复用 system_configs 的 supplier_categories（与供应商大类同源），
 * 供应商大类改动物料自动跟随。
 */
@Entity('materials')
export class Material {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'materialCode' })
  materialCode: string;

  @Column()
  name: string;

  @Index()
  @Column({ nullable: true })
  category: string;

  /** 结构化规格 [{name,value}]；存为 JSON 文本 */
  @Column({ type: 'text', nullable: true })
  specs: string;

  /** 规格签名（归一化后字符串，用于跨供应商匹配同规格） */
  @Column({ nullable: true })
  specSignature: string;

  @Column({ default: '件' })
  unit: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  standardPrice: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
