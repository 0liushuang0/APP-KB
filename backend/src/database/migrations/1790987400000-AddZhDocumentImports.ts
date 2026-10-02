import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddZhDocumentImports1790987400000 implements MigrationInterface {
  name = 'AddZhDocumentImports1790987400000';

  async up(query: QueryRunner): Promise<void> {
    if (await query.hasTable('zh_document_imports')) return;
    const postgres = query.connection.options.type === 'postgres';
    await query.createTable(new Table({
      name: 'zh_document_imports',
      columns: [
        { name: 'id', type: postgres ? 'uuid' : 'varchar', isPrimary: true },
        { name: 'source', type: 'varchar' },
        { name: 'externalId', type: 'varchar' },
        { name: 'contentHash', type: 'varchar' },
        { name: 'documentId', type: 'varchar' },
        { name: 'revision', type: 'integer', default: 1 },
        { name: 'sourceUpdatedAt', type: 'varchar' },
        { name: 'projectRef', type: 'varchar', isNullable: true },
        { name: 'createdAt', type: postgres ? 'timestamp' : 'datetime', default: 'CURRENT_TIMESTAMP' },
      ],
    }));
    await query.createIndex('zh_document_imports', new TableIndex({
      name: 'IDX_zh_import_content', columnNames: ['source', 'externalId', 'contentHash', 'sourceUpdatedAt'], isUnique: true,
    }));
    await query.createIndex('zh_document_imports', new TableIndex({
      name: 'IDX_zh_import_revision', columnNames: ['source', 'externalId', 'revision'], isUnique: true,
    }));
  }

  async down(query: QueryRunner): Promise<void> {
    await query.dropTable('zh_document_imports');
  }
}
