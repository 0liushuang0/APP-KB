/**
 * 分类计数的横向条形图（客户按行业/区域/等级分布等）。
 * 点一行可作为筛选（onPick），不传则纯展示。
 */
export interface DistributionItem {
  key: string
  label: string
  count: number
}

export default function DistributionBars({
  items,
  max: maxRows = 6,
  onPick,
  activeKey,
  color = 'var(--viz-1)',
}: {
  items: DistributionItem[]
  max?: number
  onPick?: (key: string) => void
  activeKey?: string
  color?: string
}) {
  const sorted = [...items].filter((i) => i.count > 0).sort((a, b) => b.count - a.count)
  const top = sorted.slice(0, maxRows)
  const rest = sorted.slice(maxRows).reduce((s, i) => s + i.count, 0)
  const peak = Math.max(...top.map((i) => i.count), 1)
  if (!top.length) return <div className="text-caption text-muted py-2">暂无数据</div>
  return (
    <div className="space-y-1">
      {top.map((i) => {
        const Tag = onPick ? 'button' : 'div'
        return (
          <Tag
            key={i.key}
            {...(onPick ? { type: 'button' as const, onClick: () => onPick(i.key) } : {})}
            className={`w-full flex items-center gap-2 text-left rounded px-1 py-0.5 ${
              onPick ? 'hover:bg-subtle' : ''
            } ${activeKey === i.key ? 'bg-accent-50' : ''}`}
            title={`${i.label}：${i.count}`}
          >
            <span className="w-16 shrink-0 truncate text-caption text-ink-soft">{i.label}</span>
            <span className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-divider)' }}>
              <span className="block h-full rounded-full" style={{ width: `${(i.count / peak) * 100}%`, background: color }} />
            </span>
            <span className="w-8 shrink-0 text-right text-caption text-ink tabular-nums">{i.count}</span>
          </Tag>
        )
      })}
      {rest > 0 && <div className="text-caption text-muted pl-1">其他 {rest}</div>}
    </div>
  )
}
