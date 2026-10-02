#!/usr/bin/env node
/**
 * 性能基线实测（评估框架 P1：量化指标"未实测不得分"）。
 *
 * 对关键接口各打 N 发请求，输出 P50/P95/P99/均值，并写入
 * docs/perf-baseline.md（追加式，形成历史基线档案）。
 *
 * 用法：node scripts/perf-baseline.mjs [--n 50] [--base http://localhost:3101]
 * 环境依赖：后端已启动（单机模式自动登录拿会话）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const nIdx = args.indexOf('--n');
const N = nIdx >= 0 ? parseInt(args[nIdx + 1], 10) || 50 : 50;
const bIdx = args.indexOf('--base');
const BASE = (bIdx >= 0 ? args[bIdx + 1] : 'http://localhost:3101').replace(/\/$/, '');

// 单机模式自动登录 → 复用 Cookie（业务接口需要会话）
async function login() {
  const res = await fetch(`${BASE}/api/auth/single-mode-login`, { method: 'POST' });
  const cookie = res.headers.get('set-cookie') || '';
  return cookie.split(',').map((c) => c.split(';')[0]).join('; ');
}

async function hit(url, cookie) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: cookie ? { cookie } : {} });
  await res.arrayBuffer();
  return { ms: performance.now() - t0, status: res.status };
}

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const at = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 10) / 10;
  return {
    p50: at(0.5), p95: at(0.95), p99: at(0.99),
    avg: Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10,
    max: Math.round(s[s.length - 1] * 10) / 10,
  };
}

const cookie = await login();

// 关键接口清单（覆盖：公开、登录态列表、详情聚合、统计聚合）
const TARGETS = [
  { name: 'GET /api/auth/mode（公开）', url: `${BASE}/api/auth/mode` },
  { name: 'GET /api/system/info（公开）', url: `${BASE}/api/system/info` },
  { name: 'GET /api/customers?pageSize=20（列表+权限过滤）', url: `${BASE}/api/customers?pageSize=20` },
  { name: 'GET /api/quotations?pageSize=20（列表+关联）', url: `${BASE}/api/quotations?pageSize=20` },
  { name: 'GET /api/documents?pageSize=20（文档列表）', url: `${BASE}/api/documents?pageSize=20` },
  { name: 'GET /api/system/dashboard-stats（工作台聚合）', url: `${BASE}/api/system/dashboard-stats` },
  { name: 'GET /api/system/module-stats（六模块计数聚合）', url: `${BASE}/api/system/module-stats` },
];

const rows = [];
for (const t of TARGETS) {
  // 预热 3 发（首发的 JIT/缓存开销不算基线）
  for (let i = 0; i < 3; i++) await hit(t.url, cookie);
  const samples = [];
  let badStatus = 0;
  for (let i = 0; i < N; i++) {
    const r = await hit(t.url, cookie);
    if (r.status >= 400) badStatus += 1;
    samples.push(r.ms);
  }
  const st = stats(samples);
  rows.push({ ...t, ...st, badStatus });
  console.log(`${t.name.padEnd(42)} P50=${st.p50}ms P95=${st.p95}ms P99=${st.p99}ms avg=${st.avg}ms${badStatus ? ` [${badStatus} 个非2xx]` : ''}`);
}

// 追加写入基线档案
const doc = path.join(root, 'docs', 'perf-baseline.md');
const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
const lines = [
  `## ${date}（N=${N}/接口，base=${BASE}，Node ${process.version}）`,
  '',
  '| 接口 | P50 | P95 | P99 | avg | max |',
  '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.name} | ${r.p50}ms | ${r.p95}ms | ${r.p99}ms | ${r.avg}ms | ${r.max}ms |`),
  '',
].join('\n');
if (!fs.existsSync(doc)) {
  fs.writeFileSync(doc, `# 性能基线档案\n\n> 由 scripts/perf-baseline.mjs 生成；每次运行追加一节。P99 < 500ms 为框架达标线。\n\n${lines}`);
} else {
  fs.appendFileSync(doc, lines);
}
console.log(`\n✓ 已追加到 docs/perf-baseline.md`);
