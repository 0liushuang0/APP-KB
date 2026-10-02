import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 计算表。
 *
 * 用于存储带公式的Excel表格，支持在浏览器中在线编辑和实时计算。
 * 与CalcRecord（计算记录）互补：
 *   - CalcRecord：schema驱动的参数化计算，适合标准化的工程计算
 *   - CalcSheet：Excel表格，适合复杂的、非标准的计算场景
 *
 * 关联字段与CalcRecord一致，可挂到需求/方案/报价/客户下。
 */
@Entity('calc_sheets')
@Index(['relatedRequirementId'])
@Index(['templateCode'])
@Index(['customerId'])
export class CalcSheet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name' })
  name: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string;

  /** 存储的文件名（UUID.xlsx） */
  @Column({ name: 'file_key' })
  fileKey: string;

  /** 原始文件名 */
  @Column({ name: 'file_name' })
  fileName: string;

  @Column({ name: 'mime_type', nullable: true })
  mimeType: string;

  /** 文件大小（字节） */
  @Column({ name: 'file_size', default: 0 })
  fileSize: number;

  /**
   * Luckysheet数据（JSON格式，用于快速加载）
   *
   * 存储Luckysheet的sheet数组，包含单元格数据、合并信息、公式链等。
   * 这样前端可以直接加载而不需要每次都解析Excel文件。
   */
  @Column({ name: 'sheet_data', type: 'text', nullable: true })
  sheetData: string;

  /** 关联的计算工具code（可选，用于标识这是哪个计算工具的计算表） */
  @Column({ name: 'template_code', nullable: true })
  templateCode: string;

  @Column({ name: 'related_requirement_id', nullable: true })
  relatedRequirementId: string;

  @Column({ name: 'related_proposal_id', nullable: true })
  relatedProposalId: string;

  @Column({ name: 'related_quotation_id', nullable: true })
  relatedQuotationId: string;

  @Column({ name: 'customer_id', nullable: true })
  customerId: string;

  /** 版本号，每次保存+1 */
  @Column({ name: 'version', default: 1 })
  version: number;

  /** 变更记录 */
  @Column({ name: 'change_log', type: 'text', nullable: true })
  changeLog: string;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @Column({ name: 'created_by_name', nullable: true })
  createdByName: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
