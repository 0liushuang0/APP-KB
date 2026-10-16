/**
 * 专业大类判定：机械 / 液压 / 电气 / 仪表（兜底"其他"）。
 *
 * 设备配套与备件管理共用 —— 分组列表与分专业导出都以此为准：
 * · 每行可手动指定专业（row.profession），未指定时按备件名关键词自动判定
 * · 组的显示名可自定义（见 useProfessionNames），键名不变、只改显示
 */
export type Profession = '机械' | '液压' | '电气' | '仪表' | '其他'

export const PROFESSIONS: Profession[] = ['机械', '液压', '电气', '仪表', '其他']

const RULES: Array<[RegExp, Profession]> = [
  // 液压/气动/密封 → 液压
  [/液压|油缸|气动|密封|软管|阀台?/, '液压'],
  // 电气：电机/电气/控制/电缆
  [/电气|控制|电机|马达|电缆|照明|操作台/, '电气'],
  // 仪表：检测/测量/传感器/仪表
  [/仪表|传感器|检测|测量|测张|测厚|编码器|接近开关/, '仪表'],
  // 机械：辊/轴承/联轴器/减速机/刀片/机架/卷筒/导轨/传动/铸锻/标准件/钢材…
  [/辊|轴承|联轴|减速|刀|机架|卷筒|导轨|传动|铸|锻|焊接|紧固|螺栓|标准件|钢材|齿轮|齿|链|轴|衬板|滑板/, '机械'],
]

export const professionOfPart = (part: string): Profession => {
  const hit = RULES.find(([re]) => re.test(part || ''))
  return hit ? hit[1] : '其他'
}

/**
 * 行的生效专业：手动指定优先（可把"接近开关"从仪表调到电气），否则按名称自动判定。
 */
export const resolveProfession = (row: { part: string; profession?: string }): Profession =>
  row.profession && (PROFESSIONS as string[]).includes(row.profession)
    ? (row.profession as Profession)
    : professionOfPart(row.part)

/**
 * 按专业分组（保持 PROFESSIONS 的组序，组内保持数组顺序 —— 拖拽即调序）。
 * rows 需带可选 profession 字段（手动覆盖）。
 */
export const groupByProfession = <T extends { part: string; profession?: string }>(
  rows: T[],
): Array<{ profession: Profession; items: T[] }> => {
  return PROFESSIONS.map((profession) => ({
    profession,
    items: rows.filter((r) => resolveProfession(r) === profession),
  })).filter((g) => g.items.length > 0)
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
