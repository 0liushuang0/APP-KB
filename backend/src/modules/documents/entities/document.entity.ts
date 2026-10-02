import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm';

export type DocumentStatus = 'pending' | 'approved' | 'rejected';
export type DocumentVisibility = 'public' | 'department' | 'group' | 'role' | 'private';
export type ArchiveType = 'RAW' | 'ORG' | 'REQ' | 'PROPOSAL' | 'QUOTATION';

@Entity('documents')
@Index(['customerId'])
@Index(['status'])
@Index(['category'])
@Index(['createdAt'])
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column()
  fileName: string;

  @Column()
  fileKey: string;

  @Column({ nullable: true })
  fileUrl: string;

  @Column({ default: 0 })
  fileSize: number;

  @Column({ nullable: true })
  mimeType: string;

  @Column({ nullable: true })
  category: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: DocumentStatus;

  @Column({ type: 'varchar', default: 'private' })
  visibility: DocumentVisibility;

  @Column({ nullable: true })
  uploaderId: string;

  @Column({ nullable: true })
  departmentId: string;

  @Column('simple-array', { nullable: true })
  groupIds: string[];

  @Column('simple-array', { nullable: true })
  roleCodes: string[];

  @Column({ nullable: true })
  approvedBy: string;

  @Column({ nullable: true })
  approvedAt: Date;

  @Column({ type: 'text', nullable: true })
  parsedText: string;

  // 客户归档相关字段
  @Column({ nullable: true })
  customerId: string;

  @Column({ nullable: true })
  archivePath: string;

  @Column({ type: 'varchar', nullable: true })
  archiveType: ArchiveType;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
