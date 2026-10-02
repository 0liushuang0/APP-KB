import { useQuery } from '@tanstack/react-query'
import { systemApi } from '../api/services'

/**
 * 列表页统计卡片的数据源。
 *
 * 六个页面共用同一个 queryKey：在模块之间来回切时命中缓存，不会每进一个页面
 * 就把六张表重算一遍。数字变化不敏感（增删单据后由各页的 invalidate 带出来），
 * 所以给 30s staleTime。
 */
export function useModuleStats() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['module-stats'],
    queryFn: () => systemApi.moduleStats(),
    staleTime: 30_000,
  })
  return { stats: data, isLoading, isError }
}
