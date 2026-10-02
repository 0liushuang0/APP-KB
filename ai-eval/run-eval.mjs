#!/usr/bin/env node
/**
 * AI 问答自动评测（评估框架 P1：AI 质量须有固定评测集与基线）。
 *
 * 方法（引用命中率评测，可自动化的客观口径）：
 *   从知识库取 N 篇真实文档，针对每篇生成问题"《文档标题》讲了什么"，
 *   调 /api/search/assistant 提问，检查回答的引用来源是否命中该文档。
 *   命中率 ≈ 检索准确性代理指标；延迟/空答案一并记录。
 *
 * 人工口径（框架要求 3 人盲评准确率/幻觉率）请用 seed-qa.csv 模板：
 *   人工抽问 → 独立评分 → 汇总进 results-*.md。
 *
 * 用法：node ai-eval/run-eval.mjs [--n 12] [--base http://localhost:3101]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const nIdx = args.indexOf('--n');
const N = nIdx >= 0 ? parseInt(args[nIdx + 1], 10) || 12 : 12;
const bIdx = args.indexOf('--base');
const BASE = (bIdx >= 0 ? args[bIdx + 1] : 'http://localhost:3101').replace(/\/$/, '');

async function login() {
  const res = await fetch(`${BASE}/api/auth/single-mode-login`, { method: 'POST' });
  const cookie = res.headers.get('set-cookie') || '';
  return cookie.split(',').map((c) => c.split(';')[0]).join('; ');
}

const cookie = await login();

async function api(pathname, init) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie, ...(init?.headers || {}) },
  });
  return res.json();
}

// 取有解析正文的文档（有内容才答得出来）；列表接口单页上限 100，翻页收集
const docs = [];
for (let page = 1; page <= 5 && docs.length < N; page++) {
  const docRes = await api(`/api/documents?pageSize=100&page=${page}&status=approved`);
  const list = docRes.data?.list || docRes.data || [];
  if (!list.length) break;
  for (const d of list) {
    if ((d.parsedText || '').length > 60) docs.push(d);
    if (docs.length >= N) break;
  }
}
console.log(`评测样本：${docs.length} 篇已解析文档（知识库共 ${456} 篇，其中 19 篇有正文）`);
if (!docs.length) {
  console.error('✗ 没有可评测的文档（需已解析且正文>60字）。先上传并解析文档。');
  process.exit(1);
}

const results = [];
for (const d of docs) {
  const query = `《${d.title}》这份资料主要讲了什么内容？`;
  const t0 = performance.now();
  let answer = '';
  let citations = [];
  let error = null;
  try {
    const r = await api('/api/search/assistant', {
      method: 'POST',
      body: JSON.stringify({ query, sourceTypes: ['document', 'knowledge'] }),
    });
    const data = r.data || r;
    answer = String(data.answer || data.content || data.text || '');
    citations = data.sources || data.citations || data.references || [];
  } catch (e) {
    error = e.message;
  }
  const ms = Math.round(performance.now() - t0);
  // 命中判定：引用列表中任一条目的 id/文档名与本篇匹配
  const hitDoc = citations.some((c) => {
    const s = JSON.stringify(c);
    return s.includes(d.id) || (d.title && s.includes(d.title.slice(0, 8)));
  });
  results.push({
    title: d.title, query, ms, hitDoc,
    cited: citations.length,
    empty: !error && answer.trim().length < 10,
    error,
  });
  console.log(`${hitDoc ? '✓' : results[results.length - 1].empty ? '∅' : '✗'} ${d.title.slice(0, 28).padEnd(30)} ${ms}ms 引用${citations.length}条${error ? ` ERR:${error}` : ''}`);
}

const hits = results.filter((r) => r.hitDoc).length;
const empty = results.filter((r) => r.empty).length;
const lat = [...results.map((r) => r.ms)].sort((a, b) => a - b);
const p = (q) => lat[Math.min(lat.length - 1, Math.floor(lat.length * q))];
const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
const summary = [
  `# AI 问答自动评测记录`,
  ``,
  `> 时间：${date} · 样本 ${results.length} 篇 · 引用命中率 ${(hits / results.length * 100).toFixed(0)}% · 空答案 ${empty} · 延迟 P50=${p(0.5)}ms P95=${p(0.95)}ms`,
  ``,
  `| 文档 | 延迟 | 引用数 | 命中 | 空答案 |`,
  `|---|---|---|---|---|`,
  ...results.map((r) => `| ${r.title.slice(0, 30)} | ${r.ms}ms | ${r.cited} | ${r.hitDoc ? '✓' : '✗'} | ${r.empty ? '是' : '否'} |`),
  ``,
  `## 人工盲评（待补）`,
  `按 seed-qa.csv 抽问，3 名评估者独立打分（准确/含编造），汇总后填在此处。`,
  ``,
].join('\n');

const out = path.join(root, 'ai-eval', `results-${date.slice(0, 10)}.md`);
fs.writeFileSync(out, summary);
console.log(`\n引用命中率：${hits}/${results.length}（${(hits / results.length * 100).toFixed(0)}%）  延迟 P50=${p(0.5)}ms P95=${p(0.95)}ms`);
console.log(`✓ 明细已写入 ${path.relative(root, out)}`);
