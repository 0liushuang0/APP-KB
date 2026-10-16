import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Truck, Link2, Unlink, Search } from 'lucide-react'
import { supplierProductApi, quotationApi } from '../api/services'
import { useDebounce } from '../hooks/useDebounce'
import { useCostVisible } from '../hooks/useCostVisible'
import { fmtMoney } from '../utils/currency'
import type { SupplierProduct } from '../types'

/**
 * 产品详情 · 采购来源（供应产品 → 我方产品 映射）。
 *
 * 映射后，报价明细选这个产品就自动带出成本（有询价记录取最近一次，否则取目录价区间中值；
 * 映射多家取最高），毛利随之算出。原来供应商产品 595 条与产品库 0 映射，成本只能逐行手填。
 */
export default function ProductSupplySources({ productId }: { productId: string }) {
  const queryClient = useQueryClient()
  const costVisible = useCostVisible()
  const [keyword, setKeyword] = useState('')
  const debounced = useDebounce(keyword, 300)

  const mappedQuery = useQuery({
    queryKey: ['product-supply-sources', productId],
    queryFn: () => supplierProductApi.list({ productId }),
    enabled: !!productId,
  })
  const suggestQuery = useQuery({
    queryKey: ['product-supply-suggest', productId],
    queryFn: () => supplierProductApi.suggestForProduct(productId),
    enabled: !!productId,
  })
  const searchQuery = useQuery({
    queryKey: ['product-supply-search', debounced],
    queryFn: () => supplierProductApi.list({ keyword: debounced }),
    enabled: debounced.trim().length >= 1,
  })
  const costQuery = useQuery({
    queryKey: ['product-cost-hint', productId],
    queryFn: () => quotationApi.costHint(productId),
    enabled: !!productId && costVisible,
  })

  const mapped = mappedQuery.data || []
  const mappedIds = new Set(mapped.map((m) => m.id))

  const refresh = () => {
    for (const k of ['product-supply-sources', 'product-supply-suggest', 'product-supply-search', 'product-cost-hint']) {
      queryClient.invalidateQueries({ queryKey: [k] })
    }
  }

  const link = async (sp: SupplierProduct) => {
    try {
      await supplierProductApi.update(sp.id, { productName: sp.productName, productId } as any)
      toast.success(`已关联「${sp.productName}」为采购来源`)
      refresh()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '关联失败')
    }
  }
  const unlink = async (sp: SupplierProduct) => {
    try {
      await supplierProductApi.update(sp.id, { productName: sp.productName, productId: '' } as any)
      toast.success('已取消关联')
      refresh()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '取消失败')
    }
  }

  const price = (sp: SupplierProduct) => {
    const lo = sp.priceMin != null ? Number(sp.priceMin) : null
    const hi = sp.priceMax != null ? Number(sp.priceMax) : null
    if (lo == null && hi == null) return <span className="text-warning-fg">无价格</span>
    if (lo != null && hi != null && lo !== hi) return `${fmtMoney(lo, sp.currency)} ~ ${fmtMoney(hi, sp.currency)}`
    return fmtMoney(lo ?? hi, sp.currency)
  }

  const row = (sp: SupplierProduct & { score?: number; supplierName?: string }, action: 'link' | 'unlink') => (
    <div key={sp.id} className="flex items-center gap-3 px-3 py-2 rounded-md bg-subtle text-sm">
      <div className="flex-1 min-w-0">
        <div className="text-ink truncate">
          {sp.productName}
          {sp.brand && <span className="text-muted"> · {sp.brand}</span>}
          {sp.model && <span className="text-muted"> · {sp.model}</span>}
        </div>
        <div className="text-caption text-muted truncate">
          {sp.supplierName || '供应商'} · {sp.category || '未分类'}
          {sp.score != null && ` · 名称相似 ${sp.score}%`}
        </div>
      </div>
      <div className="text-caption eo-num text-ink-soft whitespace-nowrap">{price(sp)}</div>
      {action === 'link' ? (
        <button onClick={() => link(sp)} className="text-accent-600 hover:text-accent-700 flex items-center gap-1 text-caption">
          <Link2 size={13} /> 关联
        </button>
      ) : (
        <button onClick={() => unlink(sp)} className="text-muted hover:text-danger-fg flex items-center gap-1 text-caption">
          <Unlink size={13} /> 取消
        </button>
      )}
    </div>
  )

  const suggestions = (suggestQuery.data || []).filter((s) => !mappedIds.has(s.id))
  const results = (searchQuery.data || []).filter((s) => !mappedIds.has(s.id)).slice(0, 8)

  return (
    <div className="bg-surface rounded-xl border border-border shadow-card p-5 mb-4">
      <h3 className="text-sm font-semibold text-ink mb-1 flex items-center gap-2">
        <Truck size={16} className="text-accent-500" /> 采购来源
        <span className="text-caption text-muted font-normal">({mapped.length})</span>
      </h3>
      <p className="text-caption text-muted mb-3">
        关联供应管理里的供应产品后，报价选这个产品会自动带出成本（有询价取最近一次，否则取目录价中值；多家取最高），毛利随之算出。
      </p>

      {costVisible && costQuery.data && (
        <div className="mb-3 text-caption rounded-md px-3 py-2 bg-accent-50 text-accent-700">
          {costQuery.data.cost != null
            ? `报价时的单位成本：¥${Number(costQuery.data.cost).toLocaleString('zh-CN')}（${costQuery.data.label}）`
            : '报价时还带不出成本：关联下方供应产品，或在型号价格表里填成本价'}
        </div>
      )}

      <div className="space-y-1.5">
        {mapped.length ? mapped.map((sp) => row(sp, 'unlink')) : <p className="text-sm text-muted">还没有关联采购来源</p>}
      </div>

      {suggestions.length > 0 && (
        <div className="mt-4">
          <div className="eo-label mb-1.5">可能的采购来源（按名称相似推荐，确认后再关联）</div>
          <div className="space-y-1.5">{suggestions.slice(0, 5).map((sp) => row(sp, 'link'))}</div>
        </div>
      )}

      <div className="mt-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="在供应管理里搜供应产品（品名 / 型号 / 规格）"
            className="eo-input !pl-8 !py-1.5 !text-sm"
          />
        </div>
        {results.length > 0 && <div className="space-y-1.5 mt-2">{results.map((sp) => row(sp, 'link'))}</div>}
        {debounced && !searchQuery.isLoading && !results.length && (
          <p className="text-caption text-muted mt-2">没有匹配的供应产品</p>
        )}
      </div>
    </div>
  )
}
