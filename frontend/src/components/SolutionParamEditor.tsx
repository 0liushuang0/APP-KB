import { useState } from 'react'
import { Plus, X, ListPlus } from 'lucide-react'

export interface SolutionParam {
  group?: string
  name: string
  value?: string
  unit?: string
  /** 仅用于输入提示，不参与存储 */
  placeholder?: string
}

/**
 * 标准带钢处理线常用参数模板（取自《标准方案参数项》）。
 * 一键「载入标准参数项」后逐项填适用值/范围即可，无需从零录入。
 */
const STANDARD_PARAM_TEMPLATE: SolutionParam[] = [
  // 一、来料信息
  { group: '来料信息', name: '来料材质', placeholder: '普碳钢/不锈钢/硅钢/高强钢/铝合金/铜合金' },
  { group: '来料信息', name: '牌号种类', placeholder: '如退火料、取向硅钢' },
  { group: '来料信息', name: '材料前道工序' },
  { group: '来料信息', name: '板带宽度', unit: 'mm', placeholder: 'min~max' },
  { group: '来料信息', name: '板带厚度', unit: 'mm', placeholder: 'min~max' },
  { group: '来料信息', name: '屈服强度', unit: 'MPa', placeholder: 'min~max' },
  { group: '来料信息', name: '抗拉强度', unit: 'MPa', placeholder: 'min~max' },
  { group: '来料信息', name: '板带温度', unit: '℃' },
  { group: '来料信息', name: '表面清洁度', unit: 'mg/m²' },
  { group: '来料信息', name: '板带平直度', unit: 'I值' },
  { group: '来料信息', name: '表面状态', placeholder: '镀锌/镀铝锌/镀锡/彩涂/无' },
  { group: '来料信息', name: '镰刀弯', unit: 'mm/m' },
  { group: '来料信息', name: '月牙剪尺寸' },
  // 二、设备信息
  { group: '设备信息', name: '生产线名称', placeholder: '酸洗/连续镀锌等' },
  { group: '设备信息', name: '钢带运行方向', placeholder: '左→右 / 右→左' },
  { group: '设备信息', name: '穿带速度', unit: 'm/min' },
  { group: '设备信息', name: '最高速度', unit: 'm/min' },
  { group: '设备信息', name: '入口张力', unit: 'KN', placeholder: '选填' },
  { group: '设备信息', name: '出口张力', unit: 'KN', placeholder: '选填' },
  { group: '设备信息', name: '轧制线标高', unit: 'mm', placeholder: '选填' },
  { group: '设备信息', name: '设备空间(长×宽×高)', unit: 'm', placeholder: '选填' },
  { group: '设备信息', name: '年产量目标', unit: '吨/年', placeholder: '选填' },
  // 三、成品参数
  { group: '成品参数', name: '浪形/平直度', unit: 'I值', placeholder: '选填' },
  { group: '成品参数', name: '表面质量要求', placeholder: '选填' },
  // 四、电源及公用工程
  { group: '电源及公用工程', name: '二次侧电压', unit: 'V', placeholder: '选填' },
  { group: '电源及公用工程', name: '电源频率', unit: 'Hz', placeholder: '选填' },
  { group: '电源及公用工程', name: '相数及接线', placeholder: '选填' },
  { group: '电源及公用工程', name: '接地方式', placeholder: '选填' },
  { group: '电源及公用工程', name: '压缩空气压力', unit: 'MPa', placeholder: '选填' },
  { group: '电源及公用工程', name: '冷却水压力/水质', unit: 'MPa', placeholder: '选填' },
]

const GROUP_ORDER = ['来料信息', '设备信息', '成品参数', '电源及公用工程', '其他']
const groupRank = (g?: string) => {
  const i = GROUP_ORDER.indexOf(g || '其他')
  return i < 0 ? GROUP_ORDER.length : i
}

/** 解析 keyParams：新版为数组 [{group,name,value,unit}]，兼容旧版对象 {板厚:"0.3-3mm"} */
export function parseSolutionParams(json?: string): SolutionParam[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) {
      return parsed
        .filter((p) => p && typeof p === 'object' && p.name)
        .map((p) => ({
          group: p.group,
          name: String(p.name),
          value: p.value != null ? String(p.value) : '',
          unit: p.unit,
        }))
    }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([name, value]) => ({ name, value: String(value ?? '') }))
    }
  } catch {
    /* 非 JSON（旧的自由文本），当作无结构处理 */
  }
  return []
}

const groupsOf = (rows: SolutionParam[]) =>
  [...new Set(rows.map((r) => r.group || '其他'))].sort((a, b) => groupRank(a) - groupRank(b))

/** 只读展示（详情页用），按分组把已填参数列成小标签 */
export function SolutionParamView({ value }: { value?: string }) {
  const params = parseSolutionParams(value).filter((p) => (p.value ?? '') !== '')
  if (params.length === 0) return <span className="text-muted">—</span>
  return (
    <div className="space-y-2">
      {groupsOf(params).map((g) => (
        <div key={g}>
          <div className="text-caption text-muted mb-1">{g}</div>
          <div className="flex flex-wrap gap-1.5">
            {params
              .filter((p) => (p.group || '其他') === g)
              .map((p, i) => (
                <span key={i} className="text-caption px-2 py-0.5 rounded bg-subtle text-ink-soft">
                  {p.name}：{p.value}
                  {p.unit || ''}
                </span>
              ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** 存储时剥掉 placeholder，只留 group/name/value/unit */
const serialize = (rows: SolutionParam[]) =>
  JSON.stringify(
    rows
      .filter((r) => r.name.trim())
      .map(({ group, name, value, unit }) => ({ group, name, value: value || '', unit: unit || undefined })),
  )

interface Props {
  value?: string
  onChange: (v: string) => void
}

/**
 * 方案关键参数编辑器。
 *
 * 取代原先的自由 JSON 文本框：改为「参数名 / 适用值或范围 / 单位」的结构化逐项填写，
 * 并可一键载入标准参数项。存储仍为 JSON（写回 keyParams 字段），既便于人读也利于匹配。
 * 组件自持内部状态，父级通过 key（方案 id）触发重挂载以切换不同方案。
 */
export default function SolutionParamEditor({ value, onChange }: Props) {
  const [rows, setRows] = useState<SolutionParam[]>(() => parseSolutionParams(value))

  const emit = (next: SolutionParam[]) => {
    setRows(next)
    onChange(serialize(next))
  }
  const setRow = (i: number, patch: Partial<SolutionParam>) =>
    emit(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const removeRow = (i: number) => emit(rows.filter((_, idx) => idx !== i))
  const addRow = () => emit([...rows, { group: '其他', name: '', value: '', unit: '' }])
  const loadTemplate = () => {
    const existing = new Set(rows.map((r) => r.name))
    emit([...rows, ...STANDARD_PARAM_TEMPLATE.filter((t) => !existing.has(t.name))])
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="eo-label">关键参数（用于需求匹配，填适用值 / 范围）</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={loadTemplate}
            className="inline-flex items-center gap-1 text-caption text-accent-600 hover:text-accent-700"
          >
            <ListPlus size={13} /> 载入标准参数项
          </button>
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1 text-caption text-accent-600 hover:text-accent-700"
          >
            <Plus size={13} /> 添加参数
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-caption text-muted">
          点「载入标准参数项」载入常用带钢处理线参数，或「添加参数」自定义；逐项填适用值 / 范围（如 800-1500）。
        </p>
      ) : (
        <div className="space-y-3">
          {groupsOf(rows).map((g) => (
            <div key={g}>
              <div className="text-caption font-medium text-muted mb-1.5">{g}</div>
              <div className="space-y-1.5">
                {rows.map((r, i) =>
                  (r.group || '其他') === g ? (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        className="eo-input flex-1 min-w-0"
                        placeholder="参数名"
                        value={r.name}
                        onChange={(e) => setRow(i, { name: e.target.value })}
                        aria-label="参数名"
                      />
                      <input
                        className="eo-input flex-1 min-w-0"
                        placeholder={r.placeholder || '适用值 / 范围'}
                        value={r.value || ''}
                        onChange={(e) => setRow(i, { value: e.target.value })}
                        aria-label="适用值或范围"
                      />
                      <input
                        className="eo-input w-20 shrink-0"
                        placeholder="单位"
                        value={r.unit || ''}
                        onChange={(e) => setRow(i, { unit: e.target.value })}
                        aria-label="单位"
                      />
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="text-muted hover:text-danger-fg shrink-0"
                        title={"删除参数"}
                        aria-label="删除参数"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
