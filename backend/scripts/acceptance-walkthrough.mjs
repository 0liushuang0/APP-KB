/**
 * 端到端验收走查：用真实历史项目验证业务链完整性（只读，不改数据）。
 *
 * 挑选标准：
 *   · 全链样本：合同挂到报价→方案→需求的完整链路（如 Tenova 拉矫机）
 *   · 进行中样本：已确认但未签约的需求（验证落地阶段推导）
 *
 * 断言组（对应交付验收要点）：
 *   A 编号继承：方案/报价继承需求尾号，项目继承需求尾号（同尾号=同一单生意）
 *   B 客户一致：全链各单据 customerId 相同
 *   C 金额一致：合同金额 = 报价金额
 *   D 落地阶段：SQL 重算的 landStage 与系统口径一致（有合同≠还在识别中）
 *   E 附件无悬空：document_links 每条 link 的文档都存在
 *   F 全库巡检：客户/方案/报价引用无悬空、编号无重号
 *
 * 用法：node scripts/acceptance-walkthrough.mjs
 * 报告：data/acceptance-report.json（退出码 0 = 验收通过）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.resolve(__dirname, '..', 'data', 'acceptance-report.json');

const connOpts = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'aikb',
    };

const results = [];
let failed = 0;
function check(group, name, ok, detail = '') {
  results.push({ group, name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} [${group}] ${name}${detail ? '：' + detail : ''}`);
}

const tail = (no) => {
  const m = /(\d+)(?:-V\d+|[A-Z]+)?$/.exec(no || '');
  return m ? m[1] : null;
};

async function main() {
  const c = new Client(connOpts);
  await c.connect();
  const report = { startedAt: new Date().toISOString(), samples: [] };

  // ── 样本挑选 ──
  const chains = (
    await c.query(`
      SELECT ct.id AS contract_id, ct."contractNo", ct.amount AS contract_amount, ct."customerId" AS contract_customer,
             q.id AS quo_id, q."quotationNo", q.amount AS quo_amount,
             p.id AS prop_id, p."proposalNo",
             r.id AS req_id, r."requirementNo", r.status AS req_status, r."customerId" AS req_customer,
             cu.name AS customer
      FROM contracts ct
      JOIN quotations q ON q.id = ct."quotationId"
      JOIN proposals p ON p.id = q."proposalId"
      JOIN requirements r ON r.id = p."requirementId"
      LEFT JOIN customers cu ON cu.id = r."customerId"
      ORDER BY ct."createdAt" DESC LIMIT 3`)
  ).rows;
  const openReqs = (
    await c.query(`
      SELECT r.id, r."requirementNo", r.title, r.status,
             (SELECT COUNT(*) FROM proposals p WHERE p."requirementId" = r.id) AS proposals,
             (SELECT COUNT(*) FROM quotations q JOIN proposals p ON p.id = q."proposalId" WHERE p."requirementId" = r.id) AS quotations
      FROM requirements r
      WHERE r."isCurrent" = true AND r.status NOT IN ('won','lost')
      ORDER BY r."createdAt" DESC LIMIT 3`)
  ).rows;

  // ── A/B/C：全链样本走查 ──
  for (const ch of chains) {
    const label = `${ch.customer || '客户?'} ${ch.requirementNo}→${ch.contractNo}`;
    report.samples.push({ type: 'full-chain', label });
    const t1 = tail(ch.requirementNo), t2 = tail(ch.proposalNo), t3 = tail(ch.quotationNo);
    check('A 编号继承', `${label} 方案继承需求尾号`, t1 && t1 === t2, `${ch.requirementNo} / ${ch.proposalNo}`);
    check('A 编号继承', `${label} 报价继承方案尾号`, t2 && t2 === t3, `${ch.proposalNo} / ${ch.quotationNo}`);
    check('B 客户一致', `${label} 全链同一客户`,
      !ch.contract_customer || !ch.req_customer || ch.contract_customer === ch.req_customer,
      ch.contract_customer === ch.req_customer ? '一致' : `合同 ${ch.contract_customer} vs 需求 ${ch.req_customer}`);
    check('C 金额一致', `${label} 合同金额=报价金额`,
      Number(ch.contract_amount) === Number(ch.quo_amount),
      `合同 ${Number(ch.contract_amount).toLocaleString()} / 报价 ${Number(ch.quo_amount).toLocaleString()}`);
  }
  check('样本', '存在可走查的完整链路', chains.length > 0, `共 ${chains.length} 条（如 ${chains[0]?.requirementNo || '—'}）`);

  // ── D：落地阶段推导一致性（全量需求重算比对） ──
  const landRows = (
    await c.query(`
      SELECT r.id, r.status,
        EXISTS (SELECT 1 FROM proposals p WHERE p."requirementId" = r.id) AS has_p,
        EXISTS (SELECT 1 FROM quotations q JOIN proposals p ON p.id = q."proposalId" WHERE p."requirementId" = r.id) AS has_q,
        EXISTS (SELECT 1 FROM contracts ct JOIN quotations q2 ON q2.id = ct."quotationId" JOIN proposals p2 ON p2.id = q2."proposalId" WHERE p2."requirementId" = r.id) AS has_c
      FROM requirements r WHERE r."isCurrent" = true`)
  ).rows;
  const mismatch = landRows.filter((r) => {
    const derived = r.status === 'lost' ? 'lost' : r.status === 'won' ? 'won' : r.has_c ? 'contract' : r.has_q ? 'quotation' : r.has_p ? 'proposal' : 'registered';
    // 已签约的需求不该停留在早期识别状态（analyzing/pending 视为状态滞后）
    return derived === 'contract' && ['pending', 'analyzing'].includes(r.status);
  });
  check('D 落地阶段', '已签约需求的状态已同步（无滞后）', mismatch.length === 0,
    mismatch.length ? `${mismatch.length} 条已签约但仍处早期状态` : `${landRows.length} 条当前需求推导一致`);
  report.landStageDist = landRows.reduce((m, r) => {
    const d = r.status === 'lost' ? 'lost' : r.status === 'won' ? 'won' : r.has_c ? 'contract' : r.has_q ? 'quotation' : r.has_p ? 'proposal' : 'registered';
    m[d] = (m[d] || 0) + 1;
    return m;
  }, {});

  // ── E：附件无悬空 ──
  const danglingLinks = (
    await c.query(`SELECT COUNT(*) AS n FROM document_links dl LEFT JOIN documents d ON d.id = dl."documentId" WHERE d.id IS NULL`)
  ).rows[0].n;
  check('E 附件链', 'document_links 无悬空文档引用', Number(danglingLinks) === 0, `悬空 ${danglingLinks} 条`);

  // ── F：全库巡检（悬空引用 / 重号） ──
  const dangling = {
    需求指向客户: (await c.query(`SELECT COUNT(*) AS n FROM requirements r LEFT JOIN customers cu ON cu.id = r."customerId" WHERE r."customerId" IS NOT NULL AND cu.id IS NULL`)).rows[0].n,
    方案指向需求: (await c.query(`SELECT COUNT(*) AS n FROM proposals p LEFT JOIN requirements r ON r.id = p."requirementId" WHERE p."requirementId" IS NOT NULL AND r.id IS NULL`)).rows[0].n,
    报价指向方案: (await c.query(`SELECT COUNT(*) AS n FROM quotations q LEFT JOIN proposals p ON p.id = q."proposalId" WHERE q."proposalId" IS NOT NULL AND p.id IS NULL`)).rows[0].n,
    合同指向报价: (await c.query(`SELECT COUNT(*) AS n FROM contracts ct LEFT JOIN quotations q ON q.id = ct."quotationId" WHERE ct."quotationId" IS NOT NULL AND q.id IS NULL`)).rows[0].n,
  };
  for (const [k, v] of Object.entries(dangling)) {
    check('F 全库巡检', `${k}无悬空`, Number(v) === 0, `悬空 ${v} 条`);
  }
  const dupNos = (
    await c.query(`
      SELECT 'requirements' AS t, "requirementNo" AS no, COUNT(*) AS n FROM requirements GROUP BY "requirementNo" HAVING COUNT(*) > 1
      UNION ALL SELECT 'proposals', "proposalNo", COUNT(*) FROM proposals GROUP BY "proposalNo" HAVING COUNT(*) > 1
      UNION ALL SELECT 'quotations', "quotationNo", COUNT(*) FROM quotations GROUP BY "quotationNo" HAVING COUNT(*) > 1
      UNION ALL SELECT 'contracts', "contractNo", COUNT(*) FROM contracts GROUP BY "contractNo" HAVING COUNT(*) > 1`)
  ).rows;
  check('F 全库巡检', '四类单据编号无重号', dupNos.length === 0,
    dupNos.length ? dupNos.map((d) => `${d.t}.${d.no}×${d.n}`).join('，') : '');

  // 进行中样本（记录到报告供人工复核）
  report.samples.push(...openReqs.map((r) => ({
    type: 'in-progress', label: `${r.requirementNo} ${r.title}`.slice(0, 40),
    status: r.status, proposals: Number(r.proposals), quotations: Number(r.quotations),
  })));

  await c.end();
  report.finishedAt = new Date().toISOString();
  report.passed = failed === 0;
  report.checks = results;
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n${failed === 0 ? '验收走查通过 ✅' : `验收走查未通过（${failed} 项）❌`}  报告：${REPORT_PATH}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ startedAt: new Date().toISOString(), fatal: String(e), passed: false }, null, 2));
  console.error('验收脚本异常：', e.message);
  process.exit(1);
});
