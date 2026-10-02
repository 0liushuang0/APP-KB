import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 项目协作两件套：
 *
 * 1. project_members —— 项目成员表。此前"分组可见"只解决看得到，
 *    看得到的人未必能参与；成员表给出明确的"谁在这个项目里、什么角色"
 *    （manager 可编辑 / member 可编辑任务 / viewer 只读）。
 * 2. project_tasks.assignedUserId —— 任务负责人账号绑定。此前负责人是
 *    自由文本，无法校验、无法通知；绑定账号后分配/改派可推送站内通知。
 */
export class AddProjectMembersAndTaskAssignee1788000000000 implements MigrationInterface {
  name = 'AddProjectMembersAndTaskAssignee1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('project_members');
    if (!table) {
      await queryRunner.query(compat(queryRunner, `
        CREATE TABLE "project_members" (
          "id" varchar PRIMARY KEY NOT NULL,
          "projectId" varchar NOT NULL,
          "userId" varchar NOT NULL,
          "role" varchar NOT NULL DEFAULT 'member',
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )`));
      await queryRunner.query(
        `CREATE UNIQUE INDEX "IDX_project_members_project_user" ON "project_members" ("projectId", "userId")`);
      await queryRunner.query(
        `CREATE INDEX "IDX_project_members_userId" ON "project_members" ("userId")`);
    }
    const tasks = await queryRunner.getTable('project_tasks');
    if (tasks && !tasks.findColumnByName('assignedUserId')) {
      await queryRunner.query(compat(queryRunner,
        `ALTER TABLE "project_tasks" ADD COLUMN "assignedUserId" varchar`));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tasks = await queryRunner.getTable('project_tasks');
    if (tasks && tasks.findColumnByName('assignedUserId')) {
      await queryRunner.query(compat(queryRunner,
        `ALTER TABLE "project_tasks" DROP COLUMN "assignedUserId"`));
    }
    const table = await queryRunner.getTable('project_members');
    if (table) {
      await queryRunner.query(compat(queryRunner, `DROP TABLE "project_members"`));
    }
  }
}
