/**
 * 修复悬空的 customerId。
 *
 * 现状：方案 9 条、报价 9 条、项目 10 条的 customerId 指向已不存在的客户
 * （历史数据留下的，删客户时没有级联处理）。界面上现在不受影响 ——
 * 客户已改为顺着链路从需求取值 —— 但这些坏引用留在库里迟早会咬人：
 * 任何直接按 customerId 做的统计、筛选、导出都会少算或对不上。
 *
 * 好在链路本身完好（requirementId / proposalId 无一悬空），
 * 所以每一条都能顺着走到需求，拿回正确的客户：
 *
 *     方案 → 需求.customerId
 *     报价 → 方案 → 需求.customerId
 *     项目 → 需求.customerId
 *
 * 用法：node backend/scripts/fix-dangling-customer-refs.mjs [--apply]
 * 不带 --apply 只打印对照表。
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.db')
const APPLY = process.argv.includes('--apply')

const db = new Database(DB_PATH, { readonly: !APPLY })

/** 每类单据：如何找到它应有的客户 */
const SOURCES = [
  {
    label: '方案',
    table: 'proposals',
    noCol: 'proposalNo',
    sql: `
      SELECT p.id, p.proposalNo AS no, p.customerId AS oldId,
             r.customerId AS newId, c.name AS newName
      FROM proposals p
      LEFT JOIN requirements r ON r.id = p.requirementId
      LEFT JOIN customers c ON c.id = r.customerId
      WHERE p.customerId IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM customers x WHERE x.id = p.customerId)
    `,
  },
  {
    label: '报价',
    table: 'quotations',
    noCol: 'quotationNo',
    sql: `
      SELECT q.id, q.quotationNo AS no, q.customerId AS oldId,
             r.customerId AS newId, c.name AS newName
      FROM quotations q
      LEFT JOIN proposals p ON p.id = q.proposalId
      LEFT JOIN requirements r ON r.id = p.requirementId
      LEFT JOIN customers c ON c.id = r.customerId
      WHERE q.customerId IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM customers x WHERE x.id = q.customerId)
    `,
  },
  {
    label: '项目',
    table: 'projects',
    noCol: 'projectNo',
    sql: `
      SELECT pr.id, pr.projectNo AS no, pr.customerId AS oldId,
             r.customerId AS newId, c.name AS newName
      FROM projects pr
      LEFT JOIN requirements r ON r.id = pr.requirementId
      LEFT JOIN customers c ON c.id = r.customerId
      WHERE pr.customerId IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM customers x WHERE x.id = pr.customerId)
    `,
  },
]

let fixable = 0
let orphan = 0
const plans = []

for (const src of SOURCES) {
  const rows = db.prepare(src.sql).all()
  if (!rows.length) continue

  console.log(`\n${src.label}（${rows.length} 条悬空）`)
  for (const r of rows) {
    if (r.newId) {
      console.log(`  ${String(r.no).padEnd(16)} → ${r.newName}`)
      fixable++
    } else {
      // 顺着链路也找不到客户：这条单据本身就断在半路，只能人工处理
      console.log(`  ${String(r.no).padEnd(16)} ！链路上没有客户，需人工指定`)
      orphan++
    }
  }
  plans.push({ src, rows: rows.filter((r) => r.newId) })
}

console.log(`\n可自动修复 ${fixable} 条，无法自动判断 ${orphan} 条`)

if (!APPLY) {
  console.log('\n这是预览。确认无误后加 --apply 执行。')
  db.close()
  process.exit(0)
}

const run = db.transaction(() => {
  for (const { src, rows } of plans) {
    const upd = db.prepare(`UPDATE ${src.table} SET customerId = ? WHERE id = ?`)
    for (const r of rows) upd.run(r.newId, r.id)
  }
})
run()

// 复核：修完之后应该一条悬空都不剩
let remaining = 0
for (const src of SOURCES) {
  remaining += db.prepare(src.sql).all().length
}
console.log(`\n已修复 ${fixable} 条。复核剩余悬空：${remaining} 条`)

db.close()
