import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 商机管理字段（评估报告 P2"销售过程管理"）。
 *
 * 需求单已承担商机入口，补齐销售过程所需的预判与跟进字段：
 * 预计成交金额/日期、赢单概率、下次跟进日期、输单原因。
 * 有了它们，销售漏斗才能按金额而不只是按数量说话。
 */
export class AddOpportunityFields1788400000000 implements MigrationInterface {
  name = 'AddOpportunityFields1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('requirements');
    const cols: Array<[string, string]> = [
      ['expectedAmount', 'decimal(14, 2)'],
      ['expectedDealDate', 'date'],
      ['winProbability', 'integer'],
      ['nextFollowUpDate', 'date'],
      ['lossReason', 'text'],
    ];
    for (const [col, type] of cols) {
      if (table && !table.findColumnByName(col)) {
        await queryRunner.query(compat(queryRunner,
          `ALTER TABLE "requirements" ADD COLUMN "${col}" ${type}`));
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('requirements');
    const cols = ['expectedAmount', 'expectedDealDate', 'winProbability', 'nextFollowUpDate', 'lossReason'];
    for (const col of cols) {
      if (table && table.findColumnByName(col)) {
        await queryRunner.query(compat(queryRunner,
          `ALTER TABLE "requirements" DROP COLUMN "${col}"`));
      }
    }
  }
}
