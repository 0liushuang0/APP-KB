/**
 * 把需求的「分类」拆成「需求来源」和「需求分类」。
 *
 * 历史状况：requirements.category 这一个字段里装的是产品大类
 * （板带精整装备/剪切设备…），而界面上它被当作来源类型
 * （招标文件/询价单…）来筛选 —— 于是筛选框永远查不到东西；
 * 与此同时 templateCategory 基本是空的，结构化分析找不到模板可套。
 *
 * 本脚本做两件事：
 *   1. 把 category 里的产品大类搬到 templateCategory，并归一到模板实际的命名
 *      （「板带精整装备/剪切设备」→「装备/剪切设备」）
 *   2. category 腾空后填 'other'（来源未知），由业务侧后续按实际渠道修正
 *
 * 用法：node backend/scripts/split-requirement-category.mjs [--apply]
 * 不带 --apply 只打印对照表。
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.db')
const APPLY = process.argv.includes('--apply')

/** 需求侧的旧叫法 → 模板侧的正式分类 */
const TAXONOMY = {
  板带精整装备: '装备',
  精密零部件: '零部件',
  产线: '生产线',
}

const db = new Database(DB_PATH, { readonly: !APPLY })
const templates = db.prepare('SELECT category FROM param_templates').all().map((t) => t.category)
const rows = db.prepare('SELECT id, requirementNo, category, templateCategory FROM requirements').all()

/** 把需求里的产品大类映射到真实存在的模板分类 */
function mapToTemplate(raw) {
  if (!raw) return null
  if (templates.includes(raw)) return raw

  const slash = raw.indexOf('/')
  if (slash > 0) {
    const parent = raw.slice(0, slash)
    const sub = raw.slice(slash + 1)
    const mapped = `${TAXONOMY[parent] || parent}/${sub}`
    if (templates.includes(mapped)) return mapped
    // 大类对不上时，只按子类名找一个唯一匹配
    const bySub = templates.filter((t) => t.endsWith(`/${sub}`))
    if (bySub.length === 1) return bySub[0]
  }
  // 无斜杠的整体名（如「燃油输送装置」）也试一次子类匹配
  const loose = templates.filter((t) => t.split('/').pop() === raw)
  return loose.length === 1 ? loose[0] : null
}

const plan = []
for (const r of rows) {
  const target = mapToTemplate(r.category)
  plan.push({
    ...r,
    newTemplateCategory: r.templateCategory || target,
    matched: !!target,
  })
}

console.log('需求编号        原 category                  → 需求分类(templateCategory)')
console.log('-'.repeat(88))
for (const p of plan) {
  const mark = p.newTemplateCategory ? (p.matched ? '  ' : '≈ ') : '! '
  console.log(
    `${mark}${String(p.requirementNo).padEnd(14)} ${String(p.category || '(空)').padEnd(26)} → ${
      p.newTemplateCategory || '（没有匹配的模板，需人工指定）'
    }`,
  )
}

const unmatched = plan.filter((p) => !p.newTemplateCategory)
console.log(
  `\n可归位 ${plan.length - unmatched.length} 条，无法自动匹配 ${unmatched.length} 条` +
    (unmatched.length ? `：${unmatched.map((p) => p.requirementNo).join(', ')}` : ''),
)

if (APPLY) {
  const update = db.prepare(
    'UPDATE requirements SET templateCategory = ?, category = ? WHERE id = ?',
  )
  const run = db.transaction((items) => {
    for (const p of items) {
      if (!p.newTemplateCategory) continue
      // category 原本装的是产品大类，搬走后置为「其他」来源，等业务侧填真实渠道
      update.run(p.newTemplateCategory, 'other', p.id)
    }
  })
  run(plan)
  console.log('\n已写入。请到「客户需求」页把「需求来源」按实际渠道（招标/询价/技术规范）逐条修正。')
} else {
  console.log('\n这是预览。确认无误后加 --apply 执行。')
}

db.close()
