import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 产品型号价格表：给 products 增加 priceList（JSON 数组）。
 *
 * 一个产品系列（如 BJ 系列）下往往有多个型号（BJ125D-1450 等），
 * 每个型号需要记录成本价/参考价/标配价/销售价等多档价格，
 * 不适合为每个型号单独建一条产品记录。
 */
export class AddProductPriceList1787300000000 implements MigrationInterface {
  name = 'AddProductPriceList1787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `ALTER TABLE "products" ADD COLUMN "priceList" text`)).catch(() => {});
  }

  public async down(): Promise<void> {
    // SQLite 早期不支持 DROP COLUMN；留空字段无副作用
  }
}
