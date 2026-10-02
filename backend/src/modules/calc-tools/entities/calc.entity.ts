import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** 输入字段定义（存在 schema JSON 里） */
export interface CalcInputDef {
  key: string;
  label: string;
  type: 'number' | 'enum' | 'string';
  unit?: string;
  /** enum 类型的可选项；value 参与计算，label 给人看 */
  options?: Array<{ value: number | string; label: string }>;
  min?: number;
  max?: number;
  default?: number | string;
  required?: boolean;
  /** 分组标题，前端按此折叠 */
  group?: string;
  /** 字段说明 / 取值建议 */
  hint?: string;
}

/** 中间量与输出量定义 */
export interface CalcFormulaDef {
  key: string;
  label: string;
  unit?: string;
  /** 表达式，变量取自输入字段 key 与前序 formula key */
  expr: string;
  /** 保留小数位 */
  digits?: number;
  /** 超出该范围时前端标红提示 */
  warnBelow?: number;
  warnAbove?: number;
  hint?: string;
}

export interface CalcSchema {
  inputs: CalcInputDef[];
  formulas: CalcFormulaDef[];
  /** 展示为最终结果的 formula key，不填则展示全部 */
  outputs?: string[];
  notes?: string;
}

/**
 * 计算模板。
 *
 * 配置驱动而非硬编码：公式与输入项都存在 schema 里，
 * 新增一个计算工具 = 插一条记录，不用改代码发版。
 * 这对博亚很关键 —— 计算方法归技术部所有，不该由开发排期决定何时上线。
 */
@Entity('calc_templates')
@Index(['code'], { unique: true })
export class CalcTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  category: string;

  @Column({ nullable: true })
  icon: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  /** JSON.stringify(CalcSchema) */
  @Column({ type: 'text' })
  schema: string;

  @Column({ default: 1 })
  version: number;

  @Column({ default: 'active' })
  status: string;

  @Column({ default: 0 })
  sortOrder: number;

  /** 使用次数，用于工具列表排序 */
  @Column({ default: 0 })
  useCount: number;

  @Column({ nullable: true })
  ownerId: string;

  @Column({ type: 'varchar', default: 'public' })
  visibility: 'public' | 'department' | 'group' | 'role' | 'private';

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/**
 * 计算记录。
 *
 * 比策划文档多关联需求 / 方案 / 报价三个维度 ——
 * 技术人员做方案时算一次，市场部报价时要复核同一份计算。
 * templateVersion 一并存下：模板改了公式，历史记录仍能说明当时是怎么算的。
 */
@Entity('calc_records')
@Index(['relatedProposalId'])
@Index(['relatedRequirementId'])
@Index(['customerId'])
export class CalcRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  templateCode: string;

  @Column({ default: 1 })
  templateVersion: number;

  @Column({ nullable: true })
  templateName: string;

  @Column({ nullable: true })
  title: string;

  /** JSON：{ [inputKey]: value } */
  @Column({ type: 'text' })
  inputData: string;

  /** JSON：[{ key, label, unit, value, expr }] */
  @Column({ type: 'text' })
  resultData: string;

  @Column({ nullable: true })
  relatedSolutionId: string;

  @Column({ nullable: true })
  relatedProposalId: string;

  @Column({ nullable: true })
  relatedRequirementId: string;

  @Column({ nullable: true })
  relatedQuotationId: string;

  @Column({ nullable: true })
  customerId: string;

  @Column({ type: 'text', nullable: true })
  remark: string;

  @Column({ nullable: true })
  createdBy: string;

  @Column({ nullable: true })
  createdByName: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
