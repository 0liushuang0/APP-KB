import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export type TimelineStage =
  | 'requirement'
  | 'analysis'
  | 'solution'
  | 'quotation'
  | 'review'
  | 'submit';

export type TimelineAction =
  | 'create'
  | 'upload'
  | 'analyze'
  | 'edit'
  | 'approve'
  | 'reject'
  | 'submit'
  | 'comment';

@Entity('project_timeline')
export class ProjectTimeline {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  projectId: string;

  @Column()
  stage: TimelineStage;

  @Column()
  action: TimelineAction;

  @Column({ nullable: true })
  actorId: string;

  @Column({ nullable: true })
  actorName: string;

  @Column({ nullable: true })
  documentId: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'text', nullable: true })
  metadata: string;

  @CreateDateColumn()
  createdAt: Date;
}
