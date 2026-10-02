import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 标准方案目录：给 solutions 增加 directory（斜杠分层路径，如 普碳钢/酸洗线），
 * 前端据此还原成父/子目录树用于左侧导航。
 */
export class AddSolutionDirectory1787200000000 implements MigrationInterface {
  name = 'AddSolutionDirectory1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(compat(queryRunner, `ALTER TABLE "solutions" ADD COLUMN "directory" varchar`)).catch(() => {});
  }

  public async down(): Promise<void> {
    // SQLite 早期不支持 DROP COLUMN；留空字段无副作用
  }
}
