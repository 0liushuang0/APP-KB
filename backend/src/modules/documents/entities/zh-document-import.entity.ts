import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Immutable source revisions point to normal, permission-protected documents. */
@Entity('zh_document_imports')
@Index(['source', 'externalId', 'contentHash', 'sourceUpdatedAt'], { unique: true })
@Index(['source', 'externalId', 'revision'], { unique: true })
export class ZhDocumentImport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  source: string;

  @Column()
  externalId: string;

  @Column()
  contentHash: string;

  @Column()
  documentId: string;

  @Column({ default: 1 })
  revision: number;

  @Column()
  sourceUpdatedAt: string;

  @Column({ nullable: true })
  projectRef: string;

  @CreateDateColumn()
  createdAt: Date;
}
