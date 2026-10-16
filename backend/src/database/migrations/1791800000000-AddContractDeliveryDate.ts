import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 合同增加交货期（deliveryDate）：合同约定的交货日期，
 * 项目跟踪列表沿 报价→合同 链路同步显示，提醒排产与交付。
 */
export class AddContractDeliveryDate1791800000000 implements MigrationInterface {
  name = 'AddContractDeliveryDate1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('contracts', 'deliveryDate'))) {
      await queryRunner.query(`ALTER TABLE "contracts" ADD COLUMN "deliveryDate" date NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('contracts', 'deliveryDate')) {
      await queryRunner.query(`ALTER TABLE "contracts" DROP COLUMN "deliveryDate"`);
    }
  }
}
