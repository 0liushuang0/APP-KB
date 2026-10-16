import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 工作任务表：记录业务流程之外的日常工作（会议/出差/报告/协作/资料整理…）。
 *
 * document_links 同步加 workTaskId 列，附件复用统一的
 * source（输入）/ deliverable（输出）口径 —— 与业务单据同一套
 * EntityFileUpload / 附件徽标 / 批量下载能力。
 */
export class CreateWorkTasks1791500000000 implements MigrationInterface {
  name = 'CreateWorkTasks1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "work_tasks" (
        "id" varchar PRIMARY KEY NOT NULL,
        "taskNo" varchar NOT NULL,
        "title" varchar NOT NULL,
        "content" text,
        "category" varchar NOT NULL DEFAULT 'daily',
        "workDate" date,
        "status" varchar NOT NULL DEFAULT 'todo',
        "priority" varchar NOT NULL DEFAULT 'medium',
        "sourcePerson" varchar,
        "deliverTo" varchar,
        "spentHours" numeric,
        "ownerId" varchar,
        "departmentId" varchar,
        "visibility" varchar NOT NULL DEFAULT 'private',
        "groupIds" varchar,
        "roleCodes" varchar,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `));
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_work_tasks_taskNo" ON "work_tasks" ("taskNo")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_work_tasks_ownerId" ON "work_tasks" ("ownerId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_work_tasks_workDate" ON "work_tasks" ("workDate")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_work_tasks_status" ON "work_tasks" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_work_tasks_category" ON "work_tasks" ("category")`,
    );

    if (!(await queryRunner.hasColumn('document_links', 'workTaskId'))) {
      await queryRunner.query(
        `ALTER TABLE "document_links" ADD COLUMN "workTaskId" varchar NULL`,
      );
    }

    // PG 下 id 列必须有默认值：@PrimaryGeneratedColumn('uuid') 的 insert
    // 不带 id、靠数据库生成（SQLite 走应用侧生成，无需默认值）。
    if ((queryRunner.connection.options as { type?: string }).type === 'postgres') {
      await queryRunner.query(
        `ALTER TABLE "work_tasks" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('document_links', 'workTaskId')) {
      await queryRunner.query(`ALTER TABLE "document_links" DROP COLUMN "workTaskId"`);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "work_tasks"`);
  }
}
