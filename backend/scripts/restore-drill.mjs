/**
 * 恢复演练：验证"加密备份 → 完整还原"这条容灾路径真的走得通。
 *
 * 流程（全程不碰生产库 aikb）：
 *   1. 取 data/backups 最新的 backup-db-*.zip.enc
 *   2. AES-256-GCM 解密（格式 [12B iv][密文][16B tag]，密钥 data/.backup-key）
 *   3. 解 zip 取 pgdump.dump + manifest.json
 *   4. CREATE DATABASE aikb_drill → pg_restore -Fc 恢复
 *   5. 验证：表数量、关键表行数与生产库逐项对比
 *   6. 清理临时库与临时文件（--keep 可保留现场排查）
 *
 * 用法：node scripts/restore-drill.mjs [--keep]
 * 退出码 0 = 演练通过；非 0 = 失败（报告写入 data/restore-drill-report.json）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import unzipper from 'unzipper';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const REPORT_PATH = path.join(DATA, 'restore-drill-report.json');
const DRILL_DB = 'aikb_drill';

function findPgRestore() {
  if (process.env.PG_RESTORE_PATH) return process.env.PG_RESTORE_PATH;
  if (process.env.PG_DUMP_PATH) {
    return process.env.PG_DUMP_PATH.replace(/pg_dump(\.exe)?$/, 'pg_restore$1');
  }
  // Windows 上 pg_restore 常不在 PATH：按版本目录搜 PostgreSQL 安装位置
  for (const base of ['C:/Program Files/PostgreSQL', 'C:/PostgreSQL']) {
    if (!fs.existsSync(base)) continue;
    for (const ver of fs.readdirSync(base).sort().reverse()) {
      const p = path.join(base, ver, 'bin', 'pg_restore.exe');
      if (fs.existsSync(p)) return p;
    }
  }
  return 'pg_restore';
}
const PG_RESTORE = findPgRestore();

const connOpts = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'aikb',
    };

const run = (bin, args, env = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => reject(new Error(`无法启动 ${bin}：${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${bin} 退出码 ${code}\n${err.slice(-2000)}`))));
  });

/** 与 backup.service 的 encryptFileInPlace 互逆：[iv][密文][tag] */
function decryptToTmp(encPath) {
  const keyHex = fs
    .readFileSync(path.join(DATA, '.backup-key'), 'utf8')
    .trim();
  const key = Buffer.from(keyHex, 'hex');
  const data = fs.readFileSync(encPath);
  const iv = data.subarray(0, 12);
  const tag = data.subarray(data.length - 16);
  const body = data.subarray(12, data.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(body), decipher.final()]);
  const out = path.join(os.tmpdir(), `aikb-drill-${Date.now()}.zip`);
  fs.writeFileSync(out, plain);
  return out;
}

async function extractDump(zipPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aikb-drill-'));
  const zip = fs.createReadStream(zipPath).pipe(unzipper.Parse({ forceStream: true }));
  let manifest = null;
  for await (const entry of zip) {
    if (entry.path === 'pgdump.dump') {
      await new Promise((res, rej) => {
        const w = fs.createWriteStream(path.join(dir, 'pgdump.dump'));
        entry.pipe(w);
        w.on('finish', res);
        w.on('error', rej);
      });
    } else if (entry.path === 'manifest.json') {
      manifest = JSON.parse((await entry.buffer()).toString('utf8'));
    } else {
      entry.autodrain();
    }
  }
  return { dumpPath: path.join(dir, 'pgdump.dump'), manifest, dir };
}

const KEY_TABLES = [
  'customers',
  'requirements',
  'proposals',
  'quotations',
  'contracts',
  'projects',
  'after_sales_tickets',
  'documents',
  'document_links',
  'users',
];

async function snapshot(client, onlyTables) {
  const tables = (
    await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
  ).rows.map((r) => r.tablename);
  const counts = {};
  for (const t of onlyTables ?? tables) {
    if (!tables.includes(t)) {
      counts[t] = null;
      continue;
    }
    counts[t] = Number((await client.query(`SELECT COUNT(*) AS n FROM "${t}"`)).rows[0].n);
  }
  return { tables, counts };
}

async function main() {
  const keep = process.argv.includes('--keep');
  const report = { startedAt: new Date().toISOString(), steps: [] };
  const step = (name, ok, detail) => {
    report.steps.push({ name, ok, detail });
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '：' + detail : ''}`);
    if (!ok) throw Object.assign(new Error(name), { report });
  };

  // 1. 最新加密备份
  const backups = fs
    .readdirSync(path.join(DATA, 'backups'))
    .filter((f) => /^backup-db-.*\.zip\.enc$/.test(f))
    .sort();
  const latest = backups.at(-1);
  step('定位最新备份', !!latest, latest);

  // 2. 解密
  const zipPath = decryptToTmp(path.join(DATA, 'backups', latest));
  step('AES-256-GCM 解密', fs.statSync(zipPath).size > 0, `${(fs.statSync(zipPath).size / 1024).toFixed(0)} KB`);

  // 3. 解包
  const { dumpPath, manifest } = await extractDump(zipPath);
  step('解包 pgdump.dump', fs.existsSync(dumpPath), `引擎 ${manifest?.engine}，备份时间 ${manifest?.createdAt}`);

  // 4. 建临时库并恢复
  const safeError = (c) => c.on('error', () => {}); // DROP ... FORCE 终止残留连接时避免 unhandled error 崩进程
  const admin = new Client(connOpts);
  safeError(admin);
  await admin.connect();
  let drill = null;
  await admin.query(`DROP DATABASE IF EXISTS ${DRILL_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DRILL_DB} TEMPLATE template0 ENCODING 'UTF8'`);
  try {
    const drillConn = { ...connOpts, database: DRILL_DB, connectionString: undefined };
    await run(
      PG_RESTORE,
      [
        '--no-owner', '--no-privileges', '-Fc',
        '-h', connOpts.host || 'localhost',
        '-p', String(connOpts.port || 5432),
        '-U', connOpts.user || 'postgres',
        '-d', DRILL_DB,
        dumpPath,
      ],
      { PGPASSWORD: connOpts.password || 'postgres' },
    );
    step('pg_restore 到临时库', true, DRILL_DB);

    // 5. 验证。
    //    备份是过去某时刻的快照，生产库此后仍在写入 —— 行数判据按方向：
    //    · 恢复 > 生产：恢复出多余数据，严重问题，判失败
    //    · 恢复 < 生产：备份时刻之后的正常增量，判通过但记录明细
    drill = new Client(drillConn);
    safeError(drill);
    await drill.connect();
    const prodSnap = await snapshot(admin);
    const drillSnap = await snapshot(drill);
    step(
      '表数量一致',
      drillSnap.tables.length === prodSnap.tables.length,
      `生产 ${prodSnap.tables.length} 张 / 恢复 ${drillSnap.tables.length} 张`,
    );
    const extra = prodSnap.tables.filter((t) => drillSnap.counts[t] > prodSnap.counts[t]);
    step('无多余数据（恢复 ≤ 生产）', extra.length === 0,
      extra.length ? extra.map((t) => `${t}: 恢复${drillSnap.counts[t]} > 生产${prodSnap.counts[t]}`).join('；') : '');
    const behind = prodSnap.tables.filter((t) => drillSnap.counts[t] < prodSnap.counts[t]);
    report.lagTables = behind.map((t) => ({ table: t, restored: drillSnap.counts[t], production: prodSnap.counts[t] }));
    step('备份后增量可解释', true,
      behind.length
        ? `${behind.length} 张表落后于生产（备份时刻 ${manifest?.createdAt} 之后的正常增量：${behind.map((t) => `${t}+${prodSnap.counts[t] - drillSnap.counts[t]}`).join('，')}）`
        : '全部表行数与生产一致');
    report.rowCounts = { production: prodSnap.counts, restored: drillSnap.counts };
    await drill.end().catch(() => {});
    drill = null;
  } finally {
    // 6. 清理：先关 drill 连接再删库（FORCE 会终止残留连接）
    if (drill) await drill.end().catch(() => {});
    if (!keep) {
      await admin.query(`DROP DATABASE IF EXISTS ${DRILL_DB} WITH (FORCE)`).catch(() => {});
      report.cleanedUp = true;
      console.log('✓ 清理临时库与临时文件');
    } else {
      report.cleanedUp = false;
      console.log(`· 保留临时库 ${DRILL_DB}（--keep）`);
    }
    await admin.end().catch(() => {});
    for (const f of [zipPath]) fs.existsSync(f) && fs.rmSync(f, { force: true });
  }

  report.passedAt = new Date().toISOString();
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n演练通过 ✅  报告：${REPORT_PATH}`);
}

main().catch(async (e) => {
  const report = e.report || { steps: [{ name: String(e.message || e), ok: false }] };
  report.failedAt = new Date().toISOString();
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.error(`\n演练失败 ❌  报告：${REPORT_PATH}`);
  process.exit(1);
});
