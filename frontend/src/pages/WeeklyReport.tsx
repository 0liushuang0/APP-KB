import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarRange, Eye, RefreshCw } from 'lucide-react'
import { reportApi } from '../api/services'
import { useAuthStore } from '../store/authStore'
import PageHeader from '../components/PageHeader'
import Button from '../components/Button'
import PageLoader from '../components/PageLoader'
import EmptyState from '../components/EmptyState'

const money = (n: number) => (Math.abs(n) >= 10000 ? `¥${(n / 10000).toFixed(1)}万` : `¥${Math.round(n || 0).toLocaleString('zh-CN')}`)

const TODO_LABEL: Record<string, string> = {
  followupsOverdue: '跟进超期',
  followups: '7 天内要跟进',
  paymentsDue: '回款到期/逾期',
  quotesStale: '报价超 14 天未签约',
  approvals: '待审批',
  specsToConfirm: '识别结果待确认',
  projectsRisk: '项目需关注',
  deliveriesSoon: '7 天内交货',
  warranties: '30 天内质保到期',
}
// 与工作台「我的今天」同一组直达链接
const TODO_LINK: Record<string, string> = {
  followupsOverdue: '/requirements?focus=followup-overdue',
  followups: '/requirements?focus=followup',
  specsToConfirm: '/requirements?focus=review',
  paymentsDue: '/contracts?focus=payment',
  quotesStale: '/quotations?focus=stale',
  approvals: '/approvals',
  projectsRisk: '/projects?focus=risk',
  deliveriesSoon: '/contracts?focus=delivery',
  warranties: '/contracts?focus=warranty',
}

/**
 * 周报：每周一 8:30 自动生成（个人一份；管理者另有全公司一份），站内通知直达这里。
 * 「预览本周」随时看本周至今的同一份口径（不保存、不推送）。
 */
export default function WeeklyReport() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const id = sp.get('id') || ''
  const isAdmin = useAuthStore((s) => s.appMode !== 'team' || s.hasAnyRole(['admin']))
  const [preview, setPreview] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  const listQuery = useQuery({ queryKey: ['weekly-reports'], queryFn: () => reportApi.listWeekly() })
  const list = listQuery.data || []
  const reportQuery = useQuery({
    queryKey: ['weekly-report', id],
    queryFn: () => reportApi.getWeekly(id),
    enabled: !!id,
  })

  useEffect(() => {
    if (!id && list.length && !preview) setSp({ id: list[0].id }, { replace: true })
  }, [id, list, preview, setSp])

  const openPreview = async (scope: 'personal' | 'company') => {
    setBusy(true)
    try {
      setPreview(await reportApi.previewWeekly(scope))
      setSp({}, { replace: true })
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '预览失败')
    } finally {
      setBusy(false)
    }
  }

  const regenerate = async () => {
    setBusy(true)
    try {
      const r = await reportApi.generateWeekly(false)
      toast.success(`已生成 ${r.weekKey} 周报（${r.sent} 份个人 + 全公司）`)
      queryClient.invalidateQueries({ queryKey: ['weekly-reports'] })
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '生成失败')
    } finally {
      setBusy(false)
    }
  }

  const shown = preview || (reportQuery.data ? { title: reportQuery.data.title, content: reportQuery.data.content } : null)
  const c = shown?.content

  return (
    <div>
      <PageHeader title="周" titleEm="报" />
      <div className="flex flex-col lg:flex-row gap-4">
        <aside className="lg:w-64 shrink-0 space-y-2">
          <div className="eo-card p-3 space-y-2">
            <Button variant="secondary" size="sm" className="w-full" onClick={() => openPreview('personal')} loading={busy}>
              <Eye size={14} className="mr-1" /> 预览本周（我的）
            </Button>
            {isAdmin && (
              <>
                <Button variant="secondary" size="sm" className="w-full" onClick={() => openPreview('company')} loading={busy}>
                  <Eye size={14} className="mr-1" /> 预览本周（全公司）
                </Button>
                <Button variant="secondary" size="sm" className="w-full" onClick={regenerate} loading={busy} title="重新生成上一周的周报（不推送通知）">
                  <RefreshCw size={14} className="mr-1" /> 重算上周周报
                </Button>
              </>
            )}
            <p className="text-caption text-muted">每周一 8:30 自动生成并推送到通知；上周没有任何动静、也没有待办的人不发。</p>
          </div>
          <div className="eo-card overflow-hidden">
            {listQuery.isLoading ? (
              <div className="p-3 text-caption text-muted">加载中…</div>
            ) : !list.length ? (
              <div className="p-3 text-caption text-muted">还没有周报。第一份将在下周一 8:30 自动生成</div>
            ) : (
              list.map((r: any) => (
                <button
                  key={r.id}
                  onClick={() => {
                    setPreview(null)
                    setSp({ id: r.id })
                  }}
                  className={`w-full text-left px-3 py-2 border-b border-border last:border-b-0 text-sm ${
                    r.id === id && !preview ? 'bg-accent-50 text-accent-700' : 'hover:bg-subtle text-ink-soft'
                  }`}
                >
                  <div className="truncate">{r.title}</div>
                  <div className="text-caption text-muted">{r.scope === 'company' ? '全公司' : '个人'} · {new Date(r.createdAt).toLocaleDateString('zh-CN')}</div>
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          {reportQuery.isLoading && !preview ? (
            <PageLoader />
          ) : !c ? (
            <EmptyState icon={CalendarRange} title="选一份周报" description="左侧是历史周报；也可以先预览本周至今" />
          ) : (
            <div className="space-y-4">
              <div className="eo-card p-5">
                <h2 className="text-base font-semibold text-ink">{shown.title}</h2>
                {c.preview && <p className="text-caption text-warning-fg mt-1">预览：本周至今的数据，未保存、未推送</p>}
                <ul className="mt-3 space-y-1.5">
                  {(c.highlights || []).map((h: string, i: number) => (
                    <li key={i} className="text-sm text-ink-soft">· {h}</li>
                  ))}
                </ul>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
                {[
                  { label: '新增需求', v: c.activity.requirements.count },
                  { label: '报价', v: c.activity.quotations.count, sub: c.activity.quotations.amountCny ? money(c.activity.quotations.amountCny) : '' },
                  { label: '签约', v: c.activity.contracts.count, sub: c.activity.contracts.amountCny ? money(c.activity.contracts.amountCny) : '' },
                  { label: '回款', v: c.activity.payments.count, sub: c.activity.payments.amountCny ? money(c.activity.payments.amountCny) : '' },
                  { label: '沟通 / 完成任务', v: `${c.activity.followUps} / ${c.activity.tasksDone}` },
                ].map((x) => (
                  <div key={x.label} className="eo-card p-3">
                    <div className="text-caption text-muted">{x.label}</div>
                    <div className="text-xl font-bold tabular-nums text-ink mt-1">{x.v}</div>
                    {x.sub && <div className="text-caption text-muted">{x.sub}</div>}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="eo-card p-4">
                  <h3 className="text-sm font-semibold text-ink mb-2">本周要处理</h3>
                  <div className="grid grid-cols-2 gap-1.5">
                    {Object.entries(c.todos || {})
                      .filter(([k]) => TODO_LABEL[k])
                      .map(([k, n]: any) => (
                        <button
                          key={k}
                          disabled={!TODO_LINK[k] || !n}
                          onClick={() => TODO_LINK[k] && navigate(TODO_LINK[k])}
                          className={`flex justify-between rounded-md px-2.5 py-1.5 text-sm ${n ? 'bg-subtle text-ink hover:text-accent-600' : 'text-muted'}`}
                        >
                          <span>{TODO_LABEL[k]}</span>
                          <b className="tabular-nums">{n}</b>
                        </button>
                      ))}
                  </div>
                </div>
                <div className="eo-card p-4">
                  <h3 className="text-sm font-semibold text-ink mb-2">业务结果（近 180 天）</h3>
                  <div className="text-sm text-ink-soft space-y-1">
                    <div>报价响应中位数：<b>{c.metrics.quoteResponse.median ?? '—'}</b> 天（样本 {c.metrics.quoteResponse.n}，真实日期 {c.metrics.quoteResponse.nReal}）</div>
                    <div>需求→签约中位数：<b>{c.metrics.reqToSign.median ?? '—'}</b> 天（样本 {c.metrics.reqToSign.n}，真实日期 {c.metrics.reqToSign.nReal}）</div>
                    <div>赢单率：<b>{c.metrics.winRate.rate != null ? `${c.metrics.winRate.rate}%` : '—'}</b>（签约 {c.metrics.winRate.won} / 丢单 {c.metrics.winRate.lost}）</div>
                    <div>回款及时率：<b>{c.metrics.paymentOnTime.rate != null ? `${c.metrics.paymentOnTime.rate}%` : '—'}</b>（到期 {c.metrics.paymentOnTime.due} 笔）</div>
                    {c.metrics.lossReasons?.length > 0 && (
                      <div>丢单原因：{c.metrics.lossReasons.slice(0, 4).map((r: any) => `${r.reason} ${r.count}`).join('、')}</div>
                    )}
                  </div>
                </div>
              </div>

              {[
                { title: '新增需求', items: c.activity.requirements.items, link: (x: any) => `/requirements/${x.id}` },
                { title: '报价', items: c.activity.quotations.items, link: (x: any) => `/quotations?highlight=${x.id}` },
                { title: '签约', items: c.activity.contracts.items, link: (x: any) => `/contracts?highlight=${x.id}` },
              ]
                .filter((s) => s.items?.length)
                .map((s) => (
                  <div key={s.title} className="eo-card p-4">
                    <h3 className="text-sm font-semibold text-ink mb-2">{s.title}</h3>
                    <div className="space-y-1">
                      {s.items.map((x: any) => (
                        <button key={x.id} onClick={() => navigate(s.link(x))} className="w-full flex gap-3 text-sm text-left hover:text-accent-600">
                          <span className="font-mono text-caption text-muted w-32 shrink-0">{x.no}</span>
                          <span className="flex-1 truncate text-ink">{x.title || x.customer || ''}</span>
                          <span className="text-muted">{x.customer && x.title ? x.customer : ''}</span>
                          {x.amountCny ? <span className="tabular-nums">{money(x.amountCny)}</span> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

              {c.byOwner?.length > 0 && (
                <div className="eo-card p-4">
                  <h3 className="text-sm font-semibold text-ink mb-2">按负责人</h3>
                  <table className="w-full text-sm">
                    <thead className="text-caption text-muted">
                      <tr>
                        <th className="text-left py-1 font-medium">负责人</th>
                        <th className="text-right py-1 font-medium">需求</th>
                        <th className="text-right py-1 font-medium">报价</th>
                        <th className="text-right py-1 font-medium">报价额</th>
                        <th className="text-right py-1 font-medium">签约</th>
                        <th className="text-right py-1 font-medium">签约额</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.byOwner.map((o: any) => (
                        <tr key={o.name} className="border-t border-border">
                          <td className="py-1">{o.name}</td>
                          <td className="py-1 text-right tabular-nums">{o.requirements}</td>
                          <td className="py-1 text-right tabular-nums">{o.quotations}</td>
                          <td className="py-1 text-right tabular-nums">{money(o.quoteAmountCny)}</td>
                          <td className="py-1 text-right tabular-nums">{o.contracts}</td>
                          <td className="py-1 text-right tabular-nums">{money(o.dealAmountCny)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {c.automation?.length > 0 && (
                <div className="eo-card p-4">
                  <h3 className="text-sm font-semibold text-ink mb-2">系统自动完成</h3>
                  <div className="flex flex-wrap gap-2">
                    {c.automation.map((a: any) => (
                      <span key={a.kind} className="text-caption px-2 py-1 rounded bg-subtle text-ink-soft">
                        {a.label} <b>{a.count}</b>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
