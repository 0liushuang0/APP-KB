import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * zh_document_imports.id 是 uuid 主键, 实体用 @PrimaryGeneratedColumn('uuid'):
 * PostgreSQL 下 TypeORM 依赖库端默认值生成主键, 但建表迁移没有给默认值, 平台文档导入会因 id 为空失败。
 * 与 1787900000000-PgUuidDefaults 同一做法补上 DEFAULT gen_random_uuid()(PG 13+ 内置); SQLite 由应用侧生成, 无需处理。
 */
export class ZhDocumentImportsUuidDefault1790987500000 implements MigrationInterface {
  name = 'ZhDocumentImportsUuidDefault1790987500000';

  async up(query: QueryRunner): Promise<void> {
    if (query.connection.options.type !== 'postgres') return;
    if (!(await query.hasTable('zh_document_imports'))) return;
    await query.query('ALTER TABLE "zh_document_imports" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()');
  }

  async down(query: QueryRunner): Promise<void> {
    if (query.connection.options.type !== 'postgres') return;
    if (!(await query.hasTable('zh_document_imports'))) return;
    await query.query('ALTER TABLE "zh_document_imports" ALTER COLUMN "id" DROP DEFAULT');
  }
}
