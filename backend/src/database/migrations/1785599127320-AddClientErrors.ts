import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 新增前端错误日志表。
 *
 * 手写而非 migration:generate 的产物：自动生成的版本会连带重建
 * user_roles / user_group_members 两张关联表（TypeORM 的 SQLite 驱动
 * 一发现元数据差异就走 "建临时表→搬数据→换名" 的重建流程）。
 * 升级客户现场的库时，没必要为了加一张新表去动承载权限关系的表。
 */
export class AddClientErrors1785599127320 implements MigrationInterface {
  name = 'AddClientErrors1785599127320';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "client_errors" (
        "id" varchar PRIMARY KEY NOT NULL,
        "message" text NOT NULL,
        "stack" text,
        "componentStack" text,
        "scope" varchar,
        "url" text,
        "userAgent" text,
        "userId" varchar,
        "fingerprint" varchar,
        "occurrenceCount" integer NOT NULL DEFAULT (1),
        "lastOccurredAt" datetime,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `));
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_errors_fingerprint" ON "client_errors" ("fingerprint")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_errors_createdAt" ON "client_errors" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_client_errors_createdAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_client_errors_fingerprint"`);
    await queryRunner.query(compat(queryRunner, `DROP TABLE IF EXISTS "client_errors"`));
  }
}
