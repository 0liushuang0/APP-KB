import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 新增新模块数据表：标签、回收站、AI反馈、AI预算、Prompt模板、文档版本。
 *
 * 手写而非 migration:generate 的产物，避免自动生成版本触发
 * SQLite 关联表重建流程。
 */
export class AddNewModules1786000000000 implements MigrationInterface {
  name = 'AddNewModules1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 标签
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "tags" (
        "id" varchar PRIMARY KEY NOT NULL,
        "name" varchar NOT NULL,
        "color" varchar,
        "category" varchar,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `));
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tags_name" ON "tags" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tags_category" ON "tags" ("category")`,
    );

    // 标签关联（多态）
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "tag_relations" (
        "id" varchar PRIMARY KEY NOT NULL,
        "tagId" varchar NOT NULL,
        "entityType" varchar NOT NULL,
        "entityId" varchar NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `));
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tag_relations_entity" ON "tag_relations" ("entityType", "entityId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tag_relations_tagId" ON "tag_relations" ("tagId")`,
    );

    // 回收站
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "recycle_bin" (
        "id" varchar PRIMARY KEY NOT NULL,
        "entityType" varchar NOT NULL,
        "entityId" varchar NOT NULL,
        "entityData" text NOT NULL,
        "deletedBy" varchar,
        "deletedAt" datetime NOT NULL DEFAULT (datetime('now')),
        "expiresAt" datetime
      )
    `));
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_recycle_bin_entityType" ON "recycle_bin" ("entityType")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_recycle_bin_expiresAt" ON "recycle_bin" ("expiresAt")`,
    );

    // AI 反馈
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "ai_feedbacks" (
        "id" varchar PRIMARY KEY NOT NULL,
        "messageId" varchar NOT NULL,
        "rating" varchar(20) NOT NULL,
        "comment" text,
        "sessionId" varchar NOT NULL,
        "module" varchar,
        "userId" varchar,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `));
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_feedbacks_createdAt" ON "ai_feedbacks" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_feedbacks_messageId" ON "ai_feedbacks" ("messageId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_feedbacks_sessionId" ON "ai_feedbacks" ("sessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_feedbacks_module" ON "ai_feedbacks" ("module")`,
    );

    // AI 预算
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "ai_budgets" (
        "id" varchar PRIMARY KEY NOT NULL,
        "userId" varchar NOT NULL,
        "monthlyLimit" decimal(10,2) NOT NULL DEFAULT (0),
        "currentUsage" decimal(10,2) NOT NULL DEFAULT (0),
        "alertThreshold" decimal(3,2) NOT NULL DEFAULT (0.8),
        "period" varchar(7) NOT NULL,
        "isActive" boolean NOT NULL DEFAULT (1),
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `));
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ai_budgets_user_period" ON "ai_budgets" ("userId", "period")`,
    );

    // Prompt 模板
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "prompt_templates" (
        "id" varchar PRIMARY KEY NOT NULL,
        "name" varchar NOT NULL,
        "content" text NOT NULL,
        "category" varchar,
        "variables" text,
        "isDefault" boolean NOT NULL DEFAULT (0),
        "usageCount" integer NOT NULL DEFAULT (0),
        "userId" varchar,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `));
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_prompt_templates_name" ON "prompt_templates" ("name")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_prompt_templates_category" ON "prompt_templates" ("category")`,
    );

    // 文档版本
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "document_versions" (
        "id" varchar PRIMARY KEY NOT NULL,
        "documentId" varchar NOT NULL,
        "version" integer NOT NULL DEFAULT (1),
        "fileName" varchar NOT NULL,
        "fileKey" varchar NOT NULL,
        "fileSize" integer NOT NULL DEFAULT (0),
        "changeSummary" text,
        "createdBy" varchar,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `));
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_document_versions_documentId" ON "document_versions" ("documentId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `DROP TABLE IF EXISTS "document_versions"`));
    await queryRunner.query(compat(queryRunner, `DROP TABLE IF EXISTS "prompt_templates"`));
    await queryRunner.query(compat(queryRunner, `DROP TABLE IF EXISTS "ai_budgets"`));
    await queryRunner.query(compat(queryRunner, `DROP TABLE IF EXISTS "ai_feedbacks"`));
    await queryRunner.query(compat(queryRunner, `DROP TABLE IF EXISTS "recycle_bin"`));
    await queryRunner.query(compat(queryRunner, `DROP TABLE IF EXISTS "tag_relations"`));
    await queryRunner.query(compat(queryRunner, `DROP TABLE IF EXISTS "tags"`));
  }
}
