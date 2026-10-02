/**
 * 导入《2024年常用外购件品牌及交货期》。
 *
 * 源文件是 Word 转出来的制表符文本，里头混着几张列结构不同的表：
 *   · 六列表  序号 / 名称 / 档次 / 品牌 / 货期 / 备注
 *   · 四列表  序号 / 名称 / 供货厂商 / 备注   （13.1.2 流体、13.1.3 电气、13.1.4 焊机）
 *   · 一张中英对照的产线设备表，列结构极不规整 —— 跳过，硬解只会导入一堆脏数据
 *
 * 落到两张表：
 *   suppliers          一个品牌一条，重复出现的品牌合并、品类累加
 *   supplier_products  一条 (品牌 × 件名) 一行，货期记在这里
 *
 * 为什么这么拆：货期是「某品牌的某类件」的属性，不是品牌的属性 ——
 * 派克的液压阀 100 天、管接头 45 天，挂在供应商上就只能记一个。
 *
 * 用法：node backend/scripts/import-purchased-parts.mjs <txt路径> [--apply]
 */
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.db')
const APPLY = process.argv.includes('--apply')
const SRC = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null

if (!SRC || !fs.existsSync(SRC)) {
  console.error('用法: node backend/scripts/import-purchased-parts.mjs <外购件.txt> [--apply]')
  process.exit(1)
}

/** 档次 → 品牌层级 */
const TIER_MAP = {
  进口: 'tier1',
  高配: 'tier1',
  精密: 'tier1',
  标配: 'tier2',
  特殊: 'tier3',
}

/** 件名 → 系统里的产品类别（SUPPLIER_CATEGORY_OPTIONS） */
const CATEGORY_RULES = [
  [/轴承/, '轴承'],
  [/密封|油封/, '密封'],
  [/油缸|液压|油泵|蓄能器|滤芯|阀|润滑|旋转接头/, '液压'],
  [/气缸|气动|空气|风机/, '气动'],
  [/电机|变频|电缆|传感|编码器|电气|PLC|仪表|接触器|按钮|指示灯|电柜|开关|电源|焊机|检测/, '电气'],
  [/减速|联轴器|升降机|制动器|丝杠|导轨|齿轮|链条|皮带|拖链|轧辊|辊/, '机械传动'],
  [/铸|锻/, '铸锻件'],
  [/螺栓|螺母|标准件|紧固|弹簧/, '标准件'],
  [/镀铬|包胶|喷涂|表面|涂油/, '表面处理'],
  [/钢板|钢材|型材|板材/, '钢材'],
]

const guessCategory = (name) => {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(name)) return cat
  return '其他'
}

/** 「120-150天」「90天」「5-7个月」→ 天数（取上限，宁可估长不估短） */
const parseDays = (raw) => {
  if (!raw) return null
  const s = String(raw)
  const months = /(\d+)\s*[-~至]?\s*(\d+)?\s*个?月/.exec(s)
  if (months) return Number(months[2] || months[1]) * 30
  const days = /(\d+)\s*[-~至]?\s*(\d+)?\s*天/.exec(s)
  if (days) return Number(days[2] || days[1])
  return null
}

/** 品牌串拆分：顿号/逗号/斜杠都可能是分隔符，括号里的说明剥掉 */
const splitBrands = (raw) =>
  String(raw || '')
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .split(/[、,，;；/\n]/)
    .map((x) => x.trim())
    .filter(Boolean)

/** 这些是档次词或占位符，不是品牌 —— 混进供应商表就成了「标配」这种公司 */
const NOT_BRAND = new Set([
  '标配', '高配', '进口', '精密', '特殊', '国产', '无', '/', '常规', '其他',
  '同等品牌', '待定', '暂无', '-', '—', 'by oem', 'OEM',
])

/**
 * 品牌名归一。
 *
 * 源文件里同一家会写成 Parker / PARKER / 德国AMTEC / 博亚精工BOYA，
 * 不归一的话供应商表里会躺着好几条同一家公司，比价时也对不上。
 */
/**
 * 中英文别名。
 * 同一家在文件里中英混写（西门子 / Siemens、力士乐 / Rexroth），
 * 不并起来的话比价时会当成两家供应商各算一遍。
 */
const BRAND_ALIAS = {
  Siemens: '西门子',
  SIEMENS: '西门子',
  Rexroth: '力士乐',
  REXROTH: '力士乐',
  Bosch: '博世',
  Parker: '派克',
  PARKER: '派克',
  Eaton: '伊顿',
  Flender: '弗兰德',
  Danfoss: '丹佛斯',
  Schneider: '施耐德',
  Omron: '欧姆龙',
  Festo: '费斯托',
  Boya: '博亚精工',
  博亚: '博亚精工',
  襄阳博亚: '博亚精工',
}

const normalizeBrand = (raw) => {
  let b = String(raw).replace(/["\r]/g, '').trim()
  b = b.replace(/^(德国|日本|美国|意大利|法国|瑞典|瑞士|韩国|台湾|中国|英国|奥地利)\s*/, '')
  // 「博亚精工BOYA」这种中英并写的，去掉尾巴上的英文
  b = b.replace(/^([一-龥]{2,})[A-Za-z][A-Za-z ]*$/, '$1')
  b = b.replace(/\s+/g, ' ').trim()
  // 纯拉丁字母的统一大小写，避免 PARKER / Parker 分家
  if (/^[A-Za-z][A-Za-z0-9 .&+-]*$/.test(b)) {
    b = b.length <= 4 ? b.toUpperCase() : b[0].toUpperCase() + b.slice(1).toLowerCase()
  }
  return BRAND_ALIAS[b] || b
}

const lines = fs.readFileSync(SRC, 'utf8').split('\n').map((l) => l.replace(/\r$/, ''))

/** 品牌名 → { tiers, categories, items } */
const brands = new Map()

/** 货期串（"90-150天"、"3个月"）不是厂商，是被错列读进来的 */
const looksLikeDuration = (s) => /^\d+\s*[-~至]?\s*\d*\s*(天|个月|周|月)$/.test(s)

const record = (brandRaw, category, tier, days, remark, itemName) => {
  const brand = normalizeBrand(brandRaw)
  if (!brand || NOT_BRAND.has(brand) || brand.length > 24) return
  if (brand.length < 2 || looksLikeDuration(brand)) return
  if (!brands.has(brand)) {
    brands.set(brand, { tiers: new Set(), categories: new Set(), items: [] })
  }
  const b = brands.get(brand)
  if (tier) b.tiers.add(tier)
  b.categories.add(category)
  b.items.push({ productName: itemName.slice(0, 60), category, deliveryDays: days, remark })
}

/*
 * 按行判断列型，不按段落切换模式。
 *
 * 文件里两种表格式是混排的、顺序不固定 —— 先前按「读到某个标题就切模式」，
 * 结果在最后一张六列表上整段错列，把「标配」「高配」当成品牌导了进去。
 * 看第 3 列是不是档次词最可靠。
 */
let currentName = ''
let skipping = false

for (const line of lines) {
  if (/^Item\s*$/.test(line.trim())) skipping = true
  if (/^13\.1\.\d/.test(line.trim())) skipping = false
  if (skipping || !line.includes('\t')) continue

  const cols = line.split('\t').map((c) => c.replace(/^"|"$/g, '').trim())
  if (cols.length < 3 || /^序号/.test(cols[0])) continue

  /*
   * 档次列的位置不固定：
   *   序号 名称 档次 品牌 …            → 第 3 列
   *   序号 分部 件名 档次 品牌 …        → 第 4 列（多了个「机械部分/流体部分」）
   * 写死索引会把「轴承 Bearing」这种件名当成品牌导进去，
   * 所以先找出档次词在哪一列，再按它定位左右。
   */
  const tierIdx = cols.findIndex((c) => TIER_MAP[c] !== undefined)

  if (tierIdx > 0) {
    const name = cols[tierIdx - 1] || currentName
    if (cols[tierIdx - 1]) currentName = cols[tierIdx - 1]
    const brandStr = cols[tierIdx + 1]
    if (!name || !brandStr) continue
    const cat = guessCategory(name)
    for (const b of splitBrands(brandStr)) {
      record(b, cat, TIER_MAP[cols[tierIdx]], parseDays(cols[tierIdx + 2]), cols[tierIdx + 3] || '', name)
    }
  } else {
    /*
     * 四列：序号 名称 供货厂商 备注
     *
     * 必须要够四列。文件里有些三列的残行（"10 ǁ 流体部分 ǁ 液压缸"）是
     * 上一行的续行，第 3 列是件名不是厂商 —— 不卡列数就会把「液压缸」
     * 当成一家供应商导进去。
     */
    if (cols.length < 4) continue
    const name = cols[1]
    if (!name || !cols[2] || /部分$/.test(name)) continue
    const cat = guessCategory(name)
    for (const b of splitBrands(cols[2])) record(b, cat, null, null, cols[3] || '', name)
  }
}

const totalItems = [...brands.values()].reduce((n, b) => n + b.items.length, 0)
console.log(`解析出品牌 ${brands.size} 个，配套件条目 ${totalItems} 条\n`)

const sorted = [...brands.entries()].sort((a, b) => b[1].items.length - a[1].items.length)
console.log('出现最多的 12 个品牌：')
for (const [name, b] of sorted.slice(0, 12)) {
  console.log(
    `  ${name.padEnd(16)} ${String(b.items.length).padStart(2)} 项  ${[...b.categories].join('/')}`,
  )
}

const catCount = new Map()
for (const b of brands.values()) for (const c of b.categories) catCount.set(c, (catCount.get(c) || 0) + 1)
console.log('\n品类分布：')
for (const [c, n] of [...catCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c.padEnd(6)} ${n} 家`)
}

const db = new Database(DB_PATH, { readonly: !APPLY })
const existing = new Map(db.prepare('SELECT id, name FROM suppliers').all().map((r) => [r.name, r.id]))
const willCreate = sorted.filter(([n]) => !existing.has(n)).length
console.log(
  `\n库中已有供应商 ${existing.size} 家；本次新增 ${willCreate} 家，更新 ${sorted.length - willCreate} 家`,
)

if (!APPLY) {
  console.log('\n这是预览。确认无误后加 --apply 执行。')
  db.close()
  process.exit(0)
}

const uid = () => crypto.randomUUID()
const now = new Date().toISOString()

const insSupplier = db.prepare(`
  INSERT INTO suppliers (id, name, tier, productCategories, description, cooperationLevel, status, visibility, createdAt, updatedAt)
  VALUES (?, ?, ?, ?, ?, 'candidate', 'active', 'public', ?, ?)
`)
const updSupplier = db.prepare(
  'UPDATE suppliers SET tier = COALESCE(tier, ?), productCategories = ?, updatedAt = ? WHERE id = ?',
)
const delProducts = db.prepare("DELETE FROM supplier_products WHERE supplierId = ? AND priceSource = 'estimate'")
const insProduct = db.prepare(`
  INSERT INTO supplier_products (id, supplierId, productName, brand, category, deliveryDays, remark, priceSource, status, createdAt, updatedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'estimate', 'active', ?, ?)
`)

const run = db.transaction(() => {
  for (const [name, b] of sorted) {
    // 一个品牌在不同件里档次可能不同，取最高那档
    const tier = b.tiers.has('tier1')
      ? 'tier1'
      : b.tiers.has('tier2')
        ? 'tier2'
        : [...b.tiers][0] || null
    const cats = [...b.categories].join(',')
    let id = existing.get(name)

    if (id) {
      updSupplier.run(tier, cats, now, id)
    } else {
      id = uid()
      insSupplier.run(id, name, tier, cats, '由《2024年常用外购件品牌及交货期》导入', now, now)
      existing.set(name, id)
    }

    // 重复导入时先清掉上次由本脚本写的行，避免越导越多
    delProducts.run(id)
    // 同一品牌同一件名可能在多张表里重复出现，去重后再写
    const seen = new Set()
    for (const it of b.items) {
      const key = `${it.productName}|${it.category}`
      if (seen.has(key)) continue
      seen.add(key)
      insProduct.run(uid(), id, it.productName, name, it.category, it.deliveryDays, it.remark, now, now)
    }
  }
})
run()

console.log(
  `\n完成。供应商 ${db.prepare('SELECT COUNT(*) c FROM suppliers').get().c} 家，` +
    `配套件目录 ${db.prepare('SELECT COUNT(*) c FROM supplier_products').get().c} 条。`,
)
db.close()
