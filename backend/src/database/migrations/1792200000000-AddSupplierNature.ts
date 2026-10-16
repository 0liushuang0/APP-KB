import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 供应商性质与工序能力：
 * · nature：finished=成品件供应商 / process=工序外协供应商 / both=两者
 * · processTags：外协厂的工序能力标签（热处理、发黑、焊接…），simple-array
 * 供「外协加工」页按性质与工序能力过滤候选厂家。
 */
export class AddSupplierNature1792200000000 implements MigrationInterface {
  name = 'AddSupplierNature1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('suppliers', 'nature'))) {
      await queryRunner.query(`ALTER TABLE "suppliers" ADD COLUMN "nature" varchar NULL`);
    }
    if (!(await queryRunner.hasColumn('suppliers', 'processTags'))) {
      await queryRunner.query(`ALTER TABLE "suppliers" ADD COLUMN "processTags" varchar NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const col of ['nature', 'processTags']) {
      if (await queryRunner.hasColumn('suppliers', col)) {
        await queryRunner.query(`ALTER TABLE "suppliers" DROP COLUMN "${col}"`);
      }
    }
  }
}
