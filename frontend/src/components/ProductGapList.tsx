import { useQuery } from '@tanstack/react-query'
import { Package, ChevronRight } from 'lucide-react'
import apiClient from '../api/client'

/**
 * 产品页右侧的默认内容：不再是半屏空白「选择左侧产品查看详情」，
 * 而是"先补哪几个"——按缺型号价格表/规格参数优先排好的待补清单，点一下打开那个产品。
 * 数据与顶部完整度条同源（同一个 queryKey，命中缓存不多发请求）。
 */
export default function ProductGapList({ onPick }: { onPick: (id: string) => void }) {
  const { data } = useQuery({
    queryKey: ['product-completeness'],
    queryFn: () => apiClient.get<any>('/product-quality/completeness').then((r) => r.data as any),
    staleTime: 60_000,
  })
  const report = (data as any)?.data ?? data
  const labelOf: Record<string, string> = Object.fromEntries((report?.fields || []).map((f: any) => [f.key, f.label]))
  const gaps: any[] = report?.gaps || []
  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="flex items-center gap-2 mb-1">
        <Package size={18} className="text-accent-600" />
        <h3 className="text-base font-semibold text-ink">先补这几个产品</h3>
      </div>
      <p className="text-sm text-muted mb-4">
        {report ? (
          <>报价就绪 <b className="text-ink">{report.quoteReady}/{report.total}</b>（有型号价格表和规格参数）。补齐后，报价单选型号即可带出价格，AI 问答也能按参数选型。</>
        ) : '正在统计…'}
      </p>
      {gaps.length === 0 && report && <p className="text-sm text-success-fg">所有产品的关键信息都已齐全。</p>}
      <ul className="space-y-1.5">
        {gaps.slice(0, 15).map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => onPick(g.id)}
              className="group w-full text-left rounded-lg border border-border hover:border-accent-400 px-3 py-2 flex items-center gap-3"
            >
              <span className="w-10 text-right text-sm font-semibold tabular-nums" style={{ color: g.score < 50 ? 'var(--color-danger-fg)' : 'var(--color-warning-fg)' }}>{g.score}%</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-ink truncate">{g.name}</span>
                <span className="block text-caption text-muted truncate">缺：{(g.missing || []).map((k: string) => labelOf[k] || k).join('、')}</span>
              </span>
              <ChevronRight size={14} className="text-muted opacity-0 group-hover:opacity-100" />
            </button>
          </li>
        ))}
      </ul>
      <p className="text-caption text-muted mt-3">也可以在左侧目录或搜索框里直接选产品</p>
    </div>
  )
}
