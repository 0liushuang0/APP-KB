import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index
} from 'typeorm';

@Entity('ai_call_logs')
@Index(['createdAt'])
@Index(['module'])
export class AiCallLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  traceId: string;

  @Column()
  endpoint: string;

  @Column({ nullable: true })
  module: string;

  @Column({ nullable: true })
  userId: string;

  @Column({ type: 'text', nullable: true })
  inputSummary: string;

  @Column({ type: 'text', nullable: true })
  outputSummary: string;

  @Column({ default: 0 })
  durationMs: number;

  @Column({ default: 0 })
  inputTokens: number;

  @Column({ default: 0 })
  outputTokens: number;

  @Column({ default: false })
  success: boolean;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @CreateDateColumn()
  createdAt: Date;
}
