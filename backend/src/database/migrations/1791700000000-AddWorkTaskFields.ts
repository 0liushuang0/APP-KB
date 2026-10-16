import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 工作任务补充字段：开始/截止时间、所属项目（可关联项目跟踪）、所属客户（关联客户中心）。
 */
export class AddWorkTaskFields1791700000000 implements MigrationInterface {
  name = 'AddWorkTaskFields1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const cols: Array<[string, string]> = [
      ['startDate', 'date'],
      ['dueDate', 'date'],
      ['projectId', 'varchar'],
      ['projectName', 'varchar'],
      ['customerId', 'varchar'],
    ];
    for (const [name, type] of cols) {
      if (!(await queryRunner.hasColumn('work_tasks', name))) {
        await queryRunner.query(
          `ALTER TABLE "work_tasks" ADD COLUMN "${name}" ${type} NULL`,
        );
      }
    }
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_work_tasks_customerId" ON "work_tasks" ("customerId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_work_tasks_projectId" ON "work_tasks" ("projectId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of ['startDate', 'dueDate', 'projectId', 'projectName', 'customerId']) {
      if (await queryRunner.hasColumn('work_tasks', name)) {
        await queryRunner.query(`ALTER TABLE "work_tasks" DROP COLUMN "${name}"`);
      }
    }
  }
}
