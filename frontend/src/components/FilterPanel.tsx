import { useState, type ReactNode } from 'react'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'

export interface FilterOption {
  value: string
  label: string
  count?: number
}

export interface FilterGroupDef {
  key: string
  label: string
  type: 'checkbox' | 'radio' | 'select' | 'daterange' | 'custom'
  options?: FilterOption[]
  /** type: 'custom' 时的自定义渲染 */
  render?: () => ReactNode
  /** 默认折叠 */
  collapsed?: boolean
  /**
   * 选项分几列排。
   * 「液压/气动/电气/仪表…」这类短选项有十几个，竖着排会把筛选面板
   * 拉到比表格还长，用户得滚半天才看到内容区。
   */
  columns?: 2 | 3
}

export type FilterValues = Record<string, string | string[] | { from?: string; to?: string } | undefined>

interface FilterPanelProps {
  groups: FilterGroupDef[]
  values: FilterValues
  onChange: (key: string, value: FilterValues[string]) => void
  onReset?: () => void
  /** 已生效的筛选条件数，用于移动端按钮角标 */
  activeCount?: number
  className?: string
}

function Group({
  def,
  value,
  onChange,
}: {
  def: FilterGroupDef
  value: FilterValues[string]
  onChange: (v: FilterValues[string]) => void
}) {
  const [open, setOpen] = useState(!def.collapsed)

  /*
   * 只有一个控件的分组（客户选择器这种）不需要折叠 ——
   * 折叠箭头既占位置又没意义：本来就只有一行，收起来省不了什么。
   */
  const collapsible = def.type !== 'custom'

  return (
    <div className="border-b border-divider last:border-0 pb-3 last:pb-0">
      <button
        onClick={() => collapsible && setOpen((o) => !o)}
        className={`w-full flex items-center justify-between text-left group ${collapsible ? '' : 'cursor-default'}`}
        aria-expanded={open}
      >
        <span className="eo-label">{def.label}</span>
        {collapsible && (
          <ChevronDown
            size={13}
            className={`text-muted transition-transform ${open ? '' : '-rotate-90'}`}
          />
        )}
      </button>

      {open && (
        <div className={def.columns && def.columns > 1 ? `mt-3 grid gap-x-3 gap-y-2 grid-cols-${def.columns}` : 'mt-3 space-y-2'}>
          {def.type === 'custom' && def.render?.()}

          {def.type === 'select' && (
            <select
              value={(value as string) || ''}
              onChange={(e) => onChange(e.target.value || undefined)}
              className="eo-input py-1.5 text-body-sm"
            >
              <option value="">全部</option>
              {def.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}

          {def.type === 'radio' &&
            def.options?.map((o) => (
              <label key={o.value} className="flex items-center gap-2.5 cursor-pointer group/item py-0.5">
                <input
                  type="radio"
                  name={def.key}
                  checked={value === o.value}
                  onChange={() => onChange(o.value)}
                  className="w-3.5 h-3.5 accent-accent-500"
                />
                <span className="text-body-sm text-ink-soft group-hover/item:text-ink flex-1">{o.label}</span>
                {o.count !== undefined && (
                  <span className="font-mono text-caption text-muted">{o.count}</span>
                )}
              </label>
            ))}

          {def.type === 'checkbox' &&
            def.options?.map((o) => {
              const arr = (value as string[]) || []
              const checked = arr.includes(o.value)
              return (
                <label key={o.value} className="flex items-center gap-2.5 cursor-pointer group/item py-0.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      onChange(checked ? arr.filter((v) => v !== o.value) : [...arr, o.value])
                    }
                    className="w-3.5 h-3.5 rounded accent-accent-500"
                  />
                  <span className="text-body-sm text-ink-soft group-hover/item:text-ink flex-1">{o.label}</span>
                  {o.count !== undefined && (
                    <span className="font-mono text-caption text-muted">{o.count}</span>
                  )}
                </label>
              )
            })}

          {def.type === 'daterange' && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1">
                {[
                  { label: '近 7 天', days: 7 },
                  { label: '近 30 天', days: 30 },
                  { label: '近 90 天', days: 90 },
                ].map((p) => (
                  <button
                    key={p.days}
                    onClick={() => {
                      const to = new Date()
                      const from = new Date()
                      from.setDate(from.getDate() - p.days)
                      onChange({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) })
                    }}
                    className="px-2 py-1 text-caption rounded bg-canvas text-muted hover:bg-accent-50 hover:text-accent-700 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <input
                type="date"
                value={(value as any)?.from || ''}
                onChange={(e) => onChange({ ...(value as any), from: e.target.value })}
                className="eo-input py-1.5 text-label"
                aria-label={`${def.label}起始`}
              />
              <input
                type="date"
                value={(value as any)?.to || ''}
                onChange={(e) => onChange({ ...(value as any), to: e.target.value })}
                className="eo-input py-1.5 text-label"
                aria-label={`${def.label}截止`}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 左侧多维筛选面板。桌面端常驻，移动端折叠成按钮 + 抽屉。
 */
export default function FilterPanel({
  groups,
  values,
  onChange,
  activeCount = 0,
  className = '',
}: FilterPanelProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  const body = (
    <div className="eo-card p-3 space-y-3">
      {groups.map((g) => (
        <Group key={g.key} def={g} value={values[g.key]} onChange={(v) => onChange(g.key, v)} />
      ))}
    </div>
  )

  return (
    <>
      {/* 移动端触发 */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden inline-flex items-center gap-1.5 px-3 py-2 text-body-sm
          bg-surface border border-border rounded-md text-ink-soft"
      >
        <SlidersHorizontal size={14} /> 筛选
        {activeCount > 0 && (
          <span className="font-mono text-caption bg-accent-500 text-white rounded-full px-1.5">
            {activeCount}
          </span>
        )}
      </button>

      {/* 宽度由外层容器决定（如可调宽侧栏），自身只占满 */}
      <aside className={`hidden lg:block w-full flex-shrink-0 ${className}`}>
        <div className="sticky top-4">{body}</div>
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="relative w-[300px] max-w-[85vw] h-full bg-canvas overflow-y-auto p-3">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-5 right-5 text-muted hover:text-ink z-10"
              title={"关闭筛选"}
              aria-label="关闭筛选"
            >
              <X size={18} />
            </button>
            {body}
          </div>
        </div>
      )}
    </>
  )
}

