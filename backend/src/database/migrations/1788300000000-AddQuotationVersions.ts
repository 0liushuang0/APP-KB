import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 报价版本快照（评估报告 P1"方案报价冻结版本"）。
 *
 * 修改已送审/已审核的报价时，旧版本整体存档（头字段 + 明细数组 JSON），
 * 客户拿到的每一版报价都能回查，避免"系统里改了历史、对不上客户手里的纸"。
 */
export class AddQuotationVersions1788300000000 implements MigrationInterface {
  name = 'AddQuotationVersions1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('quotation_versions');
    if (!table) {
      await queryRunner.query(compat(queryRunner, `
        CREATE TABLE "quotation_versions" (
          "id" varchar PRIMARY KEY NOT NULL,
          "quotationId" varchar NOT NULL,
          "version" integer NOT NULL,
          "snapshot" text NOT NULL,
          "itemsSnapshot" text,
          "changedBy" varchar,
          "note" varchar,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
        )`));
      await queryRunner.query(
        `CREATE INDEX "IDX_quotation_versions_quotationId" ON "quotation_versions" ("quotationId")`);
    }
    if ((queryRunner.connection.options as { type?: string }).type === 'postgres') {
      const t = await queryRunner.getTable('quotation_versions');
      if (t && t.findColumnByName('id') && !t.findColumnByName('id')!.default) {
        await queryRunner.query(
          `ALTER TABLE "quotation_versions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('quotation_versions');
    if (table) {
      await queryRunner.query(compat(queryRunner, `DROP TABLE "quotation_versions"`));
    }
  }
}
