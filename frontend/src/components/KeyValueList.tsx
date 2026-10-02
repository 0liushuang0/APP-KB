import type { ReactNode } from 'react'

export interface KeyValueItem {
  label: string
  value?: ReactNode
  /** 数值 / 编号 / 日期用等宽字体，便于纵向比对 */
  mono?: boolean
  /** 跨整行显示，用于长文本 */
  full?: boolean
}

interface KeyValueListProps {
  items: KeyValueItem[]
  /** 每行列数，默认 2；字段少时用 1 更紧凑 */
  columns?: 1 | 2 | 3
  className?: string
}

const COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
}

/** 详情页字段展示。空值统一显示 `-`，不留空白造成"是不是没加载出来"的疑惑。 */
export default function KeyValueList({ items, columns = 2, className = '' }: KeyValueListProps) {
  return (
    <dl className={`grid ${COLS[columns]} gap-x-8 gap-y-4 ${className}`}>
      {items.map((item, idx) => {
        const empty = item.value === null || item.value === undefined || item.value === ''
        return (
          <div key={idx} className={item.full ? 'sm:col-span-full' : ''}>
            <dt className="eo-label mb-1">{item.label}</dt>
            <dd
              className={`text-body-sm ${empty ? 'text-muted' : 'text-ink'} ${
                item.mono ? 'font-mono' : ''
              } break-words`}
            >
              {empty ? '-' : item.value}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

