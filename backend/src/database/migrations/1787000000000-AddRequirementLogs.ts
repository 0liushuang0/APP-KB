import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 需求记录表：取代「需求变更 = 创建新版本」，改为在同一条需求下累加沟通/变更/确认记录。
 * 旧的 version / isCurrent / changeReason 等字段保留不动，只是不再产生新版本。
 */
export class AddRequirementLogs1787000000000 implements MigrationInterface {
  name = 'AddRequirementLogs1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "requirement_logs" (
        "id" varchar PRIMARY KEY NOT NULL,
        "requirementId" varchar NOT NULL,
        "type" varchar NOT NULL DEFAULT 'communication',
        "content" text NOT NULL,
        "actorId" varchar,
        "actorName" varchar,
        "metadata" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `));
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_req_logs_requirementId" ON "requirement_logs" ("requirementId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `DROP TABLE IF EXISTS "requirement_logs"`));
  }
}
