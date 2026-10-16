import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type DocStage =
  | 'raw'
  | 'requirement'
  | 'analysis'
  | 'solution'
  | 'quotation'
  | 'contract';

export type DocCategory = string; // 放开类型约束：业务资料/客户资料/知识资料各有独立分类体系，统一存 varchar

/** 该文件在被关联对象里扮演什么角色 */
export type LinkRole = 'source' | 'deliverable' | 'reference';

export const DOC_STAGE_LABELS: Record<DocStage, string> = {
  raw: '原始资料',
  requirement: '需求文件',
  analysis: '分析文档',
  solution: '技术方案',
  quotation: '报价文件',
  contract: '合同协议',
};

// 旧分类的中文映射（兼容历史数据），新分类由前端 resolveDocCategoryLabel 统一处理
export const DOC_CATEGORY_LABELS: Record<string, string> = {
  // 业务资料（新7大类）
  company_profile: '公司形象', product_promo: '产品推广', case_study: '方案与案例',
  qualification: '资质证书', bid_doc: '投标文件', market_research: '市场研究',
  exhibition: '展会活动', other: '其他',
  // 客户资料（新6大类）
  customer_background: '客户背景', customer_tech: '客户技术资料', communication: '沟通记录',
  proposal_record: '方案报价记录', contract_delivery: '合同交付', customer_standard: '客户标准规范',
  // 旧分类（兼容）
  raw_material: '原始资料', requirement_spec: '需求规格', cad_drawing: 'CAD 图纸',
  tech_agreement: '技术协议', quotation: '报价单', contract: '合同', calc_sheet: '计算书',
};

export const LINK_ROLE_LABELS: Record<LinkRole, string> = {
  source: '原始资料',
  deliverable: '交付物',
  reference: '参考',
};

/**
 * 资料关联表 —— 全链路回查的核心。
 *
 * 为什么是独立关联表，而不是在 documents 上挂 4 个外键（策划文档 4.1 的写法）：
 * 一份《技术协议》同时属于需求、方案、报价三方，挂在 documents 上就是 1:N，
 * 表达不了多重归属。放在关联表里，一份文件可以有多行 link，各自指向不同链路节点。
 *
 * 为什么用显式列而不是 (entityType, entityId) 多态：
 * 业务对象是稳定的 6 类，显式列能在一行里同时记下"哪个客户的哪个需求下的哪个方案"，
 * 回查时不用自己拼链路；且既有的 project / customer 查询无需改写。
 */
@Entity('document_links')
@Index(['customerId'])
@Index(['requirementId'])
@Index(['proposalId'])
@Index(['quotationId'])
@Index(['projectId'])
@Index(['contractId'])
export class DocumentLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  documentId: string;

  // ── 链路节点：可同时填多个，表示该文件在链路上的位置 ──
  @Column({ nullable: true })
  projectId: string;

  @Column({ nullable: true })
  customerId: string;

  @Column({ nullable: true })
  requirementId: string;

  @Column({ nullable: true })
  proposalId: string;

  @Column({ nullable: true })
  solutionId: string;

  @Column({ nullable: true })
  quotationId: string;

  @Column({ nullable: true })
  contractId: string;

  /** 售后工单：工单自己的附件（现场照片、维修报告等），不挂客户名下以免混入全链路资料 */
  @Column({ nullable: true })
  afterSaleId: string;

  /** 工作任务：日常工作记录自己的附件（source=输入 / deliverable=输出），不参与业务链 */
  @Column({ nullable: true })
  workTaskId: string;

  @Column({ type: 'varchar', default: 'raw' })
  stage: DocStage;

  @Column({ type: 'varchar', default: 'raw_material' })
  category: DocCategory;

  @Column({ type: 'varchar', default: 'source' })
  linkRole: LinkRole;

  @Column({ default: 1 })
  version: number;

  @Column({ nullable: true })
  uploadedBy: string;

  @Column({ nullable: true })
  uploadedByName: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
