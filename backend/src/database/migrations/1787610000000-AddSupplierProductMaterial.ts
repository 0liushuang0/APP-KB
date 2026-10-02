import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 供应产品挂物料主档。
 *
 * supplier_products 加 materialId（关联 materials，做同规格跨厂家比价）
 * 与 specs（结构化规格 JSON，用于算 specSignature 自动匹配物料）。
 */
export class AddSupplierProductMaterial1787610000000 implements MigrationInterface {
  name = 'AddSupplierProductMaterial1787610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `ALTER TABLE "supplier_products" ADD COLUMN "materialId" varchar`)).catch(() => {});
    await queryRunner.query(compat(queryRunner, `ALTER TABLE "supplier_products" ADD COLUMN "specs" text`)).catch(() => {});
    await queryRunner
      .query(`CREATE INDEX IF NOT EXISTS "IDX_supplier_products_materialId" ON "supplier_products" ("materialId")`)
      .catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_supplier_products_materialId"`).catch(() => {});
    // SQLite 早期不支持 DROP COLUMN；PG 可 drop。留列无副作用，down 留空也安全。
    await queryRunner.query(`ALTER TABLE "supplier_products" DROP COLUMN "specs"`).catch(() => {});
    await queryRunner.query(`ALTER TABLE "supplier_products" DROP COLUMN "materialId"`).catch(() => {});
  }
}
