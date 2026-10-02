/**
 * 修复需求删除/断链后遗留的孤儿资料关联。
 *
 * 背景：旧版本两处缺陷会在客户档案里留下孤儿资料：
 *   1. 删需求只删需求行，document_links 没清（删除语句一度是坏的）；
 *   2. 需求保存前就能上传资料，关联建时 entityId 为空被降级挂到客户级，
 *      requirementId 永远为空（如宝钢湛江 REQ-2026-004 的《代码分析.txt》）。
 * 结果：删需求清不掉这些关联，文档永远留在客户 360 的"文档"页签。
 * 现行代码已修（关联必须带实体 id；删需求时专属资料一并送回收站），
 * 本脚本把历史遗留扫干净。
 *
 * 处理规则：资料标题带需求编号（需求页上传时会写进标题，如 "REQ-2026-004 - x.txt"）
 * 但关联的 requirementId 为空或悬空的：
 *   · 需求还在 → 把 requirementId 修回该需求、阶段改回 requirement（断链修复）；
 *   · 需求已删 → 删掉孤儿关联；若资料再无其他关联，整份按页面删除的同款
 *     格式送回收站（可还原），物理文件移到 uploads/.trash，不直接抹掉。
 * 另附带清理 requirementId 指向不存在需求的悬空关联。
 *
 * 用法：node backend/scripts/fix-orphan-doc-links.mjs [--apply]
 * 不带 --apply 只打印对照表。
 */
import Database from 'better-sqlite3'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_ROOT = path.resolve(__dirname, '..')
const DB_PATH = path.join(BACKEND_ROOT, 'data', 'app.db')
const UPLOADS_BASE = path.join(BACKEND_ROOT, 'data', 'uploads')
const TRASH_DIR = path.join(UPLOADS_BASE, '.trash')
const APPLY = process.argv.includes('--apply')

const db = new Database(DB_PATH, { readonly: !APPLY })

/** fileKey → 物理路径，规则与后端 resolveDocumentFilePath 保持一致 */
function filePathOf(fileKey) {
  if (!fileKey) return null
  if (/^(documents|knowledge|versions)\//.test(fileKey)) {
    return path.join(UPLOADS_BASE, ...fileKey.split('/'))
  }
  return path.join(UPLOADS_BASE, 'documents', fileKey)
}

// ── 1. 收集问题关联 ──
// 1a. requirementId 指向已不存在的需求（悬空引用）
const danglingLinks = db.prepare(`
  SELECT l.id, l.documentId, d.title, d.fileName
  FROM document_links l
  JOIN documents d ON d.id = l.documentId
  WHERE l.requirementId IS NOT NULL AND l.requirementId <> ''
    AND NOT EXISTS (SELECT 1 FROM requirements r WHERE r.id = l.requirementId)
`).all()

// 1b. 标题带需求编号但关联上没挂（或挂错）：断链与孤儿都在这里分流
const reqByNo = db.prepare('SELECT id FROM requirements WHERE requirementNo = ?')
const titleLinks = db.prepare(`
  SELECT l.id, l.documentId, l.requirementId, l.stage, d.title, d.fileName
  FROM document_links l
  JOIN documents d ON d.id = l.documentId
  WHERE d.title LIKE '%REQ-%'
`).all()
const repairs = []  // 需求还在：修回 requirementId
const titleOrphans = [] // 需求已删：孤儿，删关联
for (const l of titleLinks) {
  const nos = String(l.title).match(/REQ-\d{4}-\d+/g) || []
  if (!nos.length) continue
  const req = reqByNo.get(nos[0])
  if (req) {
    if (l.requirementId !== req.id) repairs.push({ ...l, targetRequirementId: req.id })
  } else if (!l.requirementId && nos.every((no) => !reqByNo.get(no))) {
    titleOrphans.push(l)
  }
}

// 待删除的孤儿：悬空引用 + 标题对应的需求已不存在
const orphanMap = new Map()
for (const l of [...danglingLinks, ...titleOrphans]) orphanMap.set(l.id, l)
const orphans = [...orphanMap.values()]

if (!orphans.length && !repairs.length) {
  console.log('没有发现孤儿关联或断链，无需处理。')
  db.close()
  process.exit(0)
}

// ── 2. 判定每份资料清完孤儿后是否还剩关联 ──
const orphanIds = orphans.map((o) => o.id)
const countOtherLinks = orphanIds.length
  ? db.prepare(
      'SELECT COUNT(*) c FROM document_links WHERE documentId = ? AND id NOT IN (' +
        orphanIds.map(() => '?').join(',') + ')',
    )
  : null
const plans = []
for (const l of orphans) {
  let plan = plans.find((p) => p.documentId === l.documentId)
  if (!plan) {
    const remaining = countOtherLinks.get(l.documentId, ...orphanIds).c
    plan = { documentId: l.documentId, links: [], remaining }
    plans.push(plan)
  }
  plan.links.push(l)
}

if (repairs.length) {
  console.log(`断链修复 ${repairs.length} 条（需求还在，把 requirementId 修回）：`)
  for (const r of repairs) {
    console.log(`  ${r.title || r.fileName} → ${r.targetRequirementId}`)
  }
  console.log('')
}
if (plans.length) {
  console.log(`孤儿关联 ${orphans.length} 条，涉及 ${plans.length} 份资料：\n`)
  for (const p of plans) {
    const doc = db.prepare('SELECT title, fileName FROM documents WHERE id = ?').get(p.documentId)
    const action = p.remaining === 0 ? '资料无其他关联 → 整份送回收站' : `资料另有 ${p.remaining} 条关联 → 只删孤儿关联`
    console.log(`  ${doc.title || doc.fileName}`)
    console.log(`    关联 ${p.links.length} 条孤儿，${action}`)
  }
}

if (!APPLY) {
  console.log('\n这是预览。确认无误后加 --apply 执行。')
  db.close()
  process.exit(0)
}

// ── 3. 执行：断链修回；孤儿关联删除；无剩余关联的资料整份进回收站 ──
const now = new Date()
const expiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000)
const iso = (d) => d.toISOString().replace('T', ' ').slice(0, 19)
const delLink = db.prepare('DELETE FROM document_links WHERE id = ?')
const getDoc = db.prepare('SELECT * FROM documents WHERE id = ?')
const getVersions = db.prepare('SELECT * FROM document_versions WHERE documentId = ?')
const getLinks = db.prepare('SELECT * FROM document_links WHERE documentId = ?')
const insRecycle = db.prepare(
  `INSERT INTO recycle_bin (id, entityType, entityId, entityData, deletedBy, deletedAt, expiresAt)
   VALUES (?, 'document', ?, ?, ?, ?, ?)`,
)

function moveToTrash(absPath, bucket) {
  if (!absPath || !fs.existsSync(absPath)) return null
  fs.mkdirSync(bucket, { recursive: true })
  const to = path.join(bucket, path.basename(absPath))
  fs.renameSync(absPath, to)
  return { from: absPath, to }
}

const run = db.transaction(() => {
  // 断链修复：requirementId 修回需求，阶段回到需求文件
  const repairStmt = db.prepare(
    `UPDATE document_links SET requirementId = ?, stage = 'requirement' WHERE id = ?`,
  )
  for (const r of repairs) repairStmt.run(r.targetRequirementId, r.id)

  for (const p of plans) {
    for (const l of p.links) delLink.run(l.id)
    if (p.remaining > 0) continue

    // 无剩余关联：整份资料按页面删除的同款快照进回收站
    const doc = getDoc.get(p.documentId)
    if (!doc) continue
    const versions = getVersions.all(p.documentId)
    const links = getLinks.all(p.documentId) // 孤儿关联已删，这里应为空

    const recycleId = crypto.randomUUID()
    const bucket = path.join(TRASH_DIR, recycleId)
    const moved = []
    const m = moveToTrash(filePathOf(doc.fileKey), bucket)
    if (m) moved.push(m)
    for (const v of versions) {
      const mv = moveToTrash(filePathOf(v.fileKey), bucket)
      if (mv) moved.push(mv)
    }

    insRecycle.run(
      recycleId,
      doc.id,
      JSON.stringify({
        document: doc,
        versions,
        links,
        sourceType: (doc.category || '').startsWith('knowledge') ? 'knowledge' : 'document',
        files: moved,
      }),
      'system-cleanup',
      iso(now),
      iso(expiresAt),
    )
    db.prepare('DELETE FROM document_versions WHERE documentId = ?').run(p.documentId)
    db.prepare('DELETE FROM document_links WHERE documentId = ?').run(p.documentId)
    db.prepare('DELETE FROM documents WHERE id = ?').run(p.documentId)
  }
})
run()

console.log(
  `\n已修复断链 ${repairs.length} 条，清理孤儿关联 ${orphans.length} 条，` +
    `${plans.filter((p) => p.remaining === 0).length} 份资料送回收站（30 天内可还原）。`,
)
console.log('注意：被送回收站资料的 AI 向量索引不会自动清理，如需彻底清除请重启后端由回收清理任务处理。')
db.close()
