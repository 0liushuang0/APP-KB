import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('recycle_bin')
@Index(['entityType'])
@Index(['expiresAt'])
export class RecycleBinItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  entityType: string;

  @Column()
  entityId: string;

  @Column({ type: 'simple-json' })
  entityData: Record<string, any>;

  @Column({ nullable: true })
  deletedBy: string;

  @CreateDateColumn()
  deletedAt: Date;

  // 交给 TypeORM 按驱动映射 Date：SQLite 使用 datetime，PostgreSQL 使用 timestamp。
  @Column({ nullable: true })
  expiresAt: Date;
}
