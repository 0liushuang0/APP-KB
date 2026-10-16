/**
 * 专业大类判定：机械 / 液压 / 电气 / 仪表（兜底"其他"）。
 *
 * 设备配套与备件管理共用 —— 配件/备件名称按关键词归入专业组，
 * 分组列表与分专业导出都以此为准。
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

/** 按专业分组（保持 PROFESSIONS 的组序，组内保持原顺序） */
export const groupByProfession = <T extends { part: string }>(rows: T[]): Array<{ profession: Profession; items: T[] }> => {
  return PROFESSIONS.map((profession) => ({
    profession,
    items: rows.filter((r) => professionOfPart(r.part) === profession),
  })).filter((g) => g.items.length > 0)
}
