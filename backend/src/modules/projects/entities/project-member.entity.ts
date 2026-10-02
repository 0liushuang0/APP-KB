import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 项目成员：明确的协作授权单元。
 *
 * 之前项目可见性靠 visibility/部门/分组（"看得到"），但看得到不等于能参与；
 * 任务负责人又是自由文本，无法校验。成员表把"谁在这个项目、什么角色"落成
 * 数据：manager 可编辑项目与任务，member 可编辑任务，viewer 只读。
 */
@Entity('project_members')
@Index(['projectId'])
@Index(['userId'])
export class ProjectMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  projectId: string;

  @Column()
  userId: string;

  /** manager | member | viewer */
  @Column({ default: 'member' })
  role: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
