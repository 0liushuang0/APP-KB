import { useEffect, useState, useMemo } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'

/** 后端 paginate() 的返回形状（totalPages 可选：部分接口用 PaginatedResponse 不带该字段，实际只消费 list/total） */
export interface PagedResponse<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
  totalPages?: number
}

interface Options<T> {
  /** react-query key 的前缀，通常是资源名 */
  key: unknown[]
  /** 传入分页参数，返回接口结果 */
  fetcher: (params: Record<string, unknown>) => Promise<PagedResponse<T> | T[]>
  /** 业务筛选条件；变化时自动回到第 1 页 */
  filters?: Record<string, unknown>
  initialPageSize?: number
  enabled?: boolean
}

/**
 * 列表页分页查询。
 *
 * 后端已改为服务端分页（权限下沉到 SQL），前端不能再本地切片。
 * 这里统一处理三件事：
 *   · 筛选条件变化时把页码重置回 1（否则会停在一个可能已不存在的页上）
 *   · 兼容仍返回裸数组的旧接口，便于逐个迁移
 *   · 翻页时保留上一页数据，避免表格闪烁成空白
 */
export function usePagedQuery<T>({
  key,
  fetcher,
  filters = {},
  initialPageSize = 15,
  enabled = true,
}: Options<T>) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  /*
   * 排序也必须走服务端。
   * 列表一次只取一页，本地排序只会把「当前这一页」重排，
   * 看起来生效了，其实第 2 页的数据根本没参与比较。
   */
  const [sortBy, setSortBy] = useState<string | undefined>()
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC' | undefined>()

  // 用序列化后的筛选条件做依赖，避免每次渲染新建对象导致无限重置
  const filterKey = useMemo(() => JSON.stringify(filters), [filters])

  useEffect(() => {
    setPage(1)
  }, [filterKey, pageSize])

  const query = useQuery({
    queryKey: [...key, filterKey, page, pageSize, sortBy, sortOrder],
    queryFn: () => fetcher({ ...filters, page, pageSize, sortBy, sortOrder }),
    enabled,
    placeholderData: keepPreviousData,
  })

  const raw = query.data
  const list: T[] = Array.isArray(raw) ? raw : (raw?.list ?? [])
  const total = Array.isArray(raw) ? raw.length : (raw?.total ?? 0)
  // 裸数组说明该接口还没接分页，仍走客户端切片
  const serverSide = !Array.isArray(raw) && raw !== undefined

  return {
    ...query,
    list,
    total,
    page,
    pageSize,
    setPage,
    setPageSize,
    sortBy,
    sortOrder,
    /** 直接设置排序（套用「保存的视图」时用） */
    setSort: (by?: string, order?: 'ASC' | 'DESC') => {
      setSortBy(by)
      setSortOrder(by ? order : undefined)
      setPage(1)
    },
    /** 直接摊给 <DataTable onSort={...} sortKey sortDirection /> */
    onSort: (k: string, dir: 'asc' | 'desc' | null) => {
      setSortBy(dir ? k : undefined)
      setSortOrder(dir === 'asc' ? 'ASC' : dir === 'desc' ? 'DESC' : undefined)
      setPage(1) // 换了排序，停在第 3 页没有意义
    },
    /** 直接摊给 <DataTable pagination={...} /> */
    pagination: {
      page,
      pageSize,
      total,
      serverSide,
      onChange: (p: number, ps: number) => {
        setPage(p)
        if (ps !== pageSize) setPageSize(ps)
      },
    },
  }
}
