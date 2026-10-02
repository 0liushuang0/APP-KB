import { MigrationInterface, QueryRunner } from 'typeorm';

/** 只追加保护的观测数据表（常量白名单，不接受外部输入） */
const APPEND_ONLY_TABLES = ['audit_logs', 'ai_call_logs', 'client_errors'] as const;

/** PG 标识符合法性校验：DDL 的表名/角色名无法参数化绑定，必须白名单化 */
function safeIdent(name: string, fallback: string): string {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ? name : fallback;
}

/**
 * 审计日志只追加（防篡改）+ 保留策略基线。
 *
 * 商用评估框架一票否决项：审计日志须保留 ≥180 天且不可篡改。
 * 1. PostgreSQL 层回收审计表的 UPDATE/DELETE 权限——应用账号从此
 *    只能 INSERT/SELECT，任何代码路径（含未来的清理任务）都改不了、
 *    删不了已落库的审计记录；清理只能由超级用户显式操作，留痕在案。
 * 2. 保留策略：应用不自动删除审计日志（无 TTL 清理入口），满足 ≥180 天；
 *    按月导出归档由运维脚本承担（见 docs/备份与恢复.md）。
 * 3. ai_call_logs / client_errors 同为只追加观测数据，一并保护。
 * 仅对 postgres 生效；SQLite 单机模式下由应用层保证（无删除入口）。
 */
export class AuditLogAppendOnly1788500000000 implements MigrationInterface {
  name = 'AuditLogAppendOnly1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if ((queryRunner.connection.options as { type?: string }).type !== 'postgres') {
      return;
    }
    const role = safeIdent(process.env.DB_USERNAME || '', 'postgres');
    for (const table of APPEND_ONLY_TABLES) {
      await queryRunner.query(
        `REVOKE UPDATE, DELETE ON TABLE "${table}" FROM "${role}"`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if ((queryRunner.connection.options as { type?: string }).type !== 'postgres') {
      return;
    }
    const role = safeIdent(process.env.DB_USERNAME || '', 'postgres');
    for (const table of APPEND_ONLY_TABLES) {
      await queryRunner.query(
        `GRANT UPDATE, DELETE ON TABLE "${table}" TO "${role}"`,
      );
    }
  }
}
