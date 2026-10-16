import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * 周报：每周一自动生成，个人一份（本人负责的单据与待办），管理者另有全公司一份。
 * content 存 JSON（结构见 weekly-report.service.ts 的 WeeklyReportContent），历史周报可回看。
 */
@Entity('weekly_reports')
@Index(['weekKey'])
@Index(['recipientId'])
export class WeeklyReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** ISO 周，如 2026-W42 */
  @Column()
  weekKey: string;

  /** personal 个人 / company 全公司 */
  @Column({ default: 'personal' })
  scope: string;

  /** 个人周报的接收人；全公司周报为空 */
  @Column({ nullable: true })
  recipientId: string;

  @Column()
  title: string;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn()
  createdAt: Date;
}
