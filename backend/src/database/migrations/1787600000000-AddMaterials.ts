import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 物料主档表（外购件标准库）。
 *
 * 一个物料代表一种"标准外购件"，多家供应商的供应产品(supplier_products.materialId)
 * 挂到同一物料下，用于同规格跨厂家比价。category 复用 supplier_categories。
 */
export class AddMaterials1787600000000 implements MigrationInterface {
  name = 'AddMaterials1787600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, 
      `CREATE TABLE IF NOT EXISTS "materials" (
        "id" varchar PRIMARY KEY NOT NULL,
        "materialCode" varchar NOT NULL,
        "name" varchar NOT NULL,
        "category" varchar,
        "specs" text,
        "specSignature" varchar,
        "unit" varchar NOT NULL DEFAULT '件',
        "standardPrice" decimal(14, 2),
        "description" text,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )`));
    await queryRunner
      .query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_materials_materialCode" ON "materials" ("materialCode")`)
      .catch(() => {});
    await queryRunner
      .query(`CREATE INDEX IF NOT EXISTS "IDX_materials_category" ON "materials" ("category")`)
      .catch(() => {});
    await queryRunner
      .query(`CREATE INDEX IF NOT EXISTS "IDX_materials_specSignature" ON "materials" ("specSignature")`)
      .catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `DROP TABLE IF EXISTS "materials"`)).catch(() => {});
  }
}
