import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 报价增加商务条款：付款条件、交货期（天）、质保月数。
 *
 * 合同的这三项原来只能在签合同时重新手填 —— 报价阶段根本没有这些字段，无处可传。
 * 报价里谈定的条款随「生成合同」带过去：交货日期 = 签约日 + 交货期天数。
 */
export class AddQuotationCommercialTerms1792000000000 implements MigrationInterface {
  name = 'AddQuotationCommercialTerms1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('quotations', 'paymentTerms'))) {
      await queryRunner.query(`ALTER TABLE "quotations" ADD COLUMN "paymentTerms" text NULL`);
    }
    if (!(await queryRunner.hasColumn('quotations', 'deliveryDays'))) {
      await queryRunner.query(`ALTER TABLE "quotations" ADD COLUMN "deliveryDays" integer NULL`);
    }
    if (!(await queryRunner.hasColumn('quotations', 'warrantyMonths'))) {
      await queryRunner.query(`ALTER TABLE "quotations" ADD COLUMN "warrantyMonths" integer NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const c of ['paymentTerms', 'deliveryDays', 'warrantyMonths']) {
      if (await queryRunner.hasColumn('quotations', c)) {
        await queryRunner.query(`ALTER TABLE "quotations" DROP COLUMN "${c}"`);
      }
    }
  }
}
