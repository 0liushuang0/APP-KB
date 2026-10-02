import type { ReactNode } from 'react'
import { ArrowUpDown, Minus, TrendingDown, TrendingUp } from 'lucide-react'

export interface CompareColumn<T> {
  key: string
  title: string
  render?: (row: T) => ReactNode
  /** 数值列：用于排序与最优值高亮 */
  numeric?: (row: T) => number | null
  /** 该列最优方向。lower = 越小越好（价格、交期）；higher = 越大越好（评级、准时率） */
  better?: 'lower' | 'higher'
  align?: 'left' | 'right'
  unit?: string
}

interface CompareTableProps<T> {
  rows: T[]
  columns: CompareColumn<T>[]
  rowKey: (row: T) => string
  /** 分组表头，例如按国内/国外分组 */
  groupBy?: (row: T) => string
  sortKey?: string
  sortDesc?: boolean
  onSort?: (key: string) => void
  /** 勾选支持 */
  selected?: string[]
  onSelect?: (keys: string[]) => void
  actions?: (row: T) => ReactNode
  empty?: string
}

/**
 * 横向对比表。
 *
 * 每个数值列的最优值加绿色角标 —— 比价场景下用户要的是"哪家最划算"，
 * 而不是自己在一屏数字里心算。
 */
export default function CompareTable<T>({
  rows,
  columns,
  rowKey,
  groupBy,
  sortKey,
  sortDesc,
  onSort,
  selected,
  onSelect,
  actions,
  empty = '暂无可对比的数据',
}: CompareTableProps<T>) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted py-10 text-center">{empty}</p>
  }

  // 每个数值列的最优值
  const bests = new Map<string, number>()
  for (const col of columns) {
    if (!col.numeric || !col.better) continue
    const vals = rows.map(col.numeric).filter((v): v is number => v !== null && Number.isFinite(v))
    if (!vals.length) continue
    bests.set(col.key, col.better === 'lower' ? Math.min(...vals) : Math.max(...vals))
  }

  const groups = groupBy
    ? [...rows.reduce((m, r) => {
        const g = groupBy(r)
        if (!m.has(g)) m.set(g, [] as T[])
        m.get(g)!.push(r)
        return m
      }, new Map<string, T[]>()).entries()]
    : [['', rows] as [string, T[]]]

  const allKeys = rows.map(rowKey)
  const allSelected = selected && selected.length > 0 && allKeys.every((k) => selected.includes(k))

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-sm">
        <thead>
          <tr className="border-b border-border bg-subtle">
            {onSelect && (
              <th className="py-2.5 px-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => onSelect(allSelected ? [] : allKeys)}
                  className="w-3.5 h-3.5 rounded accent-accent-500"
                  aria-label="全选"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                className={`eo-th py-2.5 px-3 whitespace-nowrap ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {onSort && col.numeric ? (
                  <button
                    onClick={() => onSort(col.key)}
                    className="inline-flex items-center gap-1 hover:text-ink transition-colors"
                  >
                    {col.title}
                    {col.unit && <span className="normal-case">({col.unit})</span>}
                    <ArrowUpDown
                      size={11}
                      className={
                        sortKey === col.key
                          ? `text-accent-500 ${sortDesc ? 'rotate-180' : ''} transition-transform`
                          : 'opacity-40'
                      }
                    />
                  </button>
                ) : (
                  <>
                    {col.title}
                    {col.unit && <span className="normal-case"> ({col.unit})</span>}
                  </>
                )}
              </th>
            ))}
            {actions && <th className="eo-th py-2.5 px-3 text-right">操作</th>}
          </tr>
        </thead>

        <tbody>
          {groups.map(([groupName, groupRows]) => (
            <>
              {groupName && (
                <tr key={`g-${groupName}`}>
                  <td
                    colSpan={columns.length + (onSelect ? 1 : 0) + (actions ? 1 : 0)}
                    className="py-1.5 px-3 bg-canvas eo-label"
                  >
                    {groupName} · {groupRows.length}
                  </td>
                </tr>
              )}
              {groupRows.map((row) => {
                const key = rowKey(row)
                const checked = selected?.includes(key)
                return (
                  <tr
                    key={key}
                    className={`border-b border-divider last:border-0 transition-colors ${
                      checked ? 'bg-accent-50/50' : 'hover:bg-canvas'
                    }`}
                  >
                    {onSelect && (
                      <td className="py-2.5 px-3">
                        <input
                          type="checkbox"
                          checked={!!checked}
                          onChange={() =>
                            onSelect(
                              checked
                                ? selected!.filter((k) => k !== key)
                                : [...(selected || []), key],
                            )
                          }
                          className="w-3.5 h-3.5 rounded accent-accent-500"
                          aria-label="选择该行"
                        />
                      </td>
                    )}
                    {columns.map((col) => {
                      const num = col.numeric?.(row) ?? null
                      const isBest =
                        num !== null && bests.has(col.key) && num === bests.get(col.key)
                      return (
                        <td
                          key={col.key}
                          className={`py-2.5 px-3 ${col.align === 'right' ? 'text-right' : ''}`}
                        >
                          <span
                            className={`inline-flex items-center gap-1 ${
                              isBest ? 'text-success-fg font-medium' : 'text-ink'
                            }`}
                          >
                            {col.render ? col.render(row) : ((row as any)[col.key] ?? '-')}
                            {isBest && (
                              <span title={col.better === 'lower' ? '本列最低' : '本列最高'}>
                                {col.better === 'lower' ? (
                                  <TrendingDown size={12} />
                                ) : (
                                  <TrendingUp size={12} />
                                )}
                              </span>
                            )}
                          </span>
                        </td>
                      )
                    })}
                    {actions && <td className="py-2.5 px-3 text-right">{actions(row)}</td>}
                  </tr>
                )
              })}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export { Minus }

