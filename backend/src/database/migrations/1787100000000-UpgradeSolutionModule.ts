import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 标准方案库 P1 升级：给 solutions 补齐编号、方案类型、关键参数、场景、价格区间、交付周期等字段，
 * 并把旧状态 approved 归一到新的生命周期 published，历史数据回填方案编号与方案类型。
 */
export class UpgradeSolutionModule1787100000000 implements MigrationInterface {
  name = 'UpgradeSolutionModule1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const addCol = async (col: string, type: string) => {
      await queryRunner.query(compat(queryRunner, `ALTER TABLE "solutions" ADD COLUMN "${col}" ${type}`)).catch(() => {});
    };

    await addCol('solutionNo', 'varchar');
    await addCol('solutionType', 'varchar');
    await addCol('scenario', 'text');
    await addCol('keyParams', 'text');
    await addCol('paramSummary', 'text');
    await addCol('priceRange', 'varchar');
    await addCol('deliveryCycle', 'varchar');

    // 历史数据：默认归为标准方案
    await queryRunner
      .query(`UPDATE "solutions" SET "solutionType" = 'standard' WHERE "solutionType" IS NULL`)
      .catch(() => {});

    // 状态生命周期：旧的 approved 视为已发布
    await queryRunner
      .query(`UPDATE "solutions" SET "status" = 'published' WHERE "status" = 'approved'`)
      .catch(() => {});

    // 回填方案编号：按 rowid 生成 SOL-<当前年>-<3位序号>，仅补空缺
    await queryRunner.query(compat(queryRunner, 
        `UPDATE "solutions" SET "solutionNo" = 'SOL-' || strftime('%Y','now') || '-' || printf('%03d', "rowid") WHERE "solutionNo" IS NULL OR "solutionNo" = ''`))
      .catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // SQLite 早期不支持 DROP COLUMN；回滚仅还原状态，字段留存无副作用
    await queryRunner
      .query(`UPDATE "solutions" SET "status" = 'approved' WHERE "status" = 'published'`)
      .catch(() => {});
  }
}
