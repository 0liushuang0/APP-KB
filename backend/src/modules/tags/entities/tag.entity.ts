import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { TagRelation } from './tag-relation.entity';

@Entity('tags')
@Index(['category'])
@Index(['name'], { unique: true })
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ nullable: true })
  color: string;

  @Column({ nullable: true })
  category: string;

  @OneToMany(() => TagRelation, (rel) => rel.tag)
  relations: TagRelation[];

  @CreateDateColumn()
  createdAt: Date;
}
