import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 合同回款台账（评估报告 P1"交付和资金闭环"）。
 *
 * 合同此前只有付款条款文本，回答不了"这份合同款收了多少、还差多少"。
 * contract_payments 按节点记录：应收（节点名/应收日期/应收金额）与
 * 实收（实收日期/实收金额/发票号/开票日期），汇总即得应收/已收/未收。
 */
export class AddContractPayments1788200000000 implements MigrationInterface {
  name = 'AddContractPayments1788200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('contract_payments');
    if (!table) {
      await queryRunner.query(compat(queryRunner, `
        CREATE TABLE "contract_payments" (
          "id" varchar PRIMARY KEY NOT NULL,
          "contractId" varchar NOT NULL,
          "nodeName" varchar NOT NULL,
          "dueDate" date,
          "dueAmount" decimal(14, 2) NOT NULL DEFAULT 0,
          "receivedDate" date,
          "receivedAmount" decimal(14, 2) NOT NULL DEFAULT 0,
          "invoiceNo" varchar,
          "invoiceDate" date,
          "note" text,
          "createdBy" varchar,
          "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
          "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )`));
      await queryRunner.query(
        `CREATE INDEX "IDX_contract_payments_contractId" ON "contract_payments" ("contractId")`);
    }
    // PG 驱动对 varchar 主键发送 DEFAULT，需要库端默认值（SQLite 客户端生成，无需）
    if ((queryRunner.connection.options as { type?: string }).type === 'postgres') {
      const t = await queryRunner.getTable('contract_payments');
      if (t && t.findColumnByName('id') && !t.findColumnByName('id')!.default) {
        await queryRunner.query(
          `ALTER TABLE "contract_payments" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('contract_payments');
    if (table) {
      await queryRunner.query(compat(queryRunner, `DROP TABLE "contract_payments"`));
    }
  }
}
