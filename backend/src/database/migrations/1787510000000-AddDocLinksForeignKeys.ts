import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 给 document_links 的业务关联列加 ON DELETE CASCADE 外键（仅 Postgres）。
 *
 * 为什么只 Postgres：
 *   · SQLite 不支持 ALTER TABLE ... ADD CONSTRAINT/ADD FOREIGN KEY，要加外键只能
 *     重建整张表（PRAGMA foreign_keys=OFF → 建新表 → INSERT…SELECT → DROP → 改名），
 *     重建期间任一步失败都可能锁库，对单机 SQLite 版风险大、收益小。
 *   · 单机版靠应用层级联删除即可：customers/requirements/documents/projects/proposals
 *     各 service 的 remove() 都已先删 document_links 再删父行（见各自 remove()）。
 *   · Postgres（团队/多租户线上库）支持 ADD CONSTRAINT，加上后是 DB 级兜底，
 *     任何未来漏清 link 的代码路径都不会再产生孤儿。
 *
 * 用 ON DELETE CASCADE 而非 RESTRICT：应用已先删 link，CASCADE 是无害兜底；
 * 用 RESTRICT 反而会在残留孤儿时把原本正常的删除流程拦崩。前置依赖
 * CleanupOrphanDocLinks 迁移先清掉悬空行，否则 ADD CONSTRAINT 直接失败。
 */
export class AddDocLinksForeignKeys1787510000000 implements MigrationInterface {
  name = 'AddDocLinksForeignKeys1787510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const driverType = (queryRunner.connection.options as { type?: string }).type;
    const isPostgres = driverType === 'postgres';
    if (!isPostgres) {
      // SQLite/better-sqlite3：跳过，依赖应用层级联。见类注释。
      return;
    }

    const fks: Array<[string, string]> = [
      ['requirementId', 'requirements'],
      ['proposalId', 'proposals'],
      ['solutionId', 'solutions'],
      ['quotationId', 'quotations'],
      ['contractId', 'contracts'],
      ['projectId', 'projects'],
      ['customerId', 'customers'],
    ];
    for (const [col, ref] of fks) {
      await queryRunner
        .query(
          `ALTER TABLE "document_links" ADD CONSTRAINT "fk_doclinks_${col}" FOREIGN KEY ("${col}") REFERENCES "${ref}" ("id") ON DELETE CASCADE`,
        )
        .catch(() => {}); // 已存在则跳过
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const driverType = (queryRunner.connection.options as { type?: string }).type;
    if (driverType !== 'postgres') return;
    for (const col of [
      'requirementId',
      'proposalId',
      'solutionId',
      'quotationId',
      'contractId',
      'projectId',
      'customerId',
    ]) {
      await queryRunner.query(`ALTER TABLE "document_links" DROP CONSTRAINT IF EXISTS "fk_doclinks_${col}"`).catch(() => {});
    }
  }
}
