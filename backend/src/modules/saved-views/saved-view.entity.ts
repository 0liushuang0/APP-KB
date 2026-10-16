import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * 列表「保存的视图」：一组筛选条件 + 排序 + 显示哪些列，起个名字存起来，下次一点就回到这个视图。
 * shared=true 为团队视图（所有人可选用，只有创建人能改删）；isDefault=打开该列表时自动套用（每人每页一个）。
 */
@Entity('saved_views')
@Index(['page', 'ownerId'])
export class SavedView {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 列表页标识：requirements / quotations / contracts / customers / projects / proposals / after-sales / work-tasks */
  @Column()
  page: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  ownerId: string;

  @Column({ default: false })
  shared: boolean;

  @Column({ default: false })
  isDefault: boolean;

  /** JSON：{ filters, sortBy, sortOrder, hidden, pageSize } */
  @Column({ type: 'text' })
  state: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
