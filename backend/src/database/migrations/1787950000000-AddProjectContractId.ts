import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 补 projects.contractId 列。
 *
 * 实体早就有 contractId（从合同立项时回填整条上游链依赖它），但迁移链里
 * 从来没有加过这一列 —— 现网 SQLite 库能跑是因为历史上被手工/同步机制
 * 补过列；全新建库（尤其 PostgreSQL 切换）会缺列，"报价转合同再立项"
 * 在运行时直接报错。这里补上，已存在的库跳过。
 */
export class AddProjectContractId1787950000000 implements MigrationInterface {
  name = 'AddProjectContractId1787950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('projects');
    if (table && !table.findColumnByName('contractId')) {
      await queryRunner.query(compat(queryRunner,
        `ALTER TABLE "projects" ADD COLUMN "contractId" varchar`));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('projects');
    if (table && table.findColumnByName('contractId')) {
      await queryRunner.query(compat(queryRunner,
        `ALTER TABLE "projects" DROP COLUMN "contractId"`));
    }
  }
}
