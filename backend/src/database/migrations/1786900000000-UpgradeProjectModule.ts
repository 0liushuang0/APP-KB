import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

export class UpgradeProjectModule1786900000000 implements MigrationInterface {
  name = 'UpgradeProjectModule1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const addCol = async (table: string, col: string, type: string) => {
      await queryRunner.query(compat(queryRunner, `ALTER TABLE "${table}" ADD COLUMN "${col}" ${type}`)).catch(() => {});
    };

    // projects 新字段
    await addCol('projects', 'projectType', 'varchar');
    await addCol('projects', 'actualStartDate', 'date');
    await addCol('projects', 'actualEndDate', 'date');
    await addCol('projects', 'businessStatus', 'varchar');
    await addCol('projects', 'progress', 'integer DEFAULT 0');
    await addCol('projects', 'health', 'varchar');

    // project_stages 新字段
    await addCol('project_stages', 'assignedTo', 'varchar');
    await addCol('project_stages', 'deliverable', 'varchar');
    await addCol('project_stages', 'acceptanceResult', 'varchar');
    await addCol('project_stages', 'sortOrder', 'integer DEFAULT 0');

    // project_risks 新字段
    await addCol('project_risks', 'riskType', 'varchar');
    await addCol('project_risks', 'probability', 'varchar');
    await addCol('project_risks', 'impact', 'varchar');
    await addCol('project_risks', 'owner', 'varchar');

    // project_tasks 新表
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "project_tasks" (
        "id" varchar PRIMARY KEY NOT NULL,
        "projectId" varchar NOT NULL,
        "stageId" varchar,
        "title" varchar NOT NULL,
        "description" text,
        "assignedTo" varchar,
        "collaborators" varchar,
        "startDate" date,
        "endDate" date,
        "progress" integer DEFAULT 0,
        "priority" varchar DEFAULT 'medium',
        "status" varchar DEFAULT 'pending',
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `));
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_tasks_projectId" ON "project_tasks" ("projectId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_tasks_stageId" ON "project_tasks" ("stageId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `DROP TABLE IF EXISTS "project_tasks"`));
  }
}
