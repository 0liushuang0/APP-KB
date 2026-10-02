import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 报价明细挂上产品库引用。
 *
 * 现状：quotation_items 只有 name 这个自由文本，34 条明细全靠人手打产品名。
 * 后果是产品库和报价之间没有任何可追溯的联系 ——
 *   · 产品详情里回答不了「这个产品被哪几单报过价、报了多少钱」
 *   · 改了产品编码或名称，历史报价对不上号
 *   · 想统计某型号的成交价区间，只能靠字符串模糊匹配
 *
 * 加一列 productId（可空）：新明细从产品库选，老明细保持原样不动。
 * 不设外键约束 —— 产品被删除时报价明细应当保留历史，
 * 而不是被级联删掉或阻止删除。
 */
export class AddQuotationItemProductId1786210000000 implements MigrationInterface {
  name = 'AddQuotationItemProductId1786210000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('quotation_items');
    if (table && !table.findColumnByName('productId')) {
      await queryRunner.query(`ALTER TABLE "quotation_items" ADD "productId" varchar`);
      await queryRunner.query(
        `CREATE INDEX "IDX_quotation_items_productId" ON "quotation_items" ("productId")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('quotation_items');
    if (table?.findColumnByName('productId')) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_quotation_items_productId"`);
      await queryRunner.query(`ALTER TABLE "quotation_items" DROP COLUMN "productId"`);
    }
  }
}
