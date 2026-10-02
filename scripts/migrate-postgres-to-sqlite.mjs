#!/usr/bin/env node
/**
 * PostgreSQL → SQLite(better-sqlite3) 数据搬迁。
 *
 * 背景：产品形态定为「单机个人版 + Windows 安装包」，给桌面产品捆绑一个
 * PostgreSQL 服务进程不合理，存储层已改为 better-sqlite3（WAL + ACID）。
 * 此脚本把现有 PG 库里的业务数据搬到 SQLite。
 *
 * 用法：
 *   node scripts/migrate-postgres-to-sqlite.mjs                 # 执行搬迁
 *   node scripts/migrate-postgres-to-sqlite.mjs --verify        # 只比对行数
 *   node scripts/migrate-postgres-to-sqlite.mjs --out <path>    # 指定输出库
 *
 * 前置：目标 SQLite 必须已由迁移建好表结构。脚本会自动调用 migration:run。
 *
 * 安全：目标库若已存在会先备份；PG 侧只读，不做任何修改。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const backendDir = path.join(projectRoot, 'backend');
const require = createRequire(path.join(backendDir, 'package.json'));

const { Client } = require('pg');
const Database = require('better-sqlite3');
require('dotenv').config({ path: path.join(projectRoot, '.env') });

const argv = process.argv.slice(2);
const verifyOnly = argv.includes('--verify');
const outIdx = argv.indexOf('--out');
const targetPath = path.resolve(
  outIdx >= 0 ? argv[outIdx + 1] : path.join(backendDir, 'data', 'app.db'),
);

/**
 * 搬迁顺序 = 外键依赖顺序，父表先行。
 * 未列出的表不搬（如 migrations 由迁移自己维护）。
 */
const TABLES = [
  'roles',
  'departments',
  'user_groups',
  'users',
  'user_roles',
  'user_group_members',
  'refresh_tokens',
  'system_configs',
  'param_templates',
  'customers',
  'contact_persons',
  'follow_up_records',
  'products',
  'product_attachments',
  'product_boms',
  'suppliers',
  'supplier_capabilities',
  'supplier_products',
  'supplier_quotes',
  'solutions',
  'config_options',
  'price_tables',
  'requirements',
  'requirement_attachments',
  'proposals',
  'proposal_versions',
  'quotations',
  'quotation_items',
  'projects',
  'project_stages',
  'project_risks',
  'project_timelines',
  'documents',
  'document_links',
  'approval_flows',
  'audit_logs',
  'ai_call_logs',
  'calc_templates',
  'calc_records',
];

const pgConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'aikb',
    };

/**
 * PG 值 → SQLite 值。
 * SQLite 只有 NULL/INTEGER/REAL/TEXT/BLOB，布尔与时间都要落成基础类型。
 */
function toSqlite(value) {
  if (value === null || value === undefined) return null;

  // 布尔 → 0/1（TypeORM 读回时按 boolean 解释）
  if (typeof value === 'boolean') return value ? 1 : 0;

  // 时间 → 'YYYY-MM-DD HH:MM:SS.SSS'，与 TypeORM sqlite 驱动的格式一致
  if (value instanceof Date) {
    return value.toISOString().replace('T', ' ').replace('Z', '');
  }

  // PG 数组（text[]）→ TypeORM simple-array 的逗号分隔字符串
  if (Array.isArray(value)) return value.join(',');

  // jsonb / json → 字符串（实体里这些列是 text）
  if (typeof value === 'object') return JSON.stringify(value);

  // numeric 在 pg 驱动里是字符串，保持原样交给 SQLite（列是 decimal → 存 TEXT/REAL 均可）
  return value;
}

function ensureSchema() {
  console.log('→ 确保目标库表结构（运行迁移）…');
  // Windows 上 execFileSync 直接调 npx.cmd 会 EINVAL，走 shell 更稳
  execSync(
    'npx typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts',
    {
      cwd: backendDir,
      env: { ...process.env, DB_TYPE: 'sqlite', SQLITE_PATH: targetPath },
      stdio: 'pipe',
    },
  );
  console.log('  表结构就绪');
}

async function main() {
  const pg = new Client(pgConfig);
  await pg.connect();
  console.log(`源  PostgreSQL  ${pgConfig.database || pgConfig.connectionString}`);
  console.log(`目标 SQLite      ${targetPath}\n`);

  // ── 目标库准备 ─────────────────────────────────────────────
  if (!verifyOnly) {
    if (fs.existsSync(targetPath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backup = `${targetPath}.before-pg-import-${stamp}.bak`;
      fs.copyFileSync(targetPath, backup);
      console.log(`原目标库已备份：${path.basename(backup)}`);
      // 从零开始，避免与旧残留数据混在一起
      for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(targetPath + suffix)) fs.unlinkSync(targetPath + suffix);
      }
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    ensureSchema();
  }

  const sqlite = new Database(targetPath);
  sqlite.pragma('journal_mode = WAL');
  // 搬迁期间关闭外键检查：按依赖顺序插入仍可能有自引用（如 departments.parentId）
  sqlite.pragma('foreign_keys = OFF');

  const report = [];

  for (const table of TABLES) {
    // 源表存在性
    const exists = await pg.query(
      "SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=$1",
      [table],
    );
    if (!exists.rowCount) {
      report.push({ table, src: '-', dst: '-', note: '源表不存在' });
      continue;
    }

    const { rows } = await pg.query(`SELECT * FROM "${table}"`);
    if (!rows.length) {
      report.push({ table, src: 0, dst: 0, note: '空表' });
      continue;
    }

    if (verifyOnly) {
      let dst = -1;
      try {
        dst = sqlite.prepare(`SELECT COUNT(*) c FROM "${table}"`).get().c;
      } catch {
        /* 目标表不存在 */
      }
      report.push({
        table,
        src: rows.length,
        dst,
        note: dst === rows.length ? '一致' : dst < 0 ? '目标表缺失' : '数量不符',
      });
      continue;
    }

    // 目标表的真实列（PG 可能有目标端已废弃的列）
    let targetCols;
    try {
      targetCols = new Set(
        sqlite.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name),
      );
    } catch {
      report.push({ table, src: rows.length, dst: 0, note: '目标表不存在，跳过' });
      continue;
    }

    const cols = Object.keys(rows[0]).filter((c) => targetCols.has(c));
    const skipped = Object.keys(rows[0]).filter((c) => !targetCols.has(c));

    const sql = `INSERT OR REPLACE INTO "${table}" (${cols.map((c) => `"${c}"`).join(',')})
                 VALUES (${cols.map(() => '?').join(',')})`;
    const stmt = sqlite.prepare(sql);

    let ok = 0;
    const errors = [];
    // 单事务批量插入：几百行也能快很多，且失败可整体回滚
    const insertAll = sqlite.transaction((records) => {
      for (const row of records) {
        try {
          stmt.run(cols.map((c) => toSqlite(row[c])));
          ok += 1;
        } catch (err) {
          if (errors.length < 3) errors.push(err.message.split('\n')[0]);
        }
      }
    });
    insertAll(rows);

    report.push({
      table,
      src: rows.length,
      dst: ok,
      note:
        errors.length
          ? `${rows.length - ok} 行失败：${errors[0]}`
          : skipped.length
            ? `忽略源端多余列：${skipped.join(',')}`
            : '',
    });
  }

  sqlite.pragma('foreign_keys = ON');
  sqlite.close();
  await pg.end();

  // ── 报告 ───────────────────────────────────────────────────
  console.log('\n表名'.padEnd(26), '源'.padStart(7), '目标'.padStart(7), '  备注');
  console.log('-'.repeat(84));
  let srcTotal = 0;
  let dstTotal = 0;
  for (const r of report) {
    if (typeof r.src === 'number') srcTotal += r.src;
    if (typeof r.dst === 'number' && r.dst > 0) dstTotal += r.dst;
    if (r.src === 0 && r.dst === 0) continue; // 空表不刷屏
    console.log(
      String(r.table).padEnd(26),
      String(r.src).padStart(7),
      String(r.dst).padStart(7),
      '  ' + r.note,
    );
  }
  console.log('-'.repeat(84));
  console.log(`合计  源 ${srcTotal} 行 → 目标 ${dstTotal} 行`);

  const bad = report.filter((r) => r.note.includes('失败') || r.note.includes('不符'));
  if (bad.length) {
    console.log(`\n⚠ ${bad.length} 张表有问题，请检查后再切换 DB_TYPE`);
    process.exit(1);
  }
  console.log(
    verifyOnly
      ? '\n✓ 校验通过'
      : '\n✓ 搬迁完成。确认无误后把 .env 的 DB_TYPE 改为 sqlite 并重启。',
  );
}

main().catch((err) => {
  console.error('✗ 搬迁失败：', err.message);
  process.exit(1);
});
