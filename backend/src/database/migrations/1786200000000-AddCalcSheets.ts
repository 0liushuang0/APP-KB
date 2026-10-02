import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 新增 calc_sheets 表：存储Luckysheet格式的计算表
 */
export class AddCalcSheets1786200000000 implements MigrationInterface {
  name = 'AddCalcSheets1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE "calc_sheets" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "file_key" TEXT NOT NULL,
        "file_name" TEXT NOT NULL,
        "mime_type" TEXT,
        "file_size" INTEGER DEFAULT 0,
        "sheet_data" TEXT,
        "template_code" TEXT,
        "related_requirement_id" TEXT,
        "related_proposal_id" TEXT,
        "related_quotation_id" TEXT,
        "customer_id" TEXT,
        "version" INTEGER DEFAULT 1,
        "change_log" TEXT,
        "created_by" TEXT,
        "created_by_name" TEXT,
        "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `));

    await queryRunner.query(
      `CREATE INDEX "idx_calc_sheets_requirement" ON "calc_sheets" ("related_requirement_id")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_calc_sheets_template" ON "calc_sheets" ("template_code")`
    );
    await queryRunner.query(
      `CREATE INDEX "idx_calc_sheets_customer" ON "calc_sheets" ("customer_id")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_calc_sheets_customer"`);
    await queryRunner.query(`DROP INDEX "idx_calc_sheets_template"`);
    await queryRunner.query(`DROP INDEX "idx_calc_sheets_requirement"`);
    await queryRunner.query(compat(queryRunner, `DROP TABLE "calc_sheets"`));
  }
}
