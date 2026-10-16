/**
 * 专业分类（设备配套与备件管理共用）。
 *
 * 原来只有写死的 机械 / 液压 / 电气 / 仪表 / 其他 五类，只能改显示名、不能增删 ——
 * 业务上已经把「其他」改名成「整机」、「液压」改成「流体」来凑用。
 * 现在分类是一份可维护的清单（system_configs.profession_list，见 useProfessions）：
 * · 每类 = 键（行里存的值，创建后不变）+ 显示名 + 自动归类关键词
 * · 每行可手动指定分类；未指定或所指分类已删除时，按配件名命中关键词自动归类
 * · 都不命中归「兜底类」（有「其他」用「其他」，否则用清单最后一类）
 *
 * 自动归类的优先级：新增的分类优先（用户新建「气动」就是想把气动件从液压里分出来），
 * 内置分类按 液压 → 电气 → 仪表 → 机械 的老顺序（保持已有行的归类不变）。
 */
export type Profession = string

export interface ProfessionDef {
  key: string
  name: string
  keywords: string[]
}

export const FALLBACK_PROFESSION = '其他'

export const DEFAULT_PROFESSIONS: ProfessionDef[] = [
  {
    key: '机械',
    name: '机械',
    keywords: ['辊', '轴承', '联轴', '减速', '刀', '机架', '卷筒', '导轨', '传动', '铸', '锻', '焊接', '紧固', '螺栓', '标准件', '钢材', '齿', '链', '轴', '衬板', '滑板'],
  },
  { key: '液压', name: '液压', keywords: ['液压', '油缸', '气动', '密封', '软管', '阀'] },
  { key: '电气', name: '电气', keywords: ['电气', '控制', '电机', '马达', '电缆', '照明', '操作台'] },
  { key: '仪表', name: '仪表', keywords: ['仪表', '传感器', '检测', '测量', '测张', '测厚', '编码器', '接近开关'] },
  { key: '其他', name: '其他', keywords: [] },
]

/** 内置分类的键（兼容旧代码与单测） */
export const PROFESSIONS: Profession[] = DEFAULT_PROFESSIONS.map((d) => d.key)

const BUILTIN_PRIORITY = ['液压', '电气', '仪表', '机械']

/** 自动归类时的匹配顺序：新增分类（按清单序）→ 内置分类（老优先级） */
const matchOrder = (defs: ProfessionDef[]): ProfessionDef[] => {
  const custom = defs.filter((d) => !BUILTIN_PRIORITY.includes(d.key))
  const builtin = BUILTIN_PRIORITY.map((k) => defs.find((d) => d.key === k)).filter(Boolean) as ProfessionDef[]
  return [...custom, ...builtin]
}

export const fallbackProfession = (defs: ProfessionDef[] = DEFAULT_PROFESSIONS): Profession =>
  defs.some((d) => d.key === FALLBACK_PROFESSION) ? FALLBACK_PROFESSION : defs[defs.length - 1]?.key || FALLBACK_PROFESSION

export const professionOfPart = (part: string, defs: ProfessionDef[] = DEFAULT_PROFESSIONS): Profession => {
  const p = part || ''
  for (const d of matchOrder(defs)) {
    if (d.keywords.some((k) => k && p.includes(k))) return d.key
  }
  return fallbackProfession(defs)
}

/** 行的生效分类：手动指定且该分类仍存在 → 用它；否则按名称自动判定 */
export const resolveProfession = (
  row: { part: string; profession?: string },
  defs: ProfessionDef[] = DEFAULT_PROFESSIONS,
): Profession =>
  row.profession && defs.some((d) => d.key === row.profession) ? row.profession : professionOfPart(row.part, defs)

/** 按分类分组（组序 = 清单顺序，组内保持数组顺序 —— 拖拽即调序；空组不出现） */
export const groupByProfession = <T extends { part: string; profession?: string }>(
  rows: T[],
  defs: ProfessionDef[] = DEFAULT_PROFESSIONS,
): Array<{ profession: Profession; items: T[] }> =>
  defs
    .map((d) => ({ profession: d.key, items: rows.filter((r) => resolveProfession(r, defs) === d.key) }))
    .filter((g) => g.items.length > 0)

/** 关键词输入框 ↔ 数组（顿号、逗号、空格都算分隔） */
export const parseKeywords = (s: string): string[] => [...new Set(s.split(/[、，,\s]+/).map((x) => x.trim()).filter(Boolean))]

/**
 * 校验并规整一份分类清单：名称必填、不重名；键保留（新类用名称作键，与已有键冲突时加序号）。
 * 返回错误信息或规整后的清单。
 */
export const normalizeProfessions = (defs: ProfessionDef[]): { ok: true; defs: ProfessionDef[] } | { ok: false; error: string } => {
  if (!defs.length) return { ok: false, error: '至少保留一个分类' }
  const names = new Set<string>()
  const keys = new Set<string>()
  const out: ProfessionDef[] = []
  for (const d of defs) {
    const name = d.name.trim()
    if (!name) return { ok: false, error: '分类名称不能为空' }
    if (names.has(name)) return { ok: false, error: `分类「${name}」重复` }
    names.add(name)
    let key = (d.key || name).trim()
    let n = 2
    while (keys.has(key)) key = `${name}${n++}`
    keys.add(key)
    out.push({ key, name, keywords: [...new Set(d.keywords.map((k) => k.trim()).filter(Boolean))] })
  }
  return { ok: true, defs: out }
}

/**
 * 拖拽排序的数组移动：把 from 项插到 to 项之前（to 在 from 之前时插到其后，符合直觉）。
 * 拖拽事件的浏览器行为无法在自动化里稳定模拟，排序正确性由本函数的单测保证。
 */
export const moveItem = <T>(arr: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
  const next = [...arr]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
