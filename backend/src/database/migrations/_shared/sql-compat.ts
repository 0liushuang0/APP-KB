import { QueryRunner } from 'typeorm';

/**
 * 迁移 SQL 的方言兼容层。
 *
 * 注意：本文件必须放在 _shared/ 子目录 —— database.config.ts 用
 * `migrations/*{.ts,.js}` 收集迁移，TypeORM 会把 glob 命中的每个文件的所有
 * 导出都当作迁移类实例化；这里的 compat 是普通函数，混在迁移目录里会直接
 * `new compat()` 报错。子目录不被该 glob 递归匹配。
 *
 * 历史迁移是按 SQLite 方言写的（列类型 datetime、默认值 datetime('now')、
 * boolean 默认值 (1)/(0)、表重建前后的 PRAGMA foreign_keys 开关）。SQLite 上
 * 这些写法必须原样保留；跑在 PostgreSQL 上时在这里统一翻译成等价写法，
 * 让同一条迁移链在两种数据库上都能从零建库。
 */
export function compat(queryRunner: QueryRunner, sql: string): string {
  if ((queryRunner.connection.options as { type?: string }).type !== 'postgres') {
    return sql;
  }
  // PRAGMA 是 SQLite 独有的连接级开关，PG 不需要（也不支持）——替换成空操作
  if (/^\s*PRAGMA/i.test(sql)) {
    return 'SELECT 1';
  }
  // 临时表重建模式另一处 PG 差异：约束名在 PG 是模式级唯一，
  // temporary_ 表沿用原表同名约束（原表此刻还没 DROP）会冲突；
  // SQLite 不检查重名所以无感。加 t_ 前缀避开，重命名后约束保留在
  // 正式表上（名字带前缀，无碍）。
  if (/CREATE TABLE "temporary_/i.test(sql)) {
    sql = sql.replace(/CONSTRAINT "(UQ_|FK_|PK_)/g, 'CONSTRAINT "t_$1');
  }
  // SQLite 专有函数（strftime/printf/rowid）的历史数据回填语句：
  // 换成等价的 PG 写法（ctid 排序 + 窗口函数生成序号）。迁移链里仅
  // UpgradeSolutionModule 的方案编号回填用到，故按语义整体替换。
  if (/strftime\(/i.test(sql) && /printf\(/i.test(sql)) {
    sql = `UPDATE "solutions" s SET "solutionNo" = t.no ` +
      `FROM (SELECT "ctid" AS ct, 'SOL-' || to_char(now(), 'YYYY') || '-' ` +
      `|| lpad((row_number() OVER (ORDER BY "ctid"))::text, 3, '0') AS no ` +
      `FROM "solutions" WHERE "solutionNo" IS NULL OR "solutionNo" = '') t ` +
      `WHERE s.ctid = t.ct`;
  }
  return sql
    // 默认值函数：SQLite datetime('now') → PG now()（外层括号 PG 同样接受）
    .replace(/datetime\('now'\)/gi, 'now()')
    // 列类型：PG 没有 datetime 类型，等价物是 timestamp（兼容大小写两种写法）
    .replace(/" datetime(?=[,\s)])/gi, '" timestamp')
    // boolean 默认值：PG 不接受整型字面量，必须是 true/false。
    // 只翻译 boolean 列——integer 列的 DEFAULT (0)/(1) 在两种库里都合法。
    .replace(/(boolean[^,]*?)DEFAULT \(1\)/gi, '$1DEFAULT true')
    .replace(/(boolean[^,]*?)DEFAULT \(0\)/gi, '$1DEFAULT false')
    // 同上，无括号写法（如 "read" boolean NOT NULL DEFAULT 0）
    .replace(/(boolean[^,]*?)DEFAULT 1\b/gi, '$1DEFAULT true')
    .replace(/(boolean[^,]*?)DEFAULT 0\b/gi, '$1DEFAULT false')
    // 旧迁移里的"临时表重建"模式在 PG 下会被依赖挡住：刚建的 temporary_ 表
    // 带着指向原表的外键，紧接着的 DROP TABLE 原表触发 RESTRICT。
    // SQLite 根本不强制外键所以无感。PG 下统一 CASCADE（只连带删约束，
    // 不删表）；被带走的 departments 自引用外键由收尾迁移补回。
    .replace(/DROP TABLE ("[a-zA-Z_]+")\s*$/g, 'DROP TABLE $1 CASCADE')
    // 旧迁移大量用 .catch(()=>{}) 吞"列已存在"错误来做到可重复执行——
    // SQLite 事务里单条语句失败还能继续；PG 事务一错即整体中止，
    // 后续所有语句都会以"事务被终止"失败。PG 方言统一改成幂等写法。
    .replace(/ALTER TABLE ("[^"]+") ADD COLUMN (?!IF NOT EXISTS)/gi, 'ALTER TABLE $1 ADD COLUMN IF NOT EXISTS ');
}
