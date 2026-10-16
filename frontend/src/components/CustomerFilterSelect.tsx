import { useQuery } from '@tanstack/react-query'
import { customerApi } from '../api/services'

/**
 * 列表顶栏的客户筛选下拉（业务单据各页共用）。
 *
 * - 按服务端上限分页拉全（单页上限 200，客户 200+ 时翻页拼接），
 *   之前一次拉 500 会撞后端 pageSize≤200 的校验，需求页弹报错
 * - 「未关联客户」用特殊值 'none'：业务链上存在没挂客户的单据，
 *   单独捞出来才能补录，混在"全部"里永远看不见
 * - 后端约定 'none' → customerId IS NULL
 */
export default function CustomerFilterSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const { data } = useQuery({
    queryKey: ['customer-filter-options'],
    queryFn: async () => {
      const PAGE = 200
      const first = await customerApi.list({ pageSize: PAGE })
      const total = (first as any)?.total ?? 0
      let all = Array.isArray(first) ? first : (first as any)?.list ?? []
      const pages = Math.min(Math.ceil(Number(total) / PAGE), 10)
      for (let p = 2; p <= pages; p++) {
        const next = await customerApi.list({ pageSize: PAGE, page: p })
        all = all.concat(Array.isArray(next) ? next : (next as any)?.list ?? [])
      }
      return all
    },
    staleTime: 5 * 60_000,
  })
  const list: any[] = Array.isArray(data) ? data : (data?.list ?? [])
  const sorted = [...list].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'),
  )
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="eo-input !w-44 !py-1.5 !text-xs"
      aria-label="按客户筛选"
      title="按客户筛选"
    >
      <option value="">全部客户</option>
      <option value="none">未关联客户</option>
      {sorted.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
}
