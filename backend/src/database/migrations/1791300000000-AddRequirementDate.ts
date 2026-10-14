import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** 需求增加「需求时间」：客户发出需求、我方收到的时间（可空 date） */
export class AddRequirementDate1791300000000 implements MigrationInterface {
  name = 'AddRequirementDate1791300000000';

  async up(query: QueryRunner): Promise<void> {
    if (!(await query.hasColumn('requirements', 'requirementDate'))) {
      await query.addColumn(
        'requirements',
        new TableColumn({ name: 'requirementDate', type: 'date', isNullable: true }),
      );
    }
  }

  async down(query: QueryRunner): Promise<void> {
    if (await query.hasColumn('requirements', 'requirementDate')) {
      await query.dropColumn('requirements', 'requirementDate');
    }
  }
}
