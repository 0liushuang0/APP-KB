import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('ai_budgets')
@Index(['userId', 'period'], { unique: true })
export class AiBudget {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  monthlyLimit: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  currentUsage: number;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0.8 })
  alertThreshold: number;

  @Column({ length: 7 })
  period: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}