import type { ReactNode, ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'

export interface TimelineItem {
  id: string
  /** 阶段 / 动作标题 */
  title: string
  description?: ReactNode
  time?: string
  actor?: string
  /** 左侧圆点色调 */
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'
  icon?: ComponentType<LucideProps>
  /** 点击跳转 */
  onClick?: () => void
  /** 附加徽标 */
  badge?: ReactNode
}

const DOT: Record<string, string> = {
  accent: 'bg-accent-500 ring-accent-100',
  success: 'bg-success-fg ring-success-line',
  warning: 'bg-warning-fg ring-warning-line',
  danger: 'bg-danger-fg ring-danger-line',
  info: 'bg-info-fg ring-info-line',
  neutral: 'bg-muted ring-border',
}

interface TimelineProps {
  items: TimelineItem[]
  empty?: string
}

/** 竖向时间线。客户 360° 与项目链路共用，保证同一件事在两处长得一样。 */
export default function Timeline({ items, empty = '暂无动态' }: TimelineProps) {
  if (items.length === 0) {
    return <p className="text-sm text-muted py-8 text-center">{empty}</p>
  }

  return (
    <ol className="relative">
      {items.map((item, idx) => {
        const Icon = item.icon
        const last = idx === items.length - 1
        return (
          <li key={item.id} className="relative pl-8 pb-5 last:pb-0">
            {/* 连接线 */}
            {!last && <span className="absolute left-[7px] top-4 bottom-0 w-px bg-border" aria-hidden />}

            {/* 圆点 */}
            <span
              className={`absolute left-0 top-1 w-[15px] h-[15px] rounded-full ring-4 flex items-center
                justify-center ${DOT[item.tone || 'neutral']}`}
              aria-hidden
            >
              {Icon && <Icon size={8} className="text-white" />}
            </span>

            <div
              onClick={item.onClick}
              className={`min-w-0 ${
                item.onClick ? 'cursor-pointer group' : ''
              }`}
            >
              <div className="flex items-baseline gap-2 flex-wrap">
                <span
                  className={`text-body-sm font-medium text-ink ${
                    item.onClick ? 'group-hover:text-accent-600 transition-colors' : ''
                  }`}
                >
                  {item.title}
                </span>
                {item.badge}
                {item.time && (
                  <span className="font-mono text-caption text-muted ml-auto flex-shrink-0">{item.time}</span>
                )}
              </div>
              {item.description && (
                <div className="text-label text-muted mt-0.5">{item.description}</div>
              )}
              {item.actor && <div className="text-caption text-muted mt-0.5">经办：{item.actor}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

