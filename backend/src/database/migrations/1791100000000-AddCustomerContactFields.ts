import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** 客户增加官方邮箱、官方电话、邮编（均可空） */
export class AddCustomerContactFields1791100000000 implements MigrationInterface {
  name = 'AddCustomerContactFields1791100000000';

  async up(query: QueryRunner): Promise<void> {
    for (const name of ['email', 'phone', 'postalCode']) {
      if (!(await query.hasColumn('customers', name))) {
        await query.addColumn('customers', new TableColumn({ name, type: 'varchar', isNullable: true }));
      }
    }
  }

  async down(query: QueryRunner): Promise<void> {
    for (const name of ['postalCode', 'phone', 'email']) {
      if (await query.hasColumn('customers', name)) await query.dropColumn('customers', name);
    }
  }
}
