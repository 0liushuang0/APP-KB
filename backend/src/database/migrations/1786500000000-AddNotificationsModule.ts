import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

export class AddNotificationsModule1786500000000 implements MigrationInterface {
  name = 'AddNotificationsModule1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" varchar PRIMARY KEY NOT NULL,
        "type" varchar NOT NULL DEFAULT 'system',
        "title" varchar NOT NULL,
        "content" text,
        "recipientId" varchar NOT NULL,
        "linkUrl" varchar,
        "read" boolean NOT NULL DEFAULT 0,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `));
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_notifications_recipientId" ON "notifications" ("recipientId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_notifications_recipient_read" ON "notifications" ("recipientId", "read")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `DROP TABLE IF EXISTS "notifications"`));
  }
}
