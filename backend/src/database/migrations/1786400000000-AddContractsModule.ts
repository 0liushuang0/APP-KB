import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 新增 contracts 表 + document_links 加 contractId 列。
 */
export class AddContractsModule1786400000000 implements MigrationInterface {
  name = 'AddContractsModule1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "contracts" (
        "id" varchar PRIMARY KEY NOT NULL,
        "contractNo" varchar NOT NULL,
        "title" varchar,
        "customerId" varchar,
        "quotationId" varchar,
        "amount" decimal(14,2) DEFAULT 0,
        "signedDate" date,
        "effectiveDate" date,
        "expiryDate" date,
        "paymentTerms" text,
        "deliveryTerms" text,
        "status" varchar NOT NULL DEFAULT 'draft',
        "ownerId" varchar,
        "departmentId" varchar,
        "visibility" varchar NOT NULL DEFAULT 'public',
        "groupIds" text,
        "roleCodes" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `));
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_contracts_customerId" ON "contracts" ("customerId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_contracts_quotationId" ON "contracts" ("quotationId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_contracts_status" ON "contracts" ("status")`);

    // document_links 加 contractId
    await queryRunner.query(compat(queryRunner, `ALTER TABLE "document_links" ADD COLUMN "contractId" varchar`)).catch(() => {});
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_document_links_contractId" ON "document_links" ("contractId")`).catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_document_links_contractId"`);
    await queryRunner.query(compat(queryRunner, `DROP TABLE IF EXISTS "contracts"`));
  }
}
