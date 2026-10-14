import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** document_links 增加 afterSaleId：售后工单挂自己的附件（此前误挂客户名下，列表混入全链路资料） */
export class AddAfterSaleLink1791400000000 implements MigrationInterface {
  name = 'AddAfterSaleLink1791400000000';

  async up(query: QueryRunner): Promise<void> {
    if (!(await query.hasColumn('document_links', 'afterSaleId'))) {
      await query.addColumn(
        'document_links',
        new TableColumn({ name: 'afterSaleId', type: 'varchar', isNullable: true }),
      );
    }
  }

  async down(query: QueryRunner): Promise<void> {
    if (await query.hasColumn('document_links', 'afterSaleId')) {
      await query.dropColumn('document_links', 'afterSaleId');
    }
  }
}
