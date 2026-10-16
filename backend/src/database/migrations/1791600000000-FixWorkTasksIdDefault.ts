import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 修复 work_tasks.id 缺失默认值。
 *
 * 1791500000000 建表时 PG 方言下没给 id 列加 DEFAULT gen_random_uuid()，
 * 导致 POST /work-tasks 报「null value in column "id"」。SQLite 不需要
 * （TypeORM 在应用侧生成 uuid），PG 必须靠数据库默认值。
 */
export class FixWorkTasksIdDefault1791600000000 implements MigrationInterface {
  name = 'FixWorkTasksIdDefault1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if ((queryRunner.connection.options as { type?: string }).type !== 'postgres') return;
    const col = await queryRunner.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name = 'work_tasks' AND column_name = 'id'`,
    );
    if (!col?.[0]?.column_default) {
      await queryRunner.query(
        `ALTER TABLE "work_tasks" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if ((queryRunner.connection.options as { type?: string }).type !== 'postgres') return;
    await queryRunner.query(`ALTER TABLE "work_tasks" ALTER COLUMN "id" DROP DEFAULT`);
  }
}
