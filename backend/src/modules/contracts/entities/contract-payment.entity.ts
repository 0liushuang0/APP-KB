import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 合同回款节点：首付款 / 发货款 / 验收款 / 质保金或自定义节点。
 *
 * 应收侧（nodeName/dueDate/dueAmount）在合同签订后登记，
 * 实收侧（receivedDate/receivedAmount/发票）随收款进展补记；
 * 汇总各节点即得合同级应收、已收、未收与回款进度。
 */
@Entity('contract_payments')
@Index(['contractId'])
export class ContractPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  contractId: string;

  /** 节点名，如：首付款、发货款、验收款、质保金 */
  @Column()
  nodeName: string;

  /** 应收日期 */
  @Column({ type: 'date', nullable: true })
  dueDate: Date;

  /** 应收金额 */
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  dueAmount: number;

  /** 实收日期（未收为空） */
  @Column({ type: 'date', nullable: true })
  receivedDate: Date;

  /** 实收金额（部分收款允许小于应收） */
  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  receivedAmount: number;

  /** 发票号 */
  @Column({ nullable: true })
  invoiceNo: string;

  /** 开票日期 */
  @Column({ type: 'date', nullable: true })
  invoiceDate: Date;

  @Column({ type: 'text', nullable: true })
  note: string;

  @Column({ nullable: true })
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
