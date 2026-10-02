import type { ReactNode } from 'react'
import { Inbox, type LucideProps } from 'lucide-react'

interface EmptyStateProps {
  title?: string
  description?: string
  /** 主行动，例如「新建客户」——空状态应该给出下一步，而不只是告知为空 */
  action?: ReactNode
  icon?: React.ComponentType<LucideProps>
  /** 内嵌在已有卡片里时关闭自带边框，避免双层卡片 */
  bare?: boolean
}

export default function EmptyState({
  title = '暂无数据',
  description = '还没有任何记录',
  action,
  icon: Icon = Inbox,
  bare = false,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-12 px-6 text-center ${
        bare ? '' : 'bg-surface rounded-xl border border-border'
      }`}
    >
      <div className="w-12 h-12 rounded-xl bg-canvas flex items-center justify-center mb-3">
        <Icon size={22} className="text-muted" />
      </div>
      <p className="text-ink-soft font-medium">{title}</p>
      {description && <p className="text-sm text-muted mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
