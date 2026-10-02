import type { ReactNode, ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'

export interface TabDef {
  value: string
  label: string
  /** 右上角计数，0 与 undefined 都不显示 */
  count?: number
  icon?: ComponentType<LucideProps>
  disabled?: boolean
}

interface TabsProps {
  tabs: TabDef[]
  value: string
  onChange: (value: string) => void
  /** 右侧附加内容，例如筛选器 */
  extra?: ReactNode
  className?: string
}

/**
 * 详情页标签栏。下划线式，与顶栏面包屑的层级区分开。
 * 移动端横向滚动而不是换行 —— 换行会把内容顶下去半屏。
 */
export default function Tabs({ tabs, value, onChange, extra, className = '' }: TabsProps) {
  return (
    <div className={`flex items-end justify-between gap-4 border-b border-border ${className}`}>
      <div className="flex items-center gap-1 overflow-x-auto -mb-px" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = tab.value === value
          return (
            <button
              key={tab.value}
              role="tab"
              aria-selected={active}
              disabled={tab.disabled}
              onClick={() => onChange(tab.value)}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-body-sm font-medium
                border-b-2 whitespace-nowrap transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-t
                disabled:opacity-40 disabled:cursor-not-allowed ${
                  active
                    ? 'border-accent-500 text-accent-600'
                    : 'border-transparent text-muted hover:text-ink-soft'
                }`}
            >
              {Icon && <Icon size={14} />}
              {tab.label}
              {!!tab.count && (
                <span
                  className={`font-mono text-caption px-1.5 rounded ${
                    active ? 'bg-accent-50 text-accent-700' : 'bg-canvas text-muted'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {extra && <div className="pb-2 flex-shrink-0">{extra}</div>}
    </div>
  )
}

