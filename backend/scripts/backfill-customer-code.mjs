/**
 * 回填客户编码。
 *
 * customerCode 是后加的字段（原来的 code 一直装的是简称），
 * 所以现存 195 条客户的编码全是空的。这里按「系统设置 → 编号规则」里
 * 配置的客户编码规则批量补上。
 *
 * 几个约定：
 *   · 已有编码的跳过，不覆盖 —— 编码一旦对外用过就不该变
 *   · 按创建时间排序生成，保证结果稳定可复现（重复跑得到同样的结果）
 *   · 年份取客户自己的创建年，跨年时流水号各自从 1 开始
 *
 * 用法：node backend/scripts/backfill-customer-code.mjs [--apply]
 * 不带 --apply 只打印前后对照。
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.db')
const APPLY = process.argv.includes('--apply')

const DEFAULT_RULE = { prefix: 'CUST', yearFormat: 'YYYY', digits: 3, separator: '-' }

const db = new Database(DB_PATH, { readonly: !APPLY })

// 用界面上配置的规则，而不是脚本里另写一套 —— 否则两处会渐渐对不上
let rule = DEFAULT_RULE
const row = db.prepare("SELECT value FROM system_configs WHERE key='numbering.rules'").get()
if (row?.value) {
  try {
    rule = { ...DEFAULT_RULE, ...(JSON.parse(row.value).customer || {}) }
  } catch {
    /* 配置坏了就用默认 */
  }
}

const yearPart = (iso) => {
  const y = String(iso || '').slice(0, 4) || String(new Date().getFullYear())
  if (rule.yearFormat === 'YYYY') return y
  if (rule.yearFormat === 'YY') return y.slice(-2)
  return null
}

const buildPrefix = (iso) => {
  const y = yearPart(iso)
  return [rule.prefix, ...(y ? [y] : [])].join(rule.separator) + rule.separator
}

const customers = db
  .prepare('SELECT id, name, code, customerCode, createdAt FROM customers ORDER BY createdAt, name')
  .all()

// 已占用的编码要避开，避免和手工填过的撞车
const taken = new Set(customers.map((c) => c.customerCode).filter(Boolean))
const counters = new Map()

const plan = []
for (const c of customers) {
  if (c.customerCode) continue

  const prefix = buildPrefix(c.createdAt)
  let n = counters.get(prefix) || 0
  let code
  do {
    n += 1
    code = prefix + String(n).padStart(rule.digits, '0')
  } while (taken.has(code))
  counters.set(prefix, n)
  taken.add(code)

  plan.push({ id: c.id, name: c.name, short: c.code, code })
}

console.log(`规则：${JSON.stringify(rule)}`)
console.log(`客户 ${customers.length} 条，待回填 ${plan.length} 条\n`)

for (const p of plan.slice(0, 8)) {
  console.log(`  ${p.code}  ${String(p.short || '').padEnd(10)} ${p.name}`)
}
if (plan.length > 8) {
  console.log(`  … 其余 ${plan.length - 8} 条`)
  const last = plan[plan.length - 1]
  console.log(`  ${last.code}  ${String(last.short || '').padEnd(10)} ${last.name}`)
}

if (APPLY) {
  const upd = db.prepare('UPDATE customers SET customerCode = ? WHERE id = ?')
  const run = db.transaction((items) => {
    for (const p of items) upd.run(p.code, p.id)
  })
  run(plan)
  console.log(`\n已写入 ${plan.length} 条客户编码。`)
} else {
  console.log('\n这是预览。确认无误后加 --apply 执行。')
}

db.close()
