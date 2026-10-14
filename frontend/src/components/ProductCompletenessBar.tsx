import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, ClipboardCheck } from 'lucide-react'
import apiClient from '../api/client'

/**
 * 产品主数据完整度条（产品页统计卡片下方）。
 *
 * 报价、选型、技术协议都依赖「型号价格表 + 规格参数」，缺了只能靠人工；
 * 这里把各字段填写率和最不完整的产品列出来，点名称直接跳到该产品去补。
 * 只读度量，不改任何数据。
 */
interface Field {
  key: string
  label: string
  critical: boolean
  filled: number
  rate: number
}
interface Gap {
  id: string
  name: string
  category?: string
  score: number
  missing: string[]
}
interface Report {
  total: number
  quoteReady: number
  fields: Field[]
  gaps: Gap[]
}

const rateTone = (rate: number) =>
  rate >= 80 ? 'text-success-fg' : rate >= 40 ? 'text-warning-fg' : 'text-danger-fg'

export default function ProductCompletenessBar({ onPick }: { onPick?: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const { data, isError } = useQuery({
    queryKey: ['product-completeness'],
    queryFn: () => apiClient.get<Report>('/product-quality/completeness').then((r) => r.data as any),
    staleTime: 60_000,
  })
  const report: Report | undefined = (data as any)?.data ?? data
  if (isError || !report || !report.total) return null

  const labelOf = Object.fromEntries(report.fields.map((f) => [f.key, f.label]))
  return (
    <div className="mt-3 rounded-md border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <ClipboardCheck size={15} className="text-accent-600" />
          主数据完整度
        </span>
        <span className="text-sm text-ink">
          报价就绪 <b>{report.quoteReady}</b>/{report.total}
          <span className="text-xs text-muted ml-1">（型号价格表与规格参数齐全）</span>
        </span>
        {report.fields.map((f) => (
          <span key={f.key} className="text-xs text-muted whitespace-nowrap">
            {f.label}
            {f.critical && <span className="text-danger-fg">*</span>}{' '}
            <b className={rateTone(f.rate)}>{f.rate}%</b>
          </span>
        ))}
        <span className="ml-auto flex items-center text-xs text-accent-600">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {open ? '收起' : `缺失清单（${report.gaps.length}）`}
        </span>
      </button>
      {open && (
        <div className="border-t border-border max-h-64 overflow-y-auto">
          {report.gaps.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">所有产品的主数据都已齐全。</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted bg-canvas sticky top-0">
                <tr>
                  <th className="text-left font-normal px-3 py-1.5">产品</th>
                  <th className="text-left font-normal px-3 py-1.5 w-20">完整度</th>
                  <th className="text-left font-normal px-3 py-1.5">缺少</th>
                </tr>
              </thead>
              <tbody>
                {report.gaps.map((g) => (
                  <tr key={g.id} className="border-t border-border">
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        className="text-left text-ink hover:text-accent-600"
                        onClick={() => onPick?.(g.id)}
                        title="打开该产品"
                      >
                        {g.name}
                      </button>
                      {g.category && <span className="text-xs text-muted ml-1.5">{g.category}</span>}
                    </td>
                    <td className={`px-3 py-1.5 ${rateTone(g.score)}`}>{g.score}%</td>
                    <td className="px-3 py-1.5 text-xs text-muted">
                      {g.missing.map((k) => labelOf[k] || k).join('、')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="px-3 py-2 text-xs text-muted border-t border-border">
            带 * 的为报价必备项。点产品名打开该产品补数据；可参考「参数模板」「供应商产品」中已有的资料。
          </p>
        </div>
      )}
    </div>
  )
}
