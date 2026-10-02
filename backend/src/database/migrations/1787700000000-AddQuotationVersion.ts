import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 报价表加乐观锁版本号。
 *
 * 背景：多人同时打开同一张报价，后保存的人会用旧页面把先保存的人的
 * 修改整个覆盖掉（读-改-写竞争）。换成 PostgreSQL 也不会自动解决。
 *
 * 方案：quotations 增加 version 列（默认 1）。更新接口要求带上读取时
 * 的版本号，服务器比对不一致就拒绝（409 冲突），提示刷新后重试。
 * 旧数据统一从 1 开始。
 */
export class AddQuotationVersion1787700000000 implements MigrationInterface {
  name = 'AddQuotationVersion1787700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('quotations');
    if (table && !table.findColumnByName('version')) {
      await queryRunner.query(
        `ALTER TABLE "quotations" ADD "version" integer NOT NULL DEFAULT 1`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('quotations');
    if (table && table.findColumnByName('version')) {
      await queryRunner.query(`ALTER TABLE "quotations" DROP COLUMN "version"`);
    }
  }
}
