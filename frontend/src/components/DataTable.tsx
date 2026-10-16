import { useCallback, useEffect, useRef, useState } from 'react'
import Skeleton from './Skeleton'
import EmptyState from './EmptyState'

interface PaginationProps {
  page: number
  pageSize: number
  /** 总条数。服务端分页时必传 —— 否则无法算出总页数 */
  total?: number
  onChange: (page: number, pageSize: number) => void
  /**
   * 数据是否已由服务端分页。
   * true 时 data 就是当前页，组件不再本地切片；
   * 不设则维持旧的客户端切片行为，方便逐页迁移。
   */
  serverSide?: boolean
}

/**
 * 各列表页统一的每页条数档位。
 * 客户中心到售后管理、供应管理等所有走 DataTable 翻页条的页面共用，
 * 保证各处每页显示行数一致；切换时回到第 1 页。
 */
export const PAGE_SIZE_OPTIONS = [10, 15, 20]

interface Column<T> {
  key: string
  title: string
  sortable?: boolean
  render?: (row: T) => React.ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  loading?: boolean
  rowKey?: (row: T) => string
  actions?: (row: T) => React.ReactNode
  pagination?: PaginationProps
  onSort?: (key: string, direction: 'asc' | 'desc' | null) => void
  sortKey?: string
  sortDirection?: 'asc' | 'desc' | null
  /** 行级样式，用于高亮（如从全局搜索跳转过来的目标行） */
  rowClassName?: (row: T) => string
  onRowClick?: (row: T) => void
  onRowDoubleClick?: (row: T) => void
  /** 空数据时的自定义展示，不传则用默认 EmptyState */
  emptyState?: React.ReactNode
  /** 空状态行动入口：空列表不只是"暂无数据"，要给用户下一步（如"新建第一个XX"） */
  emptyAction?: React.ReactNode
  /** 行选择 */
  selectedKeys?: string[]
  onSelectionChange?: (keys: string[]) => void
  /**
   * 列宽记忆的存储键。
   * 传了才启用拖拽调宽 —— 不同页面的列不一样，宽度不能混用一份记录。
   */
  widthStorageKey?: string
  /** 隐藏的列（列配置 / 保存的视图）；按 column.key */
  hiddenColumns?: string[]
  /** 表格上方的工具条（如「保存的视图 / 列」），拿到全部列定义；空列表时也显示，便于切回 */
  toolbar?: (columns: Array<{ key: string; title: string }>) => React.ReactNode
}

export default function DataTable<T>({
  columns: allColumns,
  data,
  loading = false,
  rowKey,
  actions,
  pagination,
  onSort,
  sortKey,
  sortDirection,
  rowClassName,
  onRowClick,
  onRowDoubleClick,
  emptyState,
  emptyAction,
  selectedKeys,
  widthStorageKey,
  onSelectionChange,
  hiddenColumns,
  toolbar,
}: DataTableProps<T>) {
  const bar = toolbar ? toolbar(allColumns.map((c) => ({ key: c.key, title: c.title }))) : null
  const columns = hiddenColumns?.length ? allColumns.filter((c) => !hiddenColumns.includes(c.key)) : allColumns
  /*
   * 列宽拖拽。
   *
   * 业务表格里「项目名称」这类列动辄二三十字，默认等分会把它挤成三行，
   * 而「状态」只占四个字却分到同样宽度。宽度是每个人自己的习惯，
   * 存 localStorage 即可 —— 单机产品不需要同步到服务端。
   */
  const [widths, setWidths] = useState<Record<string, number>>({})
  const dragRef = useRef<{ key: string; startX: number; startW: number } | null>(null)

  useEffect(() => {
    if (!widthStorageKey) return
    try {
      const raw = localStorage.getItem(`aikb-colw-${widthStorageKey}`)
      if (raw) setWidths(JSON.parse(raw))
    } catch {
      /* 存坏了就用默认宽度，不值得为此报错 */
    }
  }, [widthStorageKey])

  const onDragStart = useCallback(
    (key: string, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation() // 否则会连带触发表头的排序点击
      const th = (e.target as HTMLElement).closest('th')
      dragRef.current = { key, startX: e.clientX, startW: th?.offsetWidth ?? 120 }

      const onMove = (ev: MouseEvent) => {
        const d = dragRef.current
        if (!d) return
        // 下限 60px：再窄就连表头文字都放不下，等于把列弄丢了
        const next = Math.max(60, d.startW + (ev.clientX - d.startX))
        setWidths((prev) => ({ ...prev, [d.key]: next }))
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        dragRef.current = null
        if (widthStorageKey) {
          setWidths((cur) => {
            try {
              localStorage.setItem(`aikb-colw-${widthStorageKey}`, JSON.stringify(cur))
            } catch {
              /* 隐私模式下写不进去，本次会话内仍然生效 */
            }
            return cur
          })
        }
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [widthStorageKey],
  )

  const total = pagination?.total ?? data.length
  const totalPages = pagination ? Math.max(1, Math.ceil(total / pagination.pageSize)) : 1

  // 服务端分页时 data 已是当前页，再切一次会把内容切没
  const pagedData =
    pagination && !pagination.serverSide
      ? data.slice((pagination.page - 1) * pagination.pageSize, pagination.page * pagination.pageSize)
      : data

  const renderSortIcon = (col: Column<T>) => {
    if (!col.sortable || !onSort) return null
    const active = sortKey === col.key
    return (
      <span className="ml-1 text-xs text-muted cursor-pointer">
        {active && sortDirection === 'asc' && '↑'}
        {active && sortDirection === 'desc' && '↓'}
        {!active && '↕'}
      </span>
    )
  }

  const handleHeaderClick = (col: Column<T>) => {
    if (!col.sortable || !onSort) return
    let direction: 'asc' | 'desc' | null = 'asc'
    if (sortKey === col.key) {
      if (sortDirection === 'asc') direction = 'desc'
      else if (sortDirection === 'desc') direction = null
    }
    onSort(col.key, direction)
  }

  if (!loading && data.length === 0) {
    return <>{bar}{emptyState ?? <EmptyState action={emptyAction} />}</>
  }

  const skeletonRows = 5

  return (
    <>
    {bar}
    <div className="eo-card overflow-hidden">
      <div className="overflow-x-auto">
        {/*
          有自定义列宽时才切 table-fixed：auto 布局下内容会把设定的宽度撑破，
          拖了没反应。但一上来就 fixed 会让所有列均分，反而不如浏览器自动分配，
          所以只在用户真的拖过之后才切。
        */}
        <table className={`w-full text-sm ${Object.keys(widths).length ? 'table-fixed' : ''}`}>
          <thead className="bg-canvas">
            <tr>
              {onSelectionChange && (
                <th className="eo-th px-2.5 py-1.5 w-10">
                  <input
                    type="checkbox"
                    checked={selectedKeys?.length === pagedData.length && pagedData.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onSelectionChange(pagedData.map((row, i) => rowKey ? rowKey(row) : String(i)))
                      } else {
                        onSelectionChange([])
                      }
                    }}
                    className="rounded border-border"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={widths[col.key] ? { width: widths[col.key], minWidth: widths[col.key] } : undefined}
                  className="eo-th px-2.5 py-1.5 text-left border-l border-border/60 first:border-l-0 relative group/th truncate"
                  aria-sort={
                    sortKey !== col.key || !sortDirection
                      ? 'none'
                      : sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                  }
                >
                  {col.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => handleHeaderClick(col)}
                      className="inline-flex items-center select-none hover:text-ink"
                    >
                      {col.title}
                      {renderSortIcon(col)}
                    </button>
                  ) : col.title}
                  {/* 拖拽手柄：贴在列右边界，悬停才显形，避免表头看起来一片竖线 */}
                  {widthStorageKey && (
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`调整「${col.title}」列宽`}
                      onMouseDown={(e) => onDragStart(col.key, e)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none
                                 hover:bg-accent-400/60 group-hover/th:bg-border"
                    />
                  )}
                </th>
              ))}
              {actions && <th className="eo-th px-2.5 py-1.5 text-left">操作</th>}
            </tr>
          </thead>
          <tbody>
            {loading && data.length === 0 ? (
              Array.from({ length: skeletonRows }).map((_, rowIdx) => (
                <tr key={rowIdx} className="border-t border-border">
                  {columns.map((col) => (
                    <td key={col.key} className="px-2.5 py-1.5 truncate">
                      <Skeleton className="h-4 w-20" />
                    </td>
                  ))}
                  {actions && (
                    <td className="px-2.5 py-1.5">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-4" />
                        <Skeleton className="h-4 w-4" />
                        <Skeleton className="h-4 w-4" />
                      </div>
                    </td>
                  )}
                </tr>
              ))
            ) : (
              pagedData.map((row, idx) => {
                const key = rowKey ? rowKey(row) : String(idx)
                const isSelected = selectedKeys?.includes(key)
                return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            onRowClick(row)
                          }
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  className={`border-t border-border hover:bg-accent-50/40 transition-colors ${
                    onRowDoubleClick ? 'cursor-pointer select-none' : onRowClick ? 'cursor-pointer' : ''
                  } ${isSelected ? 'bg-accent-50/60' : ''} ${rowClassName?.(row) || ''}`}
                >
                  {onSelectionChange && (
                    <td className="px-3 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation()
                          const newKeys = isSelected
                            ? selectedKeys!.filter((k) => k !== key)
                            : [...(selectedKeys || []), key]
                          onSelectionChange(newKeys)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-border"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className="px-2.5 py-1.5 text-ink-soft truncate">
                      {col.render ? col.render(row) : (row as any)[col.key]}
                    </td>
                  ))}
                  {actions && <td className="px-2.5 py-1.5">{actions(row)}</td>}
                </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {pagination && total > 0 && (
        <div className="flex items-center justify-between px-2.5 py-2 border-t border-border bg-canvas/60 text-sm">
          <div className="flex items-center gap-2 text-muted">
            <span>共 {total} 条，第 {pagination.page} / {totalPages} 页</span>
            <select
              value={pagination.pageSize}
              onChange={(e) => pagination.onChange(1, Number(e.target.value))}
              className="px-1.5 py-0.5 border border-border rounded bg-surface text-xs text-ink-soft"
              aria-label="每页显示条数"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} 条/页</option>
              ))}
              {/* 个别页面初始条数不在档位内时也能正常显示 */}
              {!PAGE_SIZE_OPTIONS.includes(pagination.pageSize) && (
                <option value={pagination.pageSize}>{pagination.pageSize} 条/页</option>
              )}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={pagination.page <= 1}
              onClick={() => pagination.onChange(pagination.page - 1, pagination.pageSize)}
              className="px-3 py-1 border border-border rounded-md bg-surface disabled:opacity-50 hover:bg-subtle"
            >
              上一页
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum = i + 1
              if (totalPages > 5) {
                if (pagination.page <= 3) pageNum = i + 1
                else if (pagination.page >= totalPages - 2) pageNum = totalPages - 4 + i
                else pageNum = pagination.page - 2 + i
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => pagination.onChange(pageNum, pagination.pageSize)}
                  aria-current={pagination.page === pageNum ? 'page' : undefined}
                  className={`px-3 py-1 border rounded-md ${
                    pagination.page === pageNum
                      ? 'bg-accent-500 text-white border-accent-500'
                      : 'bg-surface border-border hover:bg-canvas'
                  }`}
                >
                  {pageNum}
                </button>
              )
            })}
            <button
              disabled={pagination.page >= totalPages}
              onClick={() => pagination.onChange(pagination.page + 1, pagination.pageSize)}
              className="px-3 py-1 border border-border rounded-md bg-surface disabled:opacity-50 hover:bg-subtle"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  )
}
