import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';

/**
 * 遗留数据库纳管（baseline）。
 *
 * 背景：此前长期以 `synchronize: true` 运行，表结构由实体自动同步而来，
 * 库里没有 `migrations` 表。现在改为迁移驱动，如果直接 `migrationsRun`，
 * TypeORM 会尝试执行 InitialSchema 里的 CREATE TABLE —— 表已存在，启动即失败。
 *
 * 处理办法是打基线：确认库里已有核心表后，把 InitialSchema 标记为"已执行"，
 * 之后的增量迁移正常叠加。执行前先备份，出问题可回滚。
 *
 * 必须在 TypeORM 初始化之前调用。
 */

const logger = new Logger('LegacyAdopt');

/** 判定"这是一个有业务数据的旧库"的依据 */
const CORE_TABLES = ['users', 'customers', 'documents', 'requirements'];

export interface AdoptResult {
  adopted: boolean;
  backupPath?: string;
  reason?: string;
}

export function adoptLegacyDatabase(dbPath: string, migrationsDir: string): AdoptResult {
  // dbPath 来自 env（管理员受控），断言仍在工程 data/ 下，防误配指向任意文件
  const dataRoot = path.resolve(process.cwd(), 'data');
  if (!path.resolve(dbPath).startsWith(dataRoot + path.sep)) {
    return { adopted: false, reason: '数据库路径不在 data/ 目录内，已拒绝纳管' };
  }
  if (!fs.existsSync(dbPath)) {
    return { adopted: false, reason: '数据库不存在，将由迁移创建' };
  }

  // better-sqlite3 是可选依赖路径上的原生模块，用 require 以免影响未安装时的构建
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');

  let db: any;
  try {
    db = new Database(dbPath);
  } catch (err: any) {
    logger.error(`无法打开数据库 ${dbPath}：${err.message}`);
    return { adopted: false, reason: '数据库无法打开' };
  }

  try {
    const tables: string[] = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name);

    // 已有 migrations 表 → 已是迁移驱动，无需处理
    if (tables.includes('migrations')) {
      return { adopted: false, reason: '已在迁移管理下' };
    }

    // 没有核心表 → 空库，交给迁移正常建表
    const hasCore = CORE_TABLES.every((t) => tables.includes(t));
    if (!hasCore) {
      return { adopted: false, reason: '空库或结构不完整，将由迁移创建' };
    }

    // ── 到这里说明是有数据的遗留库，先备份 ──────────────────────
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = `${dbPath}.legacy-${stamp}.bak`;
    fs.copyFileSync(dbPath, backupPath);
    // WAL 模式下的旁支文件一并备份，否则还原时会数据不一致
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(dbPath + suffix)) {
        fs.copyFileSync(dbPath + suffix, backupPath + suffix);
      }
    }

    // 找出初始迁移的类名，写入 migrations 表当作已执行
    const initial = fs
      .readdirSync(migrationsDir)
      .filter((f) => /InitialSchema\.(ts|js)$/.test(f))
      .sort()[0];

    if (!initial) {
      return { adopted: false, reason: '未找到 InitialSchema 迁移文件' };
    }

    const timestamp = parseInt(initial.split('-')[0], 10);
    const className = `InitialSchema${timestamp}`;

    db.exec(
      `CREATE TABLE IF NOT EXISTS "migrations" (
         "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
         "timestamp" bigint NOT NULL,
         "name" varchar NOT NULL
       )`,
    );
    db.prepare('INSERT INTO "migrations"("timestamp","name") VALUES (?,?)').run(
      timestamp,
      className,
    );

    logger.warn(`检测到遗留数据库，已纳入迁移管理（基线：${className}）`);
    logger.warn(`原库已备份至：${path.basename(backupPath)}`);

    return { adopted: true, backupPath };
  } finally {
    db.close();
  }
}
