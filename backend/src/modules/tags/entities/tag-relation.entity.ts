import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tag } from './tag.entity';

@Entity('tag_relations')
@Index(['entityType', 'entityId'])
@Index(['tagId'])
export class TagRelation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tagId: string;

  @ManyToOne(() => Tag, (tag) => tag.relations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tagId' })
  tag: Tag;

  @Column()
  entityType: string;

  @Column()
  entityId: string;

  @CreateDateColumn()
  createdAt: Date;
}
