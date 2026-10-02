import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 清理 document_links 的孤儿数据 + 修正 stage 与 *Id 不一致的行。
 *
 * 背景：document_links 的 7 个业务关联列（customerId/requirementId/...）自建表起
 * 就是裸字符串列、无外键，且写入时（修复前）不校验 stage 是否与实际 *Id 匹配。
 * 于是会出现两类脏数据，正是"需求阶段还在、客户需求档案没了"的根因：
 *   1) 悬空引用：某 *Id 指向已被删除的父行（删父行时漏清 link）
 *   2) 阶段错位：stage='requirement' 但 requirementId 为空（仅挂客户）——客户需求
 *      全删后这条 link 仍显示在"需求阶段"，看起来档案还在、实际无对应需求
 *
 * 本迁移纯 DELETE/UPDATE，SQLite/Postgres 通用。必须在加外键的迁移之前跑
 * （否则 Postgres ADD CONSTRAINT 会因悬空行直接失败）。
 */
export class CleanupOrphanDocLinks1787500000000 implements MigrationInterface {
  name = 'CleanupOrphanDocLinks1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ① 删除悬空引用：*Id 非空、但指向的父行已不存在。
    //    id 列是主键非空，NOT IN 子查询安全。.catch 兜底"表不存在"的极旧库。
    const dangling: Array<[string, string]> = [
      ['requirementId', 'requirements'],
      ['proposalId', 'proposals'],
      ['solutionId', 'solutions'],
      ['quotationId', 'quotations'],
      ['contractId', 'contracts'],
      ['projectId', 'projects'],
      ['customerId', 'customers'],
    ];
    for (const [col, ref] of dangling) {
      await queryRunner
        .query(
          `DELETE FROM "document_links" WHERE "${col}" IS NOT NULL AND "${col}" NOT IN (SELECT "id" FROM "${ref}")`,
        )
        .catch(() => {});
    }

    // ② 修正阶段错位：stage 指向某业务阶段、却没有对应 *Id 的，降级为 'raw'
    //    （客户级原始资料），让"需求阶段"节点不再显示无需求支撑的档案。
    //    solution 阶段可能挂 proposalId 或 solutionId，两者皆空才算错位。
    await queryRunner
      .query(`UPDATE "document_links" SET "stage"='raw' WHERE "stage"='requirement' AND "requirementId" IS NULL`)
      .catch(() => {});
    await queryRunner
      .query(
        `UPDATE "document_links" SET "stage"='raw' WHERE "stage"='solution' AND "proposalId" IS NULL AND "solutionId" IS NULL`,
      )
      .catch(() => {});
    await queryRunner
      .query(`UPDATE "document_links" SET "stage"='raw' WHERE "stage"='quotation' AND "quotationId" IS NULL`)
      .catch(() => {});
    await queryRunner
      .query(`UPDATE "document_links" SET "stage"='raw' WHERE "stage"='contract' AND "contractId" IS NULL`)
      .catch(() => {});
  }

  public async down(): Promise<void> {
    // 清理类迁移不可逆（无法还原原始 stage / 已删行），留空。
  }
}
