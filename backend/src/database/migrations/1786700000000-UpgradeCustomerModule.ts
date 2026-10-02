import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 客户模块升级：补齐规范要求的全部字段。
 * customers 表加 level/businessStatus/region/creditCode/firstCooperationDate/lastDealDate/totalDealAmount/tags
 * contact_persons 表加 department/fax/wechat/otherContact/decisionRole/birthday/remark
 * follow_up_records 表加 method/participants/customerParticipants/focusPoints/nextAction/deadline/requirementId
 * customers 表加 customerCode 列（原迁移遗漏）
 */
export class UpgradeCustomerModule1786700000000 implements MigrationInterface {
  name = 'UpgradeCustomerModule1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const addColumn = async (table: string, col: string, type: string) => {
      await queryRunner.query(compat(queryRunner, `ALTER TABLE "${table}" ADD COLUMN "${col}" ${type}`)).catch(() => {});
    };

    // customers 新字段
    await addColumn('customers', 'customerCode', 'varchar');  // 原迁移遗漏
    await addColumn('customers', 'level', 'varchar');
    await addColumn('customers', 'businessStatus', 'varchar');
    await addColumn('customers', 'region', 'varchar');
    await addColumn('customers', 'creditCode', 'varchar');
    await addColumn('customers', 'firstCooperationDate', 'date');
    await addColumn('customers', 'lastDealDate', 'date');
    await addColumn('customers', 'totalDealAmount', 'decimal(14,2) DEFAULT 0');
    await addColumn('customers', 'tags', 'text');

    // 数据迁移：把 scale 里的 A/B/C 复制到 level，然后 scale 留给企业规模
    await queryRunner.query(`UPDATE customers SET "level" = "scale" WHERE "scale" IN ('A','B','C','D')`).catch(() => {});
    // 把 website 里存的区域值复制到 region
    await queryRunner.query(`UPDATE customers SET "region" = "website" WHERE "website" IS NOT NULL AND "website" != ''`).catch(() => {});

    // contact_persons 新字段
    await addColumn('contact_persons', 'department', 'varchar');
    await addColumn('contact_persons', 'fax', 'varchar');
    await addColumn('contact_persons', 'wechat', 'varchar');
    await addColumn('contact_persons', 'otherContact', 'varchar');
    await addColumn('contact_persons', 'decisionRole', 'varchar');
    await addColumn('contact_persons', 'birthday', 'date');
    await addColumn('contact_persons', 'remark', 'text');

    // follow_up_records 新字段
    await addColumn('follow_up_records', 'method', 'varchar');
    await addColumn('follow_up_records', 'participants', 'varchar');
    await addColumn('follow_up_records', 'customerParticipants', 'varchar');
    await addColumn('follow_up_records', 'focusPoints', 'text');
    await addColumn('follow_up_records', 'nextAction', 'text');
    await addColumn('follow_up_records', 'deadline', 'date');
    await addColumn('follow_up_records', 'requirementId', 'varchar');

    // 索引
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_customers_level" ON "customers" ("level")`).catch(() => {});
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_customers_businessStatus" ON "customers" ("businessStatus")`).catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // SQLite 不支持 DROP COLUMN，留着即可
  }
}
