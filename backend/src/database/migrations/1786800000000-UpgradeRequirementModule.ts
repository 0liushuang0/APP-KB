import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

export class UpgradeRequirementModule1786800000000 implements MigrationInterface {
  name = 'UpgradeRequirementModule1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const addCol = async (col: string, type: string) => {
      await queryRunner.query(compat(queryRunner, `ALTER TABLE "requirements" ADD COLUMN "${col}" ${type}`)).catch(() => {});
    };
    await addCol('requirementType', 'varchar');
    await addCol('contactName', 'varchar');
    await addCol('contactPhone', 'varchar');
    await addCol('contactEmail', 'varchar');

    // 旧 category 值映射到需求来源
    await queryRunner.query(`UPDATE "requirements" SET "category" = '客户来询' WHERE "category" IN ('inquiry', 'tender', 'technical')`).catch(() => {});
    await queryRunner.query(`UPDATE "requirements" SET "category" = '其他' WHERE "category" IN ('drawing', 'contract', 'other') AND "category" IS NOT NULL`).catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {}
}
