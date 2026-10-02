import type { CalcInputDef } from '../types'

export interface PrefillHit {
  /** 计算模板里的输入项 */
  inputKey: string
  inputLabel: string
  /** 需求里被匹到的那个参数 */
  fromKey: string
  fromLabel: string
  value: string
  unit?: string
  /** 靠什么匹上的，界面上标出来让人能判断可不可信 */
  via: 'key' | 'label' | 'alias'
}

interface SpecParam {
  key: string
  label: string
  value: string
  unit?: string
}

/**
 * 常见叫法对照。
 *
 * 需求书里写「带钢厚度」，计算模板里叫「来料厚度」，指的是同一个数。
 * 靠 key 和字面 label 都对不上，只能列一份别名表 —— 覆盖不全没关系，
 * 匹不上就留空让人自己填，比硬猜一个错数字安全。
 */
const ALIASES: Record<string, string[]> = {
  thickness: ['厚度', '带钢厚度', '来料厚度', '板厚', '料厚', '钢板厚度'],
  width: ['宽度', '带钢宽度', '来料宽度', '板宽', '料宽', '钢板宽度'],
  yield_strength: ['屈服强度', '屈服极限', '材料屈服强度', '屈服'],
  tensile_strength: ['抗拉强度', '抗拉极限', '强度极限'],
  speed: ['速度', '线速度', '机组速度', '生产速度', '带速'],
  coil_weight: ['卷重', '钢卷重量', '最大卷重'],
  coil_od: ['外径', '卷外径', '钢卷外径', '最大外径'],
  coil_id: ['内径', '卷内径', '钢卷内径'],
  material: ['材质', '材料', '钢种', '牌号'],
  temperature: ['温度', '工作温度', '来料温度'],
  torque: ['扭矩', '转矩', '额定扭矩'],
  power: ['功率', '电机功率', '装机功率'],
  diameter: ['直径', '轴径', '公称直径'],
  pressure: ['压力', '系统压力', '工作压力'],
  quantity: ['数量', '台数', '套数'],
}

/** 去掉单位括号、空格、全角符号，让「带钢厚度(mm)」和「带钢厚度」能对上 */
function normalize(s: string): string {
  return String(s || '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[\s_\-—·、,，:：]/g, '')
    .toLowerCase()
}

/** 从值里抠出数字：「2.5mm」「约 1250」「1200~1500」都能取到第一个数 */
function toNumeric(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : null
  const m = String(raw).replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return m ? m[0] : null
}

/** 把需求的 structuredSpec 抹平成统一的参数列表（兼容需求卡与旧版 params） */
export function parseSpecParams(spec: string | undefined | null): SpecParam[] {
  if (!spec) return []
  let parsed: any
  try {
    parsed = JSON.parse(spec)
  } catch {
    return []
  }
  const card = parsed?.card ?? parsed
  const out: SpecParam[] = []

  if (Array.isArray(card?.fields)) {
    for (const f of card.fields) {
      const v = f.normalized ?? f.value
      if (v === null || v === undefined || v === '') continue
      out.push({ key: String(f.key || ''), label: String(f.label || f.key || ''), value: String(v), unit: f.unit })
    }
    return out
  }

  if (Array.isArray(card?.params)) {
    for (const p of card.params) {
      if (p?.value === null || p?.value === undefined || p?.value === '') continue
      out.push({ key: String(p.key || ''), label: String(p.key || ''), value: String(p.value), unit: p.unit })
    }
    return out
  }

  // 最早期的形态：直接是一个扁平对象
  if (card && typeof card === 'object') {
    for (const [k, v] of Object.entries(card)) {
      if (v === null || v === undefined || typeof v === 'object') continue
      out.push({ key: k, label: k, value: String(v) })
    }
  }
  return out
}

/**
 * 把需求里的参数往计算模板的输入项上套。
 *
 * 只填数值型和能对上枚举项的字段，且**只填空着的格子** —— 用户已经手改过的
 * 不覆盖。匹不上的一律留空，宁可让人多敲两个数，也不能塞一个来路不明的值进去。
 */
export function prefillFromSpec(
  inputs: CalcInputDef[],
  spec: string | undefined | null,
  current: Record<string, string> = {},
): { values: Record<string, string>; hits: PrefillHit[] } {
  const params = parseSpecParams(spec)
  if (!params.length) return { values: {}, hits: [] }

  const byKey = new Map<string, SpecParam>()
  const byLabel = new Map<string, SpecParam>()
  for (const p of params) {
    if (p.key) byKey.set(normalize(p.key), p)
    if (p.label) byLabel.set(normalize(p.label), p)
  }

  const values: Record<string, string> = {}
  const hits: PrefillHit[] = []

  for (const input of inputs) {
    if (current[input.key]) continue // 用户填过的不动

    const nKey = normalize(input.key)
    const nLabel = normalize(input.label)

    let found: SpecParam | undefined
    let via: PrefillHit['via'] = 'key'

    if (byKey.has(nKey)) {
      found = byKey.get(nKey)
      via = 'key'
    } else if (byLabel.has(nLabel)) {
      found = byLabel.get(nLabel)
      via = 'label'
    } else {
      // 别名表：先看输入项的 key，再看它的 label 落在哪一组别名里
      const groups = Object.entries(ALIASES).filter(
        ([k, names]) => normalize(k) === nKey || names.some((n) => normalize(n) === nLabel),
      )
      for (const [k, names] of groups) {
        const cand =
          byKey.get(normalize(k)) ||
          names.map((n) => byLabel.get(normalize(n))).find(Boolean) ||
          names.map((n) => byKey.get(normalize(n))).find(Boolean)
        if (cand) {
          found = cand
          via = 'alias'
          break
        }
      }
    }

    if (!found) continue

    if (input.type === 'enum' && input.options?.length) {
      // 枚举按 label 文本对，对不上就不填
      const hit = input.options.find(
        (o) => normalize(o.label) === normalize(found!.value) || String(o.value) === found!.value,
      )
      if (!hit) continue
      values[input.key] = String(hit.value)
    } else {
      const num = toNumeric(found.value)
      if (num === null) continue
      // 超出模板量程的不填 —— 多半是单位不一致（t 与 kg、m 与 mm）
      const n = Number(num)
      if (input.min != null && n < input.min) continue
      if (input.max != null && n > input.max) continue
      values[input.key] = num
    }

    hits.push({
      inputKey: input.key,
      inputLabel: input.label,
      fromKey: found.key,
      fromLabel: found.label,
      value: values[input.key],
      unit: found.unit,
      via,
    })
  }

  return { values, hits }
}
