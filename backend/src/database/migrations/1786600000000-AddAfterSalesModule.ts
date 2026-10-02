import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

export class AddAfterSalesModule1786600000000 implements MigrationInterface {
  name = 'AddAfterSalesModule1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "after_sales_tickets" (
        "id" varchar PRIMARY KEY NOT NULL,
        "ticketNo" varchar NOT NULL,
        "customerId" varchar,
        "contractId" varchar,
        "projectId" varchar,
        "type" varchar NOT NULL DEFAULT 'fault',
        "title" varchar NOT NULL,
        "description" text,
        "productModel" varchar,
        "priority" varchar NOT NULL DEFAULT 'medium',
        "status" varchar NOT NULL DEFAULT 'open',
        "assignedTo" varchar,
        "resolvedAt" date,
        "resolution" text,
        "spareParts" text,
        "satisfactionScore" integer,
        "visitDate" date,
        "visitNotes" text,
        "ownerId" varchar,
        "departmentId" varchar,
        "visibility" varchar NOT NULL DEFAULT 'public',
        "groupIds" text,
        "roleCodes" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `));
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_tickets_customerId" ON "after_sales_tickets" ("customerId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_tickets_contractId" ON "after_sales_tickets" ("contractId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_tickets_projectId" ON "after_sales_tickets" ("projectId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_tickets_status" ON "after_sales_tickets" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_tickets_type" ON "after_sales_tickets" ("type")`);

    // 合同加质保字段
    await queryRunner.query(compat(queryRunner, `ALTER TABLE "contracts" ADD COLUMN "warrantyExpiryDate" date`)).catch(() => {});
    await queryRunner.query(compat(queryRunner, `ALTER TABLE "contracts" ADD COLUMN "warrantyMonths" integer`)).catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `DROP TABLE IF EXISTS "after_sales_tickets"`));
  }
}
