#!/usr/bin/env node
/**
 * SQLite → PostgreSQL 数据迁移（PG 全面切换版）。
 *
 * 用法：
 *   1. 先让后端在 PG 上完成一次启动（迁移链建表 + 种子数据）
 *   2. 搬数据：  node scripts/migrate-sqlite-to-postgres.mjs
 *   3. 校验：    node scripts/migrate-sqlite-to-postgres.mjs --verify
 *
 * 与旧版的差异（旧版表清单停在 34 张表，本项目已扩到 55 张）：
 *   - 表清单直接读 SQLite 的 sqlite_master，不再手工维护
 *   - 写入顺序按 PG 外键依赖拓扑排序，父表先写
 *   - 值按 PG 目标列类型矫正（SQLite 的 0/1 → boolean 等），
 *     TypeORM simple-array 在两种库里都是逗号分隔 text，原样直传
 *   - ON CONFLICT DO NOTHING，可重复执行
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const backendDir = path.join(projectRoot, 'backend');
const require = createRequire(path.join(backendDir, 'package.json'));

const initSqlJs = require('sql.js');
const { Client } = require('pg');

const sqlitePath =
  process.env.SQLITE_PATH || path.join(backendDir, 'data', 'app.db');

const pgConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'aikb',
    };

const verifyOnly = process.argv.includes('--verify');

/** 按外键依赖把表拓扑排序：被依赖的表先写 */
async function tablesInFkOrder(pg) {
  const { rows } = await pg.query(`
    SELECT tc.table_name AS child,
           ccu.table_name AS parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
  `);
  const deps = new Map(); // table -> Set(parent)
  for (const { child, parent } of rows) {
    if (!deps.has(child)) deps.set(child, new Set());
    deps.get(child).add(parent);
  }
  const ordered = [];
  const done = new Set();
  const pending = [...deps.keys()];
  let guard = 0;
  while (pending.length && guard++ < 10000) {
    const next = pending.shift();
    const parents = deps.get(next) || new Set();
    if ([...parents].every((p) => done.has(p) || p === next)) {
      ordered.push(next);
      done.add(next);
    } else {
      pending.push(next);
    }
  }
  // 环上的表按原顺序追加（ON CONFLICT + 二次补写可解）
  for (const t of pending) ordered.push(t);
  return ordered;
}

/** 读 PG 目标列类型，用于值矫正 */
async function columnTypes(pg, table) {
  const { rows } = await pg.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  const map = new Map();
  for (const r of rows) map.set(r.column_name, r.data_type);
  return map;
}

function coerceValue(pgType, value) {
  if (value === null || value === undefined) return null;
  switch (pgType) {
    case 'boolean':
      if (typeof value === 'number') return value !== 0;
      if (typeof value === 'string') return !['', '0', 'false', 'false ', 'no'].includes(value.toLowerCase());
      return Boolean(value);
    case 'smallint':
    case 'integer':
    case 'bigint':
      return parseInt(value, 10);
    case 'numeric':
    case 'double precision':
    case 'real':
      return parseFloat(value);
    default:
      return value; // text/varchar/timestamp/date 原样（含逗号分隔的 simple-array）
  }
}

async function main() {
  if (!fs.existsSync(sqlitePath)) {
    console.error(`✗ 找不到 SQLite 文件：${sqlitePath}`);
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(sqlitePath)));

  // 源表清单：sqlite_master 动态读取，排除内部表与迁移台账
  const sqliteTables = db
    .exec(`SELECT name FROM sqlite_master WHERE type='table'
           AND name NOT LIKE 'sqlite_%' AND name NOT IN ('migrations', 'typeorm_metadata')`)[0]
    .values.map((r) => r[0]);

  const pg = new Client(pgConfig);
  await pg.connect();
  console.log(`→ 源  ${sqlitePath}（${sqliteTables.length} 张表）`);
  console.log(`→ 目标 ${pgConfig.connectionString || `${pgConfig.host}:${pgConfig.port}/${pgConfig.database}`}\n`);

  // 只搬两边都存在的表；写入顺序 = 拓扑序 ∩ 存在集合，其余按字母序垫后
  const fkOrder = await tablesInFkOrder(pg);
  const ordered = [
    ...fkOrder.filter((t) => sqliteTables.includes(t)),
    ...sqliteTables.filter((t) => !fkOrder.includes(t)).sort(),
  ];

  const report = [];
  for (const table of ordered) {
    let result;
    try {
      result = db.exec(`SELECT * FROM "${table}"`);
    } catch {
      report.push({ table, source: '-', target: '-', note: '源表读取失败，跳过' });
      continue;
    }
    if (!result.length) {
      report.push({ table, source: 0, target: 0, note: '空表' });
      continue;
    }
    const { columns, values } = result[0];

    if (verifyOnly) {
      const { rows } = await pg
        .query(`SELECT COUNT(*)::int AS n FROM "${table}"`)
        .catch(() => ({ rows: [{ n: -1 }] }));
      const target = rows[0].n;
      report.push({
        table,
        source: values.length,
        target,
        note: target === values.length ? '✓ 一致' : target < 0 ? '目标表不存在' : '✗ 数量不符',
      });
      continue;
    }

    const types = await columnTypes(pg, table);
    const missing = columns.filter((c) => !types.has(c));
    const usable = columns.filter((c) => types.has(c));
    if (missing.length) {
      report.push({ table, source: values.length, target: 0, note: `目标缺列：${missing.join(',')}（旧库残留列）` });
      if (!usable.length) continue;
    }

    const quoted = usable.map((c) => `"${c}"`).join(', ');
    const placeholders = usable.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

    let ok = 0;
    const failures = [];
    for (const row of values) {
      const obj = Object.fromEntries(columns.map((c, i) => [c, row[i]]));
      const params = usable.map((c) => {
        const t = types.get(c);
        // 数组语义的整型列（simple-array 实为 text）之外的数字矫正交给 coerceValue
        if (t === 'text' || t === 'character varying') return obj[c] == null ? null : String(obj[c]);
        // SQLite 惯用 '' 表示"没填"，PG 的 date/timestamp 不接受空串
        if ((t === 'date' || t.startsWith('timestamp')) && obj[c] === '') return null;
        return coerceValue(t, obj[c]);
      });
      try {
        await pg.query(sql, params);
        ok += 1;
      } catch (err) {
        failures.push(err.message.split('\n')[0]);
      }
    }
    report.push({
      table,
      source: values.length,
      target: ok,
      note: failures.length ? `${failures.length} 行失败：${failures[0]}` : '✓',
    });
  }

  console.log('表名'.padEnd(30), '源'.padStart(7), '写入'.padStart(7), '  备注');
  console.log('-'.repeat(90));
  for (const r of report) {
    console.log(
      String(r.table).padEnd(30),
      String(r.source).padStart(7),
      String(r.target).padStart(7),
      '  ' + r.note,
    );
  }

  const bad = report.filter((r) => r.note.startsWith('✗') || r.note.includes('失败'));
  console.log(
    `\n${verifyOnly ? '校验' : '迁移'}完成：${report.length} 张表，${bad.length} 张有问题`,
  );

  await pg.end();
  db.close();
  process.exit(bad.length ? 1 : 0);
}

main().catch((err) => {
  console.error('✗ 迁移失败：', err.message);
  process.exit(1);
});
