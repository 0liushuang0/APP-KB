import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('ai_feedbacks')
@Index(['createdAt'])
@Index(['messageId'])
@Index(['sessionId'])
@Index(['module'])
export class AiFeedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  messageId: string;

  @Column({ type: 'varchar', length: 20 })
  rating: 'positive' | 'negative';

  @Column({ type: 'text', nullable: true })
  comment: string;

  @Column()
  sessionId: string;

  @Column({ nullable: true })
  module: string;

  @Column({ nullable: true })
  userId: string;

  @CreateDateColumn()
  createdAt: Date;
}
