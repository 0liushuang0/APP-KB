/**
 * 修复「零部件/联轴器」模板中被破坏的中文。
 *
 * 背景：该模板的 fields 里所有中文（label / section / remark）都变成了字面量
 * 问号 `?`。这是一次有损的编码转换 —— 中文字符在写入时被替换成了 0x3F，
 * 不是显示问题，原字符已经不在数据里了。现存最早的备份里就已经是这样，
 * 也没有可回溯的干净副本（PostgreSQL 侧的 aikb 库已不存在）。
 *
 * 能救回来的依据：英文 key 完好，且语义明确（power / gear_ratio /
 * spigot_diameter_face …），配合联轴器的常规选型口径可以还原出字段名。
 * 另一个佐证是分组名的**字数**与还原结果完全吻合：
 *   "A. ??????"     6 字 → 动力传动参数
 *   "B. ?????????"  9 字 → 连接方式与安装空间
 *   "B1./B2./B3. ???????" 7 字 → 鼓形齿连接参数 / 端面止口与键槽 / 径向止口与键槽
 *   "C. ?????"      5 字 → 轴与孔尺寸
 *   "D. ????"       4 字 → 安装方向
 *   "E. ?????????"  9 字 → 使用工况与其他要求
 *
 * remark（备注）不还原：那里原本是具体的选型口径和确认事项，
 * 凭空编一段"看起来合理"的说明比留空危害更大。统一清空，由业务侧补回。
 *
 * 用法：node backend/scripts/repair-coupling-template.mjs [--apply]
 * 不带 --apply 只打印对照表，确认无误再执行。
 */
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.db')
const APPLY = process.argv.includes('--apply')

const SECTIONS = {
  'A. ??????': 'A. 动力传动参数',
  'B. ?????????': 'B. 连接方式与安装空间',
  'B1. ???????': 'B1. 鼓形齿连接参数',
  'B2. ???????': 'B2. 端面止口与键槽',
  'B3. ???????': 'B3. 径向止口与键槽',
  'C. ?????': 'C. 轴与孔尺寸',
  'D. ????': 'D. 安装方向',
  'E. ?????????': 'E. 使用工况与其他要求',
}

const LABELS = {
  power: '功率',
  input_speed: '输入转速',
  gear_ratio: '传动比',
  output_shaft_count: '输出轴数量',
  max_torque: '最大扭矩',
  working_speed: '工作转速',
  connection_type: '连接方式',
  connection_detail: '连接方式说明',
  max_allowed_diameter: '最大允许外径',
  space_unlimited: '安装空间不受限',
  tooth_count: '齿数',
  tooth_width: '齿宽',
  tooth_height: '齿高',
  spigot_diameter_face: '端面止口直径',
  spigot_height_face: '端面止口高度',
  keyway_width_face: '端面键槽宽度',
  keyway_depth_face: '端面键槽深度',
  spigot_diameter_key: '径向止口直径',
  spigot_height_key: '径向止口高度',
  key_count: '键数量',
  keyway_width_radial: '径向键槽宽度',
  keyway_depth_radial: '径向键槽深度',
  drive_hole_dia: '主动端孔径',
  drive_hole_depth: '主动端孔深',
  drive_shaft_dia: '主动端轴径',
  drive_shaft_len: '主动端轴长',
  driven_hole_dia: '从动端孔径',
  driven_hole_depth: '从动端孔深',
  driven_shaft_dia: '从动端轴径',
  driven_shaft_len: '从动端轴长',
  mount_direction: '安装方向',
  rotation_direction: '旋转方向',
  screw_direction: '螺纹旋向',
  operating_env: '使用环境',
  duty_cycle: '工作制',
  original_type: '原用型号',
  appearance_color: '外观颜色',
  packaging: '包装方式',
  packaging_detail: '包装说明',
  life_requirement: '寿命要求',
  other_notes: '其他说明',
}

/** select / multiselect 的可选值同样被打成了问号，按常规口径给回 */
const OPTIONS = {
  connection_type: ['鼓形齿式', '键连接', '法兰式', '胀套式'],
  key_count: ['单键', '双键'],
  mount_direction: ['水平', '垂直', '倾斜'],
  rotation_direction: ['正转', '反转', '双向'],
  screw_direction: ['右旋', '左旋'],
  operating_env: ['常温', '高温', '粉尘', '潮湿', '腐蚀'],
  duty_cycle: ['连续', '断续', '冲击'],
  original_type: ['本厂产品', '外厂产品', '新设计'],
  packaging: ['木箱', '纸箱', '托盘', '裸装'],
}

const hasMojibake = (s) => /[?�]/.test(String(s ?? ''))

const db = new Database(DB_PATH, { readonly: !APPLY })
const row = db
  .prepare("SELECT id, category, fields FROM param_templates WHERE category LIKE '%联轴器%' AND fields LIKE '%?%'")
  .get()

if (!row) {
  console.log('没有找到需要修复的联轴器模板（可能已修复）')
  db.close()
  process.exit(0)
}

const fields = JSON.parse(row.fields)
const changes = []

for (const f of fields) {
  const before = { label: f.label, section: f.section, unit: f.unit }

  if (hasMojibake(f.label) && LABELS[f.key]) f.label = LABELS[f.key]
  if (SECTIONS[f.section]) f.section = SECTIONS[f.section]
  // N·m 里的间隔号也被打坏了
  if (hasMojibake(f.unit)) f.unit = f.unit.replace(/[?�]/g, '·')
  // 备注无法还原，清空好过留一串问号
  if (hasMojibake(f.remark)) delete f.remark
  if (OPTIONS[f.key] && (f.options || []).some(hasMojibake)) f.options = OPTIONS[f.key]

  if (before.label !== f.label || before.section !== f.section || before.unit !== f.unit) {
    changes.push(`  ${f.key.padEnd(24)} ${String(before.label).padEnd(8)} → ${f.label}`)
  }
}

console.log(`模板：${row.category}（${fields.length} 个字段）`)
console.log(changes.join('\n'))
console.log(`\n共修复 ${changes.length} 个字段的名称`)

const remaining = fields.filter((f) => hasMojibake(f.label) || hasMojibake(f.section))
if (remaining.length) {
  console.log(`\n仍有问号未处理的字段：${remaining.map((f) => f.key).join(', ')}`)
}

if (APPLY) {
  db.prepare('UPDATE param_templates SET fields = ?, updatedAt = ? WHERE id = ?').run(
    JSON.stringify(fields, null, 2),
    new Date().toISOString(),
    row.id,
  )
  console.log('\n已写入数据库。请在「需求模板 → 零部件/联轴器」里逐条核对，备注需要业务侧补回。')
} else {
  console.log('\n这是预览。确认无误后加 --apply 执行。')
}

db.close()
