import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { Visibility } from '../../../common/constants/status.enums';

@Entity('param_templates')
export class ParamTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  category: string;

  @Column({ type: 'text' })
  fields: string;

  @Column({ default: 1 })
  version: number;

  @Column({ default: 'approved' })
  status: string;

  @Column({ nullable: true })
  ownerId: string;

  @Column({ nullable: true })
  departmentId: string;

  @Column({ type: 'varchar', default: 'public' })
  visibility: Visibility;

  @Column('simple-array', { nullable: true })
  groupIds: string[];

  @Column('simple-array', { nullable: true })
  roleCodes: string[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
