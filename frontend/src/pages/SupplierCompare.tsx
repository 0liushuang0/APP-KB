import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, ArrowLeft, Scale, AlertTriangle, Recycle, Copy } from 'lucide-react'
import { supplierApi, materialApi } from '../api/services'
import EntityPicker from '../components/EntityPicker'
import { useDebounce } from '../hooks/useDebounce'
import {
  type CompareRow,
  SUPPLIER_CATEGORY_OPTIONS,
  SUPPLIER_ORIGIN_OPTIONS,
  SUPPLIER_TIER_OPTIONS,
} from '../types'
import Button from '../components/Button'
import PageHeader from '../components/PageHeader'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import EmptyState from '../components/EmptyState'
import CompareTable, { type CompareColumn } from '../components/CompareTable'

const fmt = (v: number | null, currency = 'CNY') => {
  if (v == null) return '-'
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '¥'
  return `${symbol}${v.toLocaleString('zh-CN')}`
}

export default function SupplierCompare() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [category, setCategory] = useState(searchParams.get('category') || '')
  const [keyword, setKeyword] = useState(searchParams.get('keyword') || '')
  const [materialId, setMaterialId] = useState('')
  const [origin, setOrigin] = useState('')
  const [tier, setTier] = useState('')
  const [groupByOrigin, setGroupByOrigin] = useState(true)
  const [sortKey, setSortKey] = useState('priceMin')
  const [sortDesc, setSortDesc] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  const debouncedKeyword = useDebounce(keyword, 300)

  const hasQuery = !!(category || debouncedKeyword || materialId)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['supplier-compare', category, debouncedKeyword, origin, tier, materialId],
    queryFn: () =>
      supplierApi.compare({
        category: category || undefined,
        materialId: materialId || undefined,
        keyword: debouncedKeyword || undefined,
        origin: origin || undefined,
        tier: tier || undefined,
      }),
    enabled: hasQuery,
  })

  const rows = useMemo(() => {
    const list = [...(data || [])]
    const num = (r: CompareRow) => {
      switch (sortKey) {
        case 'priceMin': return r.priceMin ?? Infinity
        case 'deliveryDays': return r.deliveryDays ?? Infinity
        case 'onTimeRate': return r.onTimeRate ?? -Infinity
        case 'moq': return r.moq ?? Infinity
        default: return 0
      }
    }
    list.sort((a, b) => (sortDesc ? num(b) - num(a) : num(a) - num(b)))
    return list
  }, [data, sortKey, sortDesc])

  const columns: CompareColumn<CompareRow>[] = [
    {
      key: 'supplierName',
      title: '供应商',
      render: (r) => (
        <button
          onClick={() => navigate(`/suppliers?highlight=${r.supplierId}`)}
          className="text-left hover:text-accent-600 transition-colors"
        >
          <div className="text-ink">{r.supplierName}</div>
          <div className="text-caption text-muted">
            {r.originLabel}
            {r.country ? ` · ${r.country}` : ''} · {r.tierLabel}
          </div>
        </button>
      ),
    },
    {
      key: 'productName',
      title: '产品 / 型号',
      render: (r) => (
        <div className="min-w-0">
          <div className="text-ink flex items-center gap-1.5">
            {r.productName}
            {r.isSubstitutable && (
              <span
                title="可作为进口件的国产替代"
                className="inline-flex items-center gap-0.5 font-mono text-caption px-1 py-0.5 rounded bg-success-bg text-success-fg"
              >
                <Recycle size={9} /> 替代
              </span>
            )}
          </div>
          <div className="font-mono text-caption text-muted truncate">
            {[r.brand, r.model].filter(Boolean).join(' ') || '-'}
          </div>
        </div>
      ),
    },
    {
      key: 'specification',
      title: '规格',
      render: (r) => (
        <span className="text-label text-muted line-clamp-2" title={r.specification || ''}>
          {r.specification || '-'}
        </span>
      ),
    },
    {
      key: 'priceMin',
      title: '价格',
      align: 'right',
      numeric: (r) => r.priceMin,
      better: 'lower',
      render: (r) => (
        <div className="text-right">
          <span className="eo-num">
            {r.priceMin != null && r.priceMax != null && r.priceMin !== r.priceMax
              ? `${fmt(r.priceMin, r.currency)} ~ ${fmt(r.priceMax, r.currency)}`
              : fmt(r.priceMin ?? r.priceMax, r.currency)}
          </span>
          <div className="text-caption text-muted flex items-center gap-1 justify-end">
            {r.priceDate ? new Date(r.priceDate).toLocaleDateString('zh-CN') : '无日期'}
            {r.priceStale && (
              <span title="价格采集超过 180 天，报价前建议重新询价">
                <AlertTriangle size={10} className="text-warning-fg" />
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'deliveryDays',
      title: '交期',
      unit: '天',
      align: 'right',
      numeric: (r) => r.deliveryDays,
      better: 'lower',
      render: (r) => <span className="eo-num">{r.deliveryDays ?? '-'}</span>,
    },
    {
      key: 'moq',
      title: '起订量',
      align: 'right',
      numeric: (r) => r.moq,
      better: 'lower',
      render: (r) => <span className="eo-num">{r.moq ?? '-'}</span>,
    },
    {
      key: 'onTimeRate',
      title: '准时率',
      unit: '%',
      align: 'right',
      numeric: (r) => r.onTimeRate,
      better: 'higher',
      render: (r) => <span className="eo-num">{r.onTimeRate != null ? `${r.onTimeRate}%` : '-'}</span>,
    },
    {
      key: 'rating',
      title: '评级',
      render: (r) => <span className="uppercase font-mono text-label">{r.rating || '-'}</span>,
    },
  ]

  /** 把选中行复制成可粘进报价单的制表符文本 */
  const copySelected = () => {
    const picked = rows.filter((r) => selected.includes(r.productId))
    if (!picked.length) return
    const header = ['供应商', '产品', '品牌', '型号', '规格', '单价', '币种', '交期(天)'].join('\t')
    const body = picked
      .map((r) =>
        [
          r.supplierName,
          r.productName,
          r.brand || '',
          r.model || '',
          r.specification || '',
          r.priceMin ?? '',
          r.currency,
          r.deliveryDays ?? '',
        ].join('\t'),
      )
      .join('\n')
    navigator.clipboard.writeText(`${header}\n${body}`)
    toast.success(`已复制 ${picked.length} 行，可直接粘贴到报价单`)
  }

  return (
    <div>
      <button
        onClick={() => navigate('/suppliers')}
        className="flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors mb-4"
      >
        <ArrowLeft size={16} /> 返回供应商列表
      </button>

      <PageHeader
        title="价格"
        titleEm="对比"
        actions={
          selected.length > 0 ? (
            <Button variant="secondary" onClick={copySelected}>
              <Copy size={15} className="mr-1" /> 复制选中 {selected.length} 行
            </Button>
          ) : undefined
        }
      />

      {/* 查询条件 */}
      <div className="eo-card p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label htmlFor="cmp-category" className="eo-label block mb-1">产品类别</label>
            <select
              id="cmp-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="eo-input py-2"
            >
              <option value="">全部品类</option>
              {SUPPLIER_CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cmp-keyword" className="eo-label block mb-1">关键词</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="cmp-keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="产品名 / 型号 / 品牌 / 规格"
                className="eo-input pl-9 py-2"
              />
            </div>
          </div>
          <div>
            <label htmlFor="cmp-origin" className="eo-label block mb-1">来源</label>
            <select id="cmp-origin" value={origin} onChange={(e) => setOrigin(e.target.value)} className="eo-input py-2">
              <option value="">国内 + 国外</option>
              {SUPPLIER_ORIGIN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cmp-tier" className="eo-label block mb-1">品牌层级</label>
            <select id="cmp-tier" value={tier} onChange={(e) => setTier(e.target.value)} className="eo-input py-2">
              <option value="">全部层级</option>
              {SUPPLIER_TIER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        {/* 按物料比价：选物料后只看挂到该物料的各厂家（同规格跨厂家比价） */}
        <div className="mt-3">
          <EntityPicker
            label="按物料比价（选物料后只比同规格各厂家）"
            queryKey="materials-compare"
            value={materialId}
            onChange={(id: string) => setMaterialId(id)}
            search={async (kw: string) => {
              const res = await materialApi.list({ keyword: kw || undefined })
              return (Array.isArray(res) ? res : []).map((m: any) => ({
                value: m.id, label: `${m.name}（${m.materialCode}）`, hint: m.category,
              }))
            }}
            resolve={async (id: string) => {
              const m = await materialApi.get(id)
              return m ? { value: m.id, label: `${m.name}（${m.materialCode}）` } : null
            }}
            placeholder="搜索物料名称…（清空则按品类/关键词比价）"
          />
        </div>

        <label className="mt-3 inline-flex items-center gap-2 text-body-sm text-ink-soft">
          <input
            type="checkbox"
            checked={groupByOrigin}
            onChange={(e) => setGroupByOrigin(e.target.checked)}
            className="w-3.5 h-3.5 rounded accent-accent-500"
          />
          按国内 / 国外分组
        </label>
      </div>

      {!hasQuery && (
        <EmptyState
          icon={Scale}
          title="选择品类或输入关键词开始对比"
          description="系统会拉出所有供应商的同类产品，按价格排序并标出各列最优值"
        />
      )}

      {hasQuery && isLoading && <PageLoader />}
      {hasQuery && isError && <ErrorState message={(error as any)?.message || '加载失败'} onRetry={refetch} />}

      {hasQuery && !isLoading && !isError && (
        <div className="eo-card overflow-hidden">
          {rows.length > 0 && (
            <div className="px-4 py-2.5 border-b border-border bg-subtle flex items-center justify-between">
              <span className="text-body-sm text-ink-soft">
                共 <span className="eo-num font-medium">{rows.length}</span> 条可比产品
                {rows.some((r) => r.priceStale) && (
                  <span className="ml-2 text-warning-fg text-label">
                    · {rows.filter((r) => r.priceStale).length} 条价格已过期
                  </span>
                )}
              </span>
            </div>
          )}
          <CompareTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.productId}
            groupBy={groupByOrigin ? (r) => r.originLabel : undefined}
            sortKey={sortKey}
            sortDesc={sortDesc}
            onSort={(key) => {
              if (key === sortKey) setSortDesc((d) => !d)
              else {
                setSortKey(key)
                setSortDesc(false)
              }
            }}
            selected={selected}
            onSelect={setSelected}
            empty="没有匹配的可比产品，换个品类或关键词试试"
          />
        </div>
      )}
    </div>
  )
}

