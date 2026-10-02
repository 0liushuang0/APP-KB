import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 1. customers 增加 customerCode（客户编码）
 *    原有的 code 列存的一直是**简称**（「神东煤炭」→「神东煤炭高级研发中心」），
 *    界面上已正名为「客户简称」。编码是另一件事，单独一列，可留空。
 *
 * 2. proposals.title 改为可空
 *    方案的项目名称改为从关联需求带出、只读，方案不再自己维护标题。
 *    列保留但允许为空：直接 DROP 会让回滚无路可走，而 SQLite 的
 *    DROP COLUMN 要重建整张表，风险不划算。
 */
export class AddCustomerCodeAndDropProposalTitle1786100000000
  implements MigrationInterface
{
  name = 'AddCustomerCodeAndDropProposalTitle1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const customers = await queryRunner.getTable('customers');
    if (customers && !customers.findColumnByName('customerCode')) {
      await queryRunner.query(`ALTER TABLE "customers" ADD "customerCode" varchar`);
    }

    /*
     * title 原本是 NOT NULL。SQLite 不支持直接改列约束，只能重建表；
     * 这里用官方推荐的 12 步法的精简版：新建 → 拷贝 → 换名。
     */
    const proposals = await queryRunner.getTable('proposals');
    const titleCol = proposals?.findColumnByName('title');
    if (titleCol && !titleCol.isNullable) {
      await queryRunner.query(compat(queryRunner, `PRAGMA foreign_keys=OFF`));
      await queryRunner.query(compat(queryRunner, `ALTER TABLE "proposals" RENAME TO "proposals_old"`));
      await queryRunner.query(compat(queryRunner, `
        CREATE TABLE "proposals" (
          "id" varchar PRIMARY KEY NOT NULL,
          "proposalNo" varchar NOT NULL,
          "customerId" varchar,
          "requirementId" varchar,
          "title" varchar,
          "productDescription" text,
          "proposalType" varchar,
          "version" integer NOT NULL DEFAULT (1),
          "status" varchar NOT NULL DEFAULT ('draft'),
          "content" text,
          "requirements" text,
          "aiGenerated" boolean NOT NULL DEFAULT (0),
          "sourceProposalId" varchar,
          "ownerId" varchar,
          "departmentId" varchar,
          "visibility" varchar NOT NULL DEFAULT ('public'),
          "groupIds" text,
          "roleCodes" text,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )
      `));
      await queryRunner.query(`
        INSERT INTO "proposals" (
          "id","proposalNo","customerId","requirementId","title","productDescription",
          "proposalType","version","status","content","requirements","aiGenerated",
          "sourceProposalId","ownerId","departmentId","visibility","groupIds","roleCodes",
          "createdAt","updatedAt"
        )
        SELECT
          "id","proposalNo","customerId","requirementId","title","productDescription",
          "proposalType","version","status","content","requirements","aiGenerated",
          "sourceProposalId","ownerId","departmentId","visibility","groupIds","roleCodes",
          "createdAt","updatedAt"
        FROM "proposals_old"
      `);
      await queryRunner.query(compat(queryRunner, `DROP TABLE "proposals_old"`));
      await queryRunner.query(compat(queryRunner, `PRAGMA foreign_keys=ON`));
    }

    // 项目名称改由需求提供，旧标题清空，避免两处名称并存造成困惑
    await queryRunner.query(`UPDATE "proposals" SET "title" = NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const customers = await queryRunner.getTable('customers');
    if (customers?.findColumnByName('customerCode')) {
      await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN "customerCode"`);
    }
    // title 的原值已在 up 中清空，无法还原；这里只恢复列约束意义不大，留空即可
  }
}
