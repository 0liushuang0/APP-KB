import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 合同实体。
 *
 * 处于业务链「报价 → 合同 → 项目跟踪」的中间环节：
 * 合同继承报价的流水号（CON-2026-007 ← QUO-2026-007），
 * 项目跟踪可关联合同（Project.contractId）。
 */
@Entity('contracts')
@Index(['customerId'])
@Index(['quotationId'])
@Index(['status'])
export class Contract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  contractNo: string;

  @Column({ nullable: true })
  title: string;

  @Column({ nullable: true })
  customerId: string;

  @Column({ nullable: true })
  quotationId: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  amount: number;

  /** 签订日期 */
  @Column({ type: 'date', nullable: true })
  signedDate: Date;

  /** 生效日期 */
  @Column({ type: 'date', nullable: true })
  effectiveDate: Date;

  /** 到期日期 */
  @Column({ type: 'date', nullable: true })
  expiryDate: Date;

  /** 质保月数（默认12），用于自动计算质保到期日 */
  @Column({ nullable: true })
  warrantyMonths: number;

  /** 质保到期日期（= signedDate + warrantyMonths，由服务层计算填充） */
  @Column({ type: 'date', nullable: true })
  warrantyExpiryDate: Date;

  @Column({ type: 'text', nullable: true })
  paymentTerms: string;

  @Column({ type: 'text', nullable: true })
  deliveryTerms: string;

  /** draft / signed / executing / completed / terminated */
  @Column({ default: 'draft' })
  status: string;

  // ── 权限快照（与客户/需求/方案/报价一致） ──
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
