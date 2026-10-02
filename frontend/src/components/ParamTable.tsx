import { useState } from 'react'
import { ChevronDown, Pencil, Check, X, AlertTriangle } from 'lucide-react'
import ConfidenceBar, { confidenceTone } from './ConfidenceBar'
import SourceBadge, { type FieldSource } from './SourceBadge'

export interface ParamField {
  key: string
  label: string
  value?: string | number | null
  unit?: string
  confidence?: number
  source?: FieldSource
  /** 原文片段，悬浮显示，用于核对 AI 抽取是否断章取义 */
  evidence?: string[]
  /** 影响方案匹配 */
  requiredForMatch?: boolean
  /** 影响报价 */
  requiredForQuote?: boolean
  group?: string
}

interface ParamTableProps {
  fields: ParamField[]
  /** 传入即可编辑；不传为只读 */
  onEdit?: (key: string, value: string) => void
  /** 按 group 分组渲染 */
  grouped?: boolean
}

function Row({
  field,
  onEdit,
}: {
  field: ParamField
  onEdit?: (key: string, value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(field.value ?? ''))

  const empty = field.value === null || field.value === undefined || field.value === ''
  const lowConfidence = field.confidence !== undefined && field.confidence < 0.5
  const critical = (field.requiredForMatch || field.requiredForQuote) && (empty || lowConfidence)

  const commit = () => {
    onEdit?.(field.key, draft)
    setEditing(false)
  }

  return (
    <tr
      className={`border-b border-divider last:border-0 group ${
        critical ? 'bg-danger-bg/40' : 'hover:bg-canvas'
      }`}
    >
      <td className="py-2 px-3 align-top">
        <div className="flex items-start gap-1.5">
          {critical && (
            <AlertTriangle size={13} className="text-danger-fg mt-0.5 flex-shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-body-sm text-ink-soft">{field.label}</div>
            <div className="font-mono text-caption text-muted">{field.key}</div>
          </div>
        </div>
      </td>

      <td className="py-2 px-3 align-top">
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
              }}
              className="eo-input py-1 text-body-sm w-full"
            />
            <button onClick={commit} className="text-success-fg p-1" title={"保存"}
            aria-label="保存">
              <Check size={14} />
            </button>
            <button onClick={() => setEditing(false)} className="text-muted p-1" title={"取消"}
            aria-label="取消">
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span
              className={`text-body-sm font-mono ${empty ? 'text-danger-fg' : 'text-ink'}`}
              title={field.evidence?.length ? `原文：${field.evidence.join(' / ')}` : undefined}
            >
              {empty ? '缺失' : field.value}
            </span>
            {!empty && field.unit && <span className="text-caption text-muted">{field.unit}</span>}
            {onEdit && (
              <button
                onClick={() => {
                  setDraft(String(field.value ?? ''))
                  setEditing(true)
                }}
                className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent-600 transition-opacity p-0.5"
                title={`编辑${field.label}`}
                aria-label={`编辑${field.label}`}
              >
                <Pencil size={12} />
              </button>
            )}
          </div>
        )}
      </td>

      <td className="py-2 px-3 align-top">
        <ConfidenceBar value={field.confidence} />
      </td>

      <td className="py-2 px-3 align-top">
        <SourceBadge source={field.source} />
      </td>

      <td className="py-2 px-3 align-top">
        <div className="flex gap-1">
          {field.requiredForMatch && (
            <span className="font-mono text-caption px-1 py-0.5 rounded bg-info-bg text-info-fg" title="影响方案匹配">
              匹配
            </span>
          )}
          {field.requiredForQuote && (
            <span className="font-mono text-caption px-1 py-0.5 rounded bg-warning-bg text-warning-fg" title="影响报价">
              报价
            </span>
          )}
        </div>
      </td>
    </tr>
  )
}

function Table({ fields, onEdit }: { fields: ParamField[]; onEdit?: (k: string, v: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-subtle">
            <th className="eo-th text-left py-2 px-3 w-[28%]">参数</th>
            <th className="eo-th text-left py-2 px-3 w-[26%]">取值</th>
            <th className="eo-th text-left py-2 px-3 w-[16%]">置信度</th>
            <th className="eo-th text-left py-2 px-3 w-[14%]">来源</th>
            <th className="eo-th text-left py-2 px-3 w-[16%]">影响</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <Row key={f.key} field={f} onEdit={onEdit} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * 结构化参数表。
 *
 * 缺失或低置信度且影响匹配/报价的字段整行标红 —— 这些正是需要发补问的字段，
 * 让技术领导扫一眼就知道该问客户什么。
 */
export default function ParamTable({ fields, onEdit, grouped = true }: ParamTableProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  if (fields.length === 0) {
    return <p className="text-sm text-muted py-6 text-center">暂无结构化参数，请先执行「结构化识别」</p>
  }

  if (!grouped || !fields.some((f) => f.group)) {
    return <Table fields={fields} onEdit={onEdit} />
  }

  const groups = new Map<string, ParamField[]>()
  for (const f of fields) {
    const g = f.group || '其他参数'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(f)
  }

  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([name, items]) => {
        const missing = items.filter(
          (f) => (f.value === null || f.value === undefined || f.value === '') &&
            (f.requiredForMatch || f.requiredForQuote),
        ).length
        const open = !collapsed[name]
        return (
          <div key={name} className="border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [name]: !c[name] }))}
              className="w-full flex items-center justify-between px-3 py-2 bg-subtle hover:bg-canvas transition-colors"
              aria-expanded={open}
            >
              <span className="text-body-sm font-semibold text-ink">{name}</span>
              <span className="flex items-center gap-2">
                {missing > 0 && (
                  <span className="font-mono text-caption px-1.5 py-0.5 rounded bg-danger-bg text-danger-fg">
                    缺 {missing}
                  </span>
                )}
                <span className="font-mono text-caption text-muted">{items.length}</span>
                <ChevronDown size={13} className={`text-muted transition-transform ${open ? '' : '-rotate-90'}`} />
              </span>
            </button>
            {open && <Table fields={items} onEdit={onEdit} />}
          </div>
        )
      })}
    </div>
  )
}

export { confidenceTone }

