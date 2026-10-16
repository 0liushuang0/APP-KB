import { type ParamField } from './ParamTable'

/**
 * 结构化识别的智能分组：无模板分组（group 为空）的旧版识别结果，
 * 按参数名的业务语义自动归组，让平铺一长串的参数表变得可扫读。
 */
const GROUP_RULES: Array<[RegExp, string]> = [
  [/材质|材料|牌号|钢种|合金|表面镀|镀层|涂层/, '材料与表面'],
  [/厚度|宽度|直径|长度|尺寸|辊径|辊面宽|幅宽|跨度|高度|中心距|节距|规格/, '几何尺寸'],
  [/速度|张力|压力|力|扭矩|功率|温度|流量|延伸率|精度|公差|平行度|水平度|振摆|粗糙度/, '性能与工艺'],
  [/方向|左右|形式|型式|结构|配置|方式|数量|台数|段数|根数/, '结构与配置'],
]

export function groupParamsByLabel(fields: ParamField[]): Array<{ name: string; items: ParamField[] }> {
  // 已有显式分组的交给 ParamTable 自己的分组逻辑；这里只处理无分组
  const groups = new Map<string, ParamField[]>()
  for (const f of fields) {
    if (f.group) return []
    const hit = GROUP_RULES.find(([re]) => re.test(f.label || f.key || ''))
    const name = hit ? hit[1] : '其他参数'
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name)!.push(f)
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }))
}

export interface SpecExtras {
  summary?: string
  specialRequirements?: string[]
  standards?: string[]
  risks?: string[]
  productType?: string
}

/** 摘要/特殊要求/执行标准/风险 的规范排版（识别结果里除参数表外的文字内容） */
export default function SpecSummary({ extras }: { extras: SpecExtras }) {
  const hasAny =
    (extras.summary || '').trim() ||
    (extras.specialRequirements || []).length ||
    (extras.standards || []).length ||
    (extras.risks || []).length
  if (!hasAny) return null

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <div className="eo-label mb-1.5">{title}</div>
      {children}
    </div>
  )

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      {extras.productType && (
        <Section title="识别产品类型">
          <div className="text-body-sm text-ink font-medium">{extras.productType}</div>
        </Section>
      )}
      {(extras.summary || '').trim() && (
        <Section title="识别摘要">
          <p className="text-body-sm text-ink-soft leading-relaxed">{extras.summary}</p>
        </Section>
      )}
      {(extras.specialRequirements || []).length > 0 && (
        <Section title="特殊要求">
          <ul className="space-y-1">
            {extras.specialRequirements!.slice(0, 12).map((r, i) => (
              <li key={i} className="text-body-sm text-ink-soft flex gap-1.5">
                <span className="text-muted shrink-0">{i + 1}.</span>
                <span className="min-w-0">{r}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {(extras.standards || []).length > 0 && (
        <Section title="执行标准">
          <div className="flex flex-wrap gap-1.5">
            {extras.standards!.slice(0, 12).map((s, i) => (
              <span key={i} className="text-caption px-1.5 py-0.5 rounded bg-info-bg text-info-fg border border-info-line">
                {s}
              </span>
            ))}
          </div>
        </Section>
      )}
      {(extras.risks || []).length > 0 && (
        <Section title="风险提示">
          <ul className="space-y-1">
            {extras.risks!.slice(0, 10).map((r, i) => (
              <li key={i} className="text-body-sm text-danger-fg flex gap-1.5">
                <span className="shrink-0">⚠</span>
                <span className="min-w-0">{r}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
