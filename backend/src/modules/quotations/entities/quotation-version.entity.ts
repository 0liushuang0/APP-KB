import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 报价版本快照：修改报价前的整体存档（头字段 + 明细）。
 *
 * 与乐观锁 version 列配合：每次修改触发存档，快照记录的是
 * "被覆盖掉的那一版"，审计与客户对账时可完整回放历史版本。
 */
@Entity('quotation_versions')
@Index(['quotationId'])
export class QuotationVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  quotationId: string;

  /** 被存档的版本号（与 quotations.version 对应） */
  @Column({ type: 'integer' })
  version: number;

  /** 报价头字段 JSON */
  @Column({ type: 'text' })
  snapshot: string;

  /** 明细数组 JSON */
  @Column({ type: 'text', nullable: true })
  itemsSnapshot: string;

  /** 触发存档的修改人 */
  @Column({ nullable: true })
  changedBy: string;

  @Column({ nullable: true })
  note: string;

  @CreateDateColumn()
  createdAt: Date;
}
