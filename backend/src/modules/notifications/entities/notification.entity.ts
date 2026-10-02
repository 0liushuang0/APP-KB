import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 通知实体。
 *
 * 单机个人版只有一个用户，通知仍然有意义——它是事件的持久化记录，
 * 用户不一定一直盯着页面，回来后能在通知中心看到发生了什么。
 *
 * type: approval（审批）/ document（文档）/ ai（AI）/ system（系统）
 * linkUrl: 点击跳转的前端路由（如 /approvals、/documents/xxx）
 */
@Entity('notifications')
@Index(['recipientId'])
@Index(['recipientId', 'read'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', default: 'system' })
  type: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  content: string;

  @Column()
  recipientId: string;

  @Column({ type: 'varchar', nullable: true })
  linkUrl: string;

  @Column({ default: false })
  read: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
