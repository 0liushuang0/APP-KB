import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 前端错误日志。
 *
 * 单机产品出问题时用户往往只说"点了没反应"，没有这张表就无从查起。
 * 与 audit_logs 对照能还原出「谁、在哪一步、点了什么、然后崩了」。
 */
@Entity('client_errors')
@Index(['createdAt'])
@Index(['fingerprint'])
export class ClientError {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'text', nullable: true })
  stack: string;

  @Column({ type: 'text', nullable: true })
  componentStack: string;

  /** 出错位置，如 route:/requirements */
  @Column({ nullable: true })
  scope: string;

  @Column({ type: 'text', nullable: true })
  url: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string;

  @Column({ nullable: true })
  userId: string;

  /** message + scope 的哈希，用于把同一个 bug 的多次上报归并计数 */
  @Column({ nullable: true })
  fingerprint: string;

  @Column({ default: 1 })
  occurrenceCount: number;

  @Column({ nullable: true })
  lastOccurredAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
