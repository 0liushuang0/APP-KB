import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, Archive, BrainCircuit, FileSearch, Package, Stamp, ChevronRight } from 'lucide-react'
import apiClient from '../api/client'

/**
 * 工作台「系统健康」。
 *
 * 五项：AI 可检索覆盖、产品报价就绪、待审批、文档解析成功率、数据备份。
 * 每项给红/黄/绿与一句话，点击直接去处理的页面 —— 负责人不用懂技术也能知道哪里要管一下。
 * 数据来自 /api/ops-health/overview（只读汇总），5 分钟刷新。
 */
type Level = 'ok' | 'warn' | 'bad'
interface Item {
  key: 'index' | 'products' | 'approvals' | 'parse' | 'backup'
  label: string
  level: Level
  value: string
  detail: string
  path: string
}

const ICONS = { index: BrainCircuit, products: Package, approvals: Stamp, parse: FileSearch, backup: Archive }
const TONE: Record<Level, { dot: string; text: string; label: string }> = {
  ok: { dot: 'bg-success-fg', text: 'text-success-fg', label: '正常' },
  warn: { dot: 'bg-warning-fg', text: 'text-warning-fg', label: '关注' },
  bad: { dot: 'bg-danger-fg', text: 'text-danger-fg', label: '需处理' },
}

export default function SystemHealthPanel() {
  const navigate = useNavigate()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ops-health'],
    queryFn: () => apiClient.get('/ops-health/overview').then((r) => r.data),
    refetchInterval: 5 * 60_000,
    retry: false,
  })
  const payload: { items: Item[]; at: string } | undefined = (data as any)?.data ?? data
  if (isError) return null
  const items = payload?.items || []
  const worst: Level = items.some((i) => i.level === 'bad') ? 'bad' : items.some((i) => i.level === 'warn') ? 'warn' : 'ok'

  return (
    <div className="eo-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5">
          <Activity size={15} className="text-accent-600" /> 系统健康
          {!isLoading && items.length > 0 && (
            <span className={`text-caption font-normal ${TONE[worst].text}`}>
              · {worst === 'ok' ? '一切正常' : `${items.filter((i) => i.level !== 'ok').length} 项需要关注`}
            </span>
          )}
        </h2>
        {payload?.at && <span className="text-caption text-muted">更新于 {new Date(payload.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[74px] rounded-md bg-subtle animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {items.map((it) => {
            const Icon = ICONS[it.key] || Activity
            const tone = TONE[it.level]
            return (
              <button
                key={it.key}
                type="button"
                onClick={() => navigate(it.path)}
                className="group text-left rounded-md border border-border p-2.5 hover:border-accent-500 transition-colors"
                title={`${it.detail}（点击处理）`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-caption text-muted">
                    <Icon size={13} /> {it.label}
                  </span>
                  <span className={`flex items-center gap-1 text-caption ${tone.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} /> {tone.label}
                  </span>
                </div>
                <div className={`mt-1 text-lg font-semibold font-mono ${it.level === 'ok' ? 'text-ink' : tone.text}`}>{it.value}</div>
                <div className="mt-0.5 flex items-center text-caption text-muted">
                  <span className="truncate">{it.detail}</span>
                  <ChevronRight size={12} className="ml-auto flex-shrink-0 opacity-0 group-hover:opacity-100" />
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
