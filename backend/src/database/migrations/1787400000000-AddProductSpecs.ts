import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 产品技术参数：给 products 增加 specs（JSON 数组）。
 *
 * 此前技术参数只存在于描述文本的 [规格] 段（如化涂机），其他叶子产品
 * 没有结构化入口；现在每个产品（尤其最终子类产品）都可维护自己的参数表。
 */
export class AddProductSpecs1787400000000 implements MigrationInterface {
  name = 'AddProductSpecs1787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `ALTER TABLE "products" ADD COLUMN "specs" text`)).catch(() => {});
  }

  public async down(): Promise<void> {
    // SQLite 早期不支持 DROP COLUMN；留空字段无副作用
  }
}
