import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Users,
  FileText,
  DollarSign,
  Plus,
  FileUp,
  MessageSquare,
  Zap,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  ClipboardList,
  FolderKanban,
  TrendingUp,
  Sparkles,
  AlertTriangle,
  Calculator,
} from 'lucide-react'
import { systemApi } from '../api/services'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import Skeleton from '../components/Skeleton'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import Timeline, { type TimelineItem } from '../components/Timeline'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'

const wan = (n: number) => `${(n / 10000).toFixed(1)}`

/** 金额紧凑显示：万 / 亿 */
const compactMoney = (n: number) => {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`
  if (n >= 1e4) return `${wan(n)} 万`
  return n.toLocaleString('zh-CN')
}

interface KpiDef {
  label: string
  value: string | number
  /** 环比，null 表示上期为 0 无法计算 */
  delta?: number | null
  /** 该指标"涨了是好事"吗 —— 决定 delta 的着色方向 */
  upIsGood?: boolean
  suffix?: string
  path: string
  icon: typeof Users
}

function KpiCard({ item, onClick }: { item: KpiDef; onClick: () => void }) {
  const Icon = item.icon
  const hasDelta = item.delta !== undefined && item.delta !== null
  const up = (item.delta ?? 0) >= 0
  const good = item.upIsGood === false ? !up : up

  return (
    <button
      onClick={onClick}
      className="eo-card p-4 text-left hover:shadow-pop transition-all group w-full"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="eo-label">{item.label}</span>
        <Icon size={15} className="text-muted group-hover:text-accent-500 transition-colors" />
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="font-serif text-[28px] font-medium leading-none text-ink">
          {item.value}
          {item.suffix && <span className="text-body-sm text-muted ml-1 font-sans">{item.suffix}</span>}
        </span>
        <ArrowRight
          size={14}
          className="text-muted opacity-0 group-hover:opacity-100 transition-opacity mb-1"
        />
      </div>
      {hasDelta && (
        <div
          className={`mt-2 inline-flex items-center gap-0.5 text-caption ${
            good ? 'text-success-fg' : 'text-danger-fg'
          }`}
        >
          {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
          <span className="eo-num">{Math.abs(item.delta!)}%</span>
          <span className="text-muted ml-0.5">较上月</span>
        </div>
      )}
      {item.delta === null && <div className="mt-2 text-caption text-muted">上月无数据</div>}
    </button>
  )
}

/**
 * 转化漏斗。
 *
 * 条宽按各环节的绝对数量除以最大值 —— 不用"相对首环节的通过率"当宽度，
 * 因为方案/报价可以脱离需求单独建单，导致后段数量大于前段（通过率 >100%），
 * 用通过率画宽度会溢出容器。通过率仍以文字给出，超过 100% 时提示数据来源不完整。
 */
function Funnel({ data }: { data: Array<{ stage: string; value: number; rate: number }> }) {
  if (!data.length || data.every((s) => s.value === 0)) {
    return (
      <EmptyState
        bare
        title="暂无转化数据"
        description="录入需求并推进到方案、报价后，这里会显示各环节转化率"
      />
    )
  }

  const max = Math.max(...data.map((s) => s.value), 1)
  const hasOverflow = data.some((s, i) => i > 0 && s.rate > 100)

  return (
    <div>
      <div className="space-y-2.5">
        {data.map((s, i) => (
          <div key={s.stage}>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-body-sm text-ink-soft">{s.stage}</span>
              <span className="flex items-baseline gap-2">
                <span className="eo-num text-body-sm text-ink font-medium">{s.value}</span>
                {i > 0 && (
                  <span className={`eo-num text-caption ${s.rate > 100 ? 'text-warning-fg' : 'text-muted'}`}>
                    {s.rate}%
                  </span>
                )}
              </span>
            </div>
            <div className="h-5 bg-canvas rounded-r-[4px] overflow-hidden">
              <div
                className="h-full rounded-r-[4px] transition-all"
                style={{
                  width: `${Math.max((s.value / max) * 100, s.value > 0 ? 2 : 0)}%`,
                  // 单一序列 → 用同一色相的深浅表达推进，而不是 5 种分类色
                  background: `color-mix(in oklab, var(--viz-1) ${100 - i * 15}%, white)`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      {hasOverflow && (
        <p className="mt-3 flex items-start gap-1.5 text-caption text-warning-fg">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          后段数量大于前段，说明存在未关联需求的方案或报价，转化率仅供参考
        </p>
      )}
    </div>
  )
}

/** 近 6 个月报价额趋势。柱状，柱顶直接标值（仅最高与最新） */
function TrendChart({
  data,
}: {
  data: Array<{ month: string; amount: number; count: number; won: number }>
}) {
  if (!data.length || data.every((d) => d.amount === 0)) {
    return <EmptyState bare title="暂无报价数据" description="提交报价后，这里会显示近 6 个月的金额趋势" />
  }

  const max = Math.max(...data.map((d) => d.amount), 1)
  const maxIdx = data.findIndex((d) => d.amount === max)

  return (
    <div>
      <div className="flex items-end gap-2 h-[150px]">
        {data.map((d, i) => {
          const pct = (d.amount / max) * 100
          const labeled = i === maxIdx || i === data.length - 1
          return (
            <div key={d.month} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
              {labeled && d.amount > 0 && (
                <span className="eo-num text-caption text-ink-soft mb-1 whitespace-nowrap">
                  {compactMoney(d.amount)}
                </span>
              )}
              <div
                title={`${d.month}：${compactMoney(d.amount)}元 · ${d.count} 单`}
                className="w-full rounded-t-[4px] transition-all hover:opacity-80"
                style={{
                  height: `${Math.max(pct, 1.5)}%`,
                  maxWidth: 24,
                  background: 'var(--viz-1)',
                }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex gap-2 mt-1.5">
        {data.map((d) => (
          <div key={d.month} className="flex-1 text-center min-w-0">
            <span className="eo-num text-caption text-muted">{d.month.slice(5)}月</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()

  const statsQuery = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => systemApi.dashboardStats(),
  })

  const todosQuery = useQuery({
    queryKey: ['dashboard-todos'],
    queryFn: () => systemApi.todos(),
  })

  const activitiesQuery = useQuery({
    queryKey: ['recent-activities'],
    queryFn: () => systemApi.recentActivities(),
  })

  const stats = statsQuery.data
  const kpi = stats?.kpi

  const cards: KpiDef[] = [
    { label: '本月新增需求', value: kpi?.monthRequirements ?? 0, delta: kpi?.monthRequirementsDelta, upIsGood: true, path: '/requirements', icon: ClipboardList },
    { label: '待完善需求', value: kpi?.needsAttention ?? 0, upIsGood: false, path: '/requirements', icon: AlertTriangle },
    { label: '进行中项目', value: kpi?.activeProjects ?? 0, path: '/projects', icon: FolderKanban },
    { label: '客户总数', value: stats?.customers ?? 0, path: '/customers', icon: Users },
    { label: '本月报价额', value: compactMoney(kpi?.monthQuoteAmount ?? 0), suffix: '元', delta: kpi?.monthQuoteAmountDelta, upIsGood: true, path: '/quotations', icon: DollarSign },
    { label: '本月成交额', value: compactMoney(kpi?.monthWonAmount ?? 0), suffix: '元', delta: kpi?.monthWonAmountDelta, upIsGood: true, path: '/projects', icon: TrendingUp },
  ]

  useRegisterPageAssistant({
    key: 'dashboard',
    label: '业务概览',
    sourceTypes: ['requirement', 'quotation', 'project', 'customer', 'contract'],
    questions: [
      '今天最该处理的三件事是什么？',
      '本月的报价额和成交额说明了什么？',
      '待办里哪些已经拖太久了？',
      '哪些需求还缺参数、卡在推进不下去？',
      '最近的业务动态有什么值得注意的？',
    ],
    context: (() => {
      const todos: any[] = (todosQuery.data as any) || []
      const acts: any[] = (activitiesQuery.data as any) || []
      return [
        '页面：业务概览（首页看板）',
        '关键指标：' +
          cards.map((c) => `${c.label} ${c.value}${c.suffix || ''}`).join('；'),
        todos.length ? `待办事项（${todos.length} 项）：` : '',
        ...todos
          .slice(0, 15)
          .map((t: any, i: number) => `  ${i + 1}. ${t.title || t.label || ''}${t.count ? `（${t.count}）` : ''}`),
        acts.length ? '最近动态：' : '',
        ...acts
          .slice(0, 12)
          .map(
            (a: any, i: number) =>
              `  ${i + 1}. ${a.time || a.createdAt ? new Date(a.time || a.createdAt).toLocaleDateString('zh-CN') : ''} ${a.title || a.action || ''}${a.detail ? ` — ${a.detail}` : ''}`,
          ),
      ]
        .filter(Boolean)
        .join('\n')
    })(),
  })

  const quickEntries = [
    { label: '新建需求', path: '/requirements', icon: Plus },
    { label: '新建方案', path: '/proposals', icon: FileText },
    { label: '新建报价', path: '/quotations', icon: DollarSign },
    { label: '上传资料', path: '/documents', icon: FileUp },
    { label: '计算工具', path: '/calc-tools', icon: Calculator },
    { label: '知识问答', path: '/ai-assistant', icon: MessageSquare },
  ]

  const todos = todosQuery.data
  const todoGroups = [
    {
      key: 'unparsed',
      label: '待结构化解析',
      icon: Sparkles,
      tone: 'info' as const,
      items: todos?.unparsedRequirements || [],
      onClick: (item: any) => navigate(`/requirements/${item.id}`),
    },
    {
      key: 'incomplete',
      label: '缺关键参数',
      icon: AlertTriangle,
      tone: 'danger' as const,
      items: todos?.incompleteRequirements || [],
      onClick: (item: any) => navigate(`/requirements/${item.id}`),
    },
  ].filter((g) => g.items.length > 0)

  const timelineItems: TimelineItem[] = (activitiesQuery.data || []).map(
    (act: any, idx: number): TimelineItem => ({
      id: `${idx}`,
      title: act.title,
      time: act.time ? new Date(act.time).toLocaleString('zh-CN') : undefined,
      tone:
        act.type === 'quotation'
          ? 'warning'
          : act.type === 'proposal'
            ? 'info'
            : act.type === 'customer'
              ? 'accent'
              : 'neutral',
    }),
  )

  return (
    <div>
      <PageHeader title="工作" titleEm="台" />

      {statsQuery.isError && (
        <ErrorState message={(statsQuery.error as any)?.message || '加载统计失败'} onRetry={statsQuery.refetch} />
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 mb-2">
        {statsQuery.isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="eo-card p-4">
                <Skeleton className="h-3 w-16 mb-3" />
                <Skeleton className="h-7 w-20" />
              </div>
            ))
          : cards.map((item) => (
              <KpiCard key={item.label} item={item} onClick={() => navigate(item.path)} />
            ))}
      </div>

      {/* 图表区 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 mb-2">
        <div className="eo-card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-semibold text-ink">业务转化漏斗</h2>
            <span className="text-caption text-muted">
              整体成单率 <span className="eo-num text-ink-soft">{kpi?.winRate ?? 0}%</span>
            </span>
          </div>
          {statsQuery.isLoading ? <PageLoader /> : <Funnel data={stats?.funnel || []} />}
        </div>

        <div className="eo-card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-semibold text-ink">近 6 个月报价额</h2>
            <span className="text-caption text-muted">单位：元</span>
          </div>
          {statsQuery.isLoading ? <PageLoader /> : <TrendChart data={stats?.trend || []} />}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        {/* 待办 */}
        <div className="eo-card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-ink mb-4">待办事项</h2>
          {todosQuery.isLoading ? (
            <PageLoader />
          ) : todoGroups.length === 0 ? (
            <EmptyState bare title="没有待办事项" description="所有需求都已完成结构化，关键参数也已补齐" />
          ) : (
            <div className="space-y-4">
              {todoGroups.map((group) => {
                const Icon = group.icon
                return (
                  <div key={group.key}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Icon
                        size={13}
                        className={
                          group.tone === 'danger'
                            ? 'text-danger-fg'
                            : 'text-info-fg'
                        }
                      />
                      <span className="eo-label">{group.label}</span>
                      <span className="eo-num text-caption text-muted">{group.items.length}</span>
                    </div>
                    <div className="space-y-1">
                      {group.items.slice(0, 4).map((item: any) => (
                        <button
                          key={item.id}
                          onClick={() => group.onClick(item)}
                          className="w-full flex items-center gap-3 px-3 py-1.5 rounded-md bg-subtle
                            hover:bg-canvas transition-colors text-left"
                        >
                          {item.code && (
                            <span className="eo-num text-caption text-muted flex-shrink-0">{item.code}</span>
                          )}
                          <span className="text-body-sm text-ink truncate flex-1">{item.title}</span>
                          {item.amount != null && (
                            <span className="eo-num text-label text-ink-soft flex-shrink-0">
                              ¥{compactMoney(item.amount)}
                            </span>
                          )}
                          <ArrowRight size={12} className="text-muted flex-shrink-0" />
                        </button>
                      ))}
                      {group.items.length > 4 && (
                        <button
                          onClick={() => group.onClick(group.items[0])}
                          className="text-caption text-muted hover:text-accent-600 px-3"
                        >
                          还有 {group.items.length - 4} 项 →
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 快捷入口 + 动态 */}
        <div className="space-y-4">
          <div className="eo-card p-5">
            <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
              <Zap size={14} className="text-accent-500" /> 快捷入口
            </h2>
            <div className="flex flex-wrap gap-2">
              {quickEntries.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.label}
                    onClick={() => navigate(item.path)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-canvas text-ink-soft
                      rounded-md text-label font-medium hover:bg-accent-50 hover:text-accent-700 transition-colors"
                  >
                    <Icon size={13} />
                    {item.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="eo-card p-5">
            <h2 className="text-sm font-semibold text-ink mb-3">最近动态</h2>
            {activitiesQuery.isLoading ? (
              <PageLoader />
            ) : (
              <Timeline items={timelineItems.slice(0, 8)} empty="暂无动态" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

