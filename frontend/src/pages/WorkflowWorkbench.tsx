import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ClipboardList, FileText, DollarSign, AlertTriangle, TrendingUp, Percent,
  ScrollText, FolderKanban, Headset, Stamp, CalendarClock, Sparkles, Truck,
  ShieldCheck, Hourglass, Bot, CheckCircle2, ChevronRight,
} from 'lucide-react'
import { systemApi } from '../api/services'
import { usePageActions } from '../contexts/PageActionsContext'
import PageLoader from '../components/PageLoader'
import EmptyState from '../components/EmptyState'
import StatCards, { compactMoney } from '../components/StatCards'
import Timeline, { type TimelineItem } from '../components/Timeline'
import SystemHealthPanel from '../components/SystemHealthPanel'
import MonthlyBars from '../components/charts/MonthlyBars'

/**
 * 业务概览（首页）。
 *
 * 2026-10-16 改版，按"先让人信、再让人省事"排：
 *  1. 我的今天 —— 需要人推动的事（每类直达筛选好的列表）+ 本周系统替你做了什么（只列可数的事实）
 *  2. 统一口径的 KPI —— 成交一律指签约合同，与流水线、漏斗、各列表页同一个数
 *  3. 系统健康、业务流水线（后端一次算好，不再在浏览器里拉 6 张表汇总）
 *  4. 漏斗（按需求实际走到哪一步，直签单列）、近 6 月报价 vs 签约、最近动态
 */
const STAGES = [
  { key: 'requirement', label: '需求识别', icon: ClipboardList, colorClass: 'text-info-fg', bgClass: 'bg-info-bg', stripe: 'var(--color-info-fg)', path: '/requirements' },
  { key: 'proposal', label: '方案生成', icon: FileText, colorClass: 'text-accent-600', bgClass: 'bg-accent-50', stripe: 'var(--color-accent-600)', path: '/proposals' },
  { key: 'quotation', label: '报价提交', icon: DollarSign, colorClass: 'text-warning-fg', bgClass: 'bg-warning-bg', stripe: 'var(--viz-5)', path: '/quotations' },
  { key: 'contract', label: '合同成交', icon: ScrollText, colorClass: 'text-success-fg', bgClass: 'bg-success-bg', stripe: 'var(--color-success-fg)', path: '/contracts' },
  { key: 'project', label: '项目跟踪', icon: FolderKanban, colorClass: 'text-info-fg', bgClass: 'bg-info-bg', stripe: 'var(--viz-2)', path: '/projects' },
  { key: 'afterSales', label: '售后服务', icon: Headset, colorClass: 'text-warning-fg', bgClass: 'bg-warning-bg', stripe: 'var(--viz-3)', path: '/after-sales' },
] as const

type Tone = 'neutral' | 'info' | 'accent' | 'success' | 'warning' | 'danger'
const TONE_VARS: Record<Tone, string> = {
  neutral: 'var(--color-neutral-fg)',
  info: 'var(--color-info-fg)',
  accent: 'var(--color-accent-600)',
  success: 'var(--color-success-fg)',
  warning: 'var(--color-warning-fg)',
  danger: 'var(--color-danger-fg)',
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: '待审核', tone: 'warning' },
  draft: { label: '草稿', tone: 'neutral' },
  analyzing: { label: '识别中', tone: 'info' },
  analyzed: { label: '已识别', tone: 'info' },
  approved: { label: '已审核', tone: 'success' },
  quoted: { label: '已报价', tone: 'warning' },
  won: { label: '已成交', tone: 'success' },
  lost: { label: '已失单', tone: 'danger' },
  rejected: { label: '已驳回', tone: 'danger' },
  sent: { label: '已发送', tone: 'info' },
  signed: { label: '已签订', tone: 'info' },
  executing: { label: '执行中', tone: 'accent' },
  completed: { label: '已完成', tone: 'success' },
  terminated: { label: '已终止', tone: 'danger' },
  planning: { label: '规划中', tone: 'neutral' },
  ongoing: { label: '进行中', tone: 'info' },
  active: { label: '进行中', tone: 'info' },
  paused: { label: '已暂停', tone: 'warning' },
  open: { label: '待处理', tone: 'danger' },
  assigned: { label: '已派单', tone: 'warning' },
  in_progress: { label: '处理中', tone: 'info' },
  resolved: { label: '已解决', tone: 'success' },
  closed: { label: '已关闭', tone: 'neutral' },
}
const HEALTH: Record<string, { label: string; tone: Tone }> = {
  red: { label: '预警', tone: 'danger' },
  yellow: { label: '关注', tone: 'warning' },
  green: { label: '正常', tone: 'success' },
}

/** 我的今天：每类待办的文案、图标、去处（带筛选参数，点过去就是那几条） */
const TODO_DEFS: Array<{ key: string; label: string; icon: any; tone: Tone; to: string; hint: string }> = [
  { key: 'approvals', label: '待审批', icon: Stamp, tone: 'warning', to: '/approvals', hint: '新录入的客户、资料、单据等你审核' },
  { key: 'followupsOverdue', label: '跟进超期', icon: AlertTriangle, tone: 'danger', to: '/requirements?focus=followup-overdue', hint: '约好的跟进日期已过' },
  { key: 'followups', label: '7 天内跟进', icon: CalendarClock, tone: 'info', to: '/requirements?focus=followup', hint: '这周要联系的客户需求' },
  { key: 'specsToConfirm', label: '参数待确认', icon: Sparkles, tone: 'accent', to: '/requirements?focus=review', hint: 'AI 已从资料里识别出参数，等你核对' },
  { key: 'quotesStale', label: '报价超 14 天未签约', icon: Hourglass, tone: 'warning', to: '/quotations?focus=stale', hint: '该催一催客户了' },
  { key: 'deliveriesSoon', label: '7 天内交货', icon: Truck, tone: 'warning', to: '/contracts?focus=delivery', hint: '合同约定的交货期临近' },
  { key: 'projectsRisk', label: '项目预警/关注', icon: FolderKanban, tone: 'danger', to: '/projects?focus=risk', hint: '逾期或临近完工、进度不足' },
  { key: 'warranties', label: '质保 30 天内到期', icon: ShieldCheck, tone: 'info', to: '/contracts?focus=warranty', hint: '到期前主动回访' },
]

export default function WorkflowWorkbench() {
  const navigate = useNavigate()
  const setPageActions = usePageActions()
  useEffect(() => { setPageActions(null); return () => setPageActions(null) }, [])

  const statsQuery = useQuery({ queryKey: ['dashboard-stats'], queryFn: () => systemApi.dashboardStats(), refetchInterval: 60_000 })
  const activitiesQuery = useQuery({ queryKey: ['recent-activities'], queryFn: () => systemApi.recentActivities() })

  if (statsQuery.isLoading) return <PageLoader />
  const stats: any = statsQuery.data || {}
  const kpi = stats.kpi || {}
  const todos = stats.todos || {}
  const automation: Array<{ kind: string; label: string; count: number }> = stats.automation || []
  const pipeline = stats.pipeline || {}
  const funnel: Array<{ stage: string; value: number; amount: number; rate: number }> = stats.funnel || []
  const direct = stats.directDeals || { count: 0, amount: 0 }

  const todoItems = TODO_DEFS.map((d) => ({ ...d, n: Number(todos[d.key] || 0) }))
  const todoTotal = todoItems.reduce((s, i) => s + i.n, 0)
  const hour = new Date().getHours()
  const greet = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  const kpiCards = [
    { label: '本月需求', value: kpi.monthRequirements ?? 0, delta: kpi.monthRequirementsDelta, upIsGood: true, icon: ClipboardList, onClick: () => navigate('/requirements') },
    { label: '待完善需求', value: kpi.needsAttention ?? 0, upIsGood: false, icon: AlertTriangle, title: '未识别参数，或识别后仍缺关键参数', onClick: () => navigate('/requirements?focus=incomplete') },
    { label: '进行中项目', value: kpi.activeProjects ?? 0, icon: FolderKanban, onClick: () => navigate('/projects') },
    { label: '本月报价额', value: compactMoney(kpi.monthQuoteAmount ?? 0), suffix: '元', delta: kpi.monthQuoteAmountDelta, upIsGood: true, icon: DollarSign, onClick: () => navigate('/quotations') },
    { label: '本月签约额', value: compactMoney(kpi.monthWonAmount ?? 0), suffix: '元', delta: kpi.monthWonAmountDelta, upIsGood: true, icon: TrendingUp, title: `本月签约 ${kpi.monthDeals ?? 0} 份合同（按签约日）`, onClick: () => navigate('/contracts') },
    { label: '报价成单率', value: `${kpi.winRate ?? 0}`, suffix: '%', icon: Percent, title: '已签约的报价 ÷ 全部报价' },
  ]

  const timelineItems: TimelineItem[] = (activitiesQuery.data || []).map((act: any, idx: number): TimelineItem => ({
    id: `${idx}`, title: act.title,
    time: act.time ? new Date(act.time).toLocaleString('zh-CN') : undefined,
    tone: act.type === 'quotation' ? 'warning' : act.type === 'proposal' ? 'info' : act.type === 'customer' ? 'accent' : 'neutral',
  }))

  const maxCount = Math.max(...STAGES.map((s) => pipeline[s.key]?.count || 0), 1)
  const totalPipeline = STAGES.reduce((s, st) => s + (pipeline[st.key]?.count || 0), 0)

  const renderCard = (item: any, stage: (typeof STAGES)[number]) => {
    const st = stage.key === 'project' && item.health ? HEALTH[item.health] : STATUS[item.status]
    const date = item.date ? new Date(item.date).toLocaleDateString('zh-CN') : ''
    const overdue = stage.key === 'project' && item.date && new Date(item.date).getTime() < Date.now() && Number(item.progress || 0) < 100
    return (
      <button
        key={item.id}
        type="button"
        title={`${item.no ? `${item.no} · ` : ''}${item.title || ''}`}
        className="relative w-full text-left bg-surface rounded-lg border border-border p-2 pl-3 overflow-hidden hover:shadow-md hover:border-accent-300 transition-all"
        onClick={() => navigate(item.link || stage.path)}
      >
        <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: stage.stripe }} />
        <div className="flex items-start justify-between gap-1.5">
          <p className="text-xs font-medium text-ink truncate flex-1 min-w-0">{item.title || item.no || '—'}</p>
          {st && (
            <span className="flex items-center gap-1 shrink-0 text-caption leading-4" style={{ color: TONE_VARS[st.tone] }}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'currentColor' }} />
              {st.label}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <span className="text-caption text-muted truncate">{item.customerName || '—'}</span>
          {date && (
            <span className={`text-caption shrink-0 tabular-nums ${overdue ? 'text-danger-fg' : 'text-muted'}`}>
              {stage.key === 'project' ? `完工 ${date}` : date}
            </span>
          )}
        </div>
        {(item.priority === 'urgent' || item.priority === 'high') && (
          <div className="mt-0.5 text-caption leading-4" style={{ color: TONE_VARS[item.priority === 'urgent' ? 'danger' : 'warning'] }}>
            ▲ {item.priority === 'urgent' ? '紧急' : '高'}优先级
          </div>
        )}
        {item.amount > 0 && <div className="mt-0.5 text-caption text-ink-soft tabular-nums">{compactMoney(item.amount)}元</div>}
        {stage.key === 'project' && item.progress != null && (
          <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-divider)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(Number(item.progress) || 0, 100)}%`, background: stage.stripe }} />
          </div>
        )}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── 我的今天 ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="eo-card p-4 xl:col-span-2">
          <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
            <h2 className="text-base font-semibold text-ink">
              {greet}，{todoTotal > 0 ? <>今天有 <span className="text-accent-600 tabular-nums">{todoTotal}</span> 件事等你推动</> : '今天没有待推动的事项'}
            </h2>
            <span className="text-caption text-muted">{today}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {todoItems.map((t) => {
              const Icon = t.icon
              const on = t.n > 0
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => navigate(t.to)}
                  title={t.hint}
                  className={`group text-left rounded-lg border p-2.5 transition-all ${
                    on ? 'border-border hover:border-accent-400 hover:shadow-sm bg-surface' : 'border-dashed border-border bg-canvas opacity-60 hover:opacity-100'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <Icon size={15} style={{ color: on ? TONE_VARS[t.tone] : 'var(--color-muted)' }} />
                    <ChevronRight size={13} className="text-muted opacity-0 group-hover:opacity-100" />
                  </div>
                  <div className="mt-1 text-xl font-bold leading-none tabular-nums" style={{ color: on ? TONE_VARS[t.tone] : 'var(--color-muted)' }}>{t.n}</div>
                  <div className="mt-1 text-caption text-ink-soft truncate">{t.label}</div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="eo-card p-4">
          <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5 mb-2">
            <Bot size={15} className="text-accent-600" /> 本周系统替你做了
          </h2>
          {automation.length === 0 ? (
            <p className="text-caption text-muted leading-relaxed">
              本周还没有自动处理的事项。上传客户资料、把资料挂到需求上，系统会自动解析、归属客户、识别技术参数。
            </p>
          ) : (
            <ul className="space-y-1.5">
              {automation.slice(0, 6).map((a) => (
                <li key={a.kind} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 size={14} className="text-success-fg mt-0.5 shrink-0" />
                  <span className="text-ink-soft">
                    <b className="text-ink tabular-nums">{a.count}</b> {a.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-caption text-muted">只统计真实发生的次数，不做工时估算</p>
        </div>
      </div>

      {/* ── KPI（统一口径） ── */}
      <StatCards items={kpiCards} />

      {/* ── 系统健康 ── */}
      <SystemHealthPanel />

      {/* ── 业务流水线 ── */}
      <div className="eo-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-ink">业务流水线</h2>
          <span className="text-caption text-muted">共 {totalPipeline} 项 · 每列按"先看哪个"排序，点卡片直达</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
          {STAGES.map((s) => {
            const col = pipeline[s.key] || { count: 0, amount: 0, items: [] }
            return (
              <div key={s.key} className="flex flex-col min-w-0">
                <button
                  type="button"
                  className={`${s.bgClass} text-left rounded-lg p-2 mb-2 hover:shadow-sm transition-shadow border border-border`}
                  onClick={() => navigate(s.path)}
                >
                  <div className="flex items-center gap-1.5">
                    <s.icon size={13} className={s.colorClass} />
                    <span className="text-base font-bold text-ink leading-none">{col.count}</span>
                    <span className={`text-caption ${s.colorClass} truncate`}>{s.label}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <div className="h-1 flex-1 rounded-full overflow-hidden" style={{ background: 'var(--color-divider)' }}>
                      <div className="h-full rounded-full" style={{ width: `${(col.count / maxCount) * 100}%`, background: s.stripe }} />
                    </div>
                    {col.amount > 0 && <span className="text-caption text-ink-soft tabular-nums shrink-0">{compactMoney(col.amount)}</span>}
                  </div>
                </button>
                <div className="space-y-1.5 flex-1 min-h-[80px]">
                  {col.items.length === 0 ? (
                    <div className="text-center py-4 text-caption text-muted bg-canvas rounded-lg border border-dashed border-border">暂无</div>
                  ) : (
                    col.items.map((it: any) => renderCard(it, s))
                  )}
                </div>
                {col.count > 4 && (
                  <button onClick={() => navigate(s.path)} className="mt-1.5 text-caption text-accent-600 hover:text-accent-700 text-center w-full">
                    还有 {col.count - 4} 项 →
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 漏斗 + 报价/签约 + 动态 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="eo-card p-4">
          <h2 className="text-sm font-semibold text-ink mb-1">转化漏斗</h2>
          <p className="text-caption text-muted mb-3">按每条需求实际走到哪一步统计</p>
          {funnel.length === 0 || funnel[0].value === 0 ? (
            <EmptyState bare title="还没有商机数据" description="录入第一条客户需求后，漏斗会随业务推进自动生成"
              action={<button onClick={() => navigate('/requirements')} className="text-sm text-accent-600 hover:text-accent-700">去登记需求 →</button>} />
          ) : (
            <div className="space-y-2">
              {funnel.map((s, i) => (
                <div key={s.stage}>
                  <div className="flex items-baseline justify-between mb-0.5">
                    <span className="text-xs text-ink-soft">{s.stage}</span>
                    <span className="flex items-baseline gap-1.5">
                      {s.amount > 0 && <span className="text-caption text-muted tabular-nums">¥{compactMoney(s.amount)}</span>}
                      <span className="text-xs text-ink font-medium tabular-nums">{s.value}</span>
                      {i > 0 && <span className="text-caption text-muted tabular-nums">{s.rate}%</span>}
                    </span>
                  </div>
                  <div className="h-5 rounded overflow-hidden" style={{ background: 'var(--color-divider)' }}>
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${Math.max(s.rate, s.value > 0 ? 4 : 0)}%`,
                        background: `color-mix(in oklab, var(--viz-1) ${Math.max(100 - i * 18, 40)}%, var(--viz-2))`,
                      }}
                    />
                  </div>
                </div>
              ))}
              {direct.count > 0 && (
                <p className="text-caption text-muted pt-1">
                  另有 <b className="text-ink">{direct.count}</b> 份合同未走报价直接签订（¥{compactMoney(direct.amount)}），不计入漏斗
                </p>
              )}
            </div>
          )}
        </div>

        <div className="eo-card p-4">
          <h2 className="text-sm font-semibold text-ink mb-1">近 6 月报价与签约</h2>
          <p className="text-caption text-muted mb-2">签约按合同签约日；悬停看单月明细</p>
          <MonthlyBars data={stats.trend || []} />
        </div>

        <div className="eo-card p-4">
          <h2 className="text-sm font-semibold text-ink mb-3">最近动态</h2>
          {activitiesQuery.isLoading ? <PageLoader /> : <Timeline items={timelineItems.slice(0, 6)} empty="暂无动态" />}
        </div>
      </div>
    </div>
  )
}
