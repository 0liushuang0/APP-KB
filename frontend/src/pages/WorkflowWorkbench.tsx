import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ClipboardList, FileText, DollarSign,
  AlertTriangle, Users, TrendingUp,
  ScrollText, FolderKanban, Headset,
} from 'lucide-react'
import { projectApi, requirementApi, proposalApi, quotationApi, contractApi, afterSalesApi, systemApi } from '../api/services'
import { usePageActions } from '../contexts/PageActionsContext'
import PageLoader from '../components/PageLoader'
import EmptyState from '../components/EmptyState'
import StatCards, { compactMoney } from '../components/StatCards'
import Timeline, { type TimelineItem } from '../components/Timeline'

/**
 * 业务概览（首页）— 合并了原工作流程 + 业务概览两个页面。
 *
 * 流水线 6 列对齐完整业务闭环：
 * 需求识别 → 方案生成 → 报价提交 → 合同成交 → 项目跟踪 → 售后服务
 */
const STAGES = [
  { key: 'requirement', label: '需求识别', icon: ClipboardList, colorClass: 'text-info-fg', bgClass: 'bg-info-bg' },
  { key: 'proposal', label: '方案生成', icon: FileText, colorClass: 'text-accent-600', bgClass: 'bg-accent-50' },
  { key: 'quotation', label: '报价提交', icon: DollarSign, colorClass: 'text-warning-fg', bgClass: 'bg-warning-bg' },
  { key: 'contract', label: '合同成交', icon: ScrollText, colorClass: 'text-success-fg', bgClass: 'bg-success-bg' },
  { key: 'project', label: '项目跟踪', icon: FolderKanban, colorClass: 'text-info-fg', bgClass: 'bg-info-bg' },
  { key: 'afterSales', label: '售后服务', icon: Headset, colorClass: 'text-warning-fg', bgClass: 'bg-warning-bg' },
]

const STAGE_PATHS: Record<string, string> = {
  requirement: '/requirements',
  proposal: '/proposals',
  quotation: '/quotations',
  contract: '/contracts',
  project: '/projects',
  afterSales: '/after-sales',
}

function extractList(res: any): any[] {
  if (!res) return []
  if (Array.isArray(res)) return res
  return res.list ?? res.items ?? []
}

export default function WorkflowWorkbench() {
  const navigate = useNavigate()
  const setPageActions = usePageActions()

  useEffect(() => { setPageActions(null); return () => setPageActions(null) }, [])

  // 各模块数据
  const { data: allData, isLoading } = useQuery({
    queryKey: ['overview-all'],
    queryFn: async () => {
      const [req, prop, quo, con, prj, aft] = await Promise.all([
        requirementApi.list({ pageSize: 200 }).catch(() => ({ list: [] as any[] })),
        proposalApi.list({ pageSize: 200 }).catch(() => ({ list: [] as any[] })),
        quotationApi.list({ pageSize: 200 }).catch(() => ({ list: [] as any[] })),
        contractApi.list({ pageSize: 200 }).catch(() => ({ list: [] as any[] })),
        projectApi.list({ pageSize: 200 }).catch(() => ({ list: [] as any[] })),
        afterSalesApi.list({ pageSize: 200 }).catch(() => ({ list: [] as any[] })),
      ])
      return {
        requirements: extractList(req),
        proposals: extractList(prop),
        quotations: extractList(quo),
        contracts: extractList(con),
        projects: extractList(prj),
        tickets: extractList(aft),
      }
    },
  })

  // 统计数据
  const statsQuery = useQuery({ queryKey: ['dashboard-stats'], queryFn: () => systemApi.dashboardStats() })
  const activitiesQuery = useQuery({ queryKey: ['recent-activities'], queryFn: () => systemApi.recentActivities() })

  if (isLoading) return <PageLoader />

  // 各阶段计数 + 取前几条做卡片
  const stages: Record<string, { count: number; items: any[] }> = {
    requirement: { count: allData?.requirements?.length || 0, items: (allData?.requirements || []).slice(0, 4) },
    proposal: { count: allData?.proposals?.length || 0, items: (allData?.proposals || []).slice(0, 4) },
    quotation: { count: allData?.quotations?.length || 0, items: (allData?.quotations || []).slice(0, 4) },
    contract: { count: allData?.contracts?.length || 0, items: (allData?.contracts || []).slice(0, 4) },
    project: { count: allData?.projects?.length || 0, items: (allData?.projects || []).slice(0, 4) },
    afterSales: { count: allData?.tickets?.length || 0, items: (allData?.tickets || []).slice(0, 4) },
  }

  // KPI
  const stats = statsQuery.data
  const kpi = stats?.kpi
  const kpiCards = [
    { label: '本月需求', value: kpi?.monthRequirements ?? 0, delta: kpi?.monthRequirementsDelta, upIsGood: true, icon: ClipboardList },
    { label: '待完善', value: kpi?.needsAttention ?? 0, upIsGood: false, icon: AlertTriangle },
    { label: '进行中项目', value: kpi?.activeProjects ?? 0, icon: FolderKanban },
    { label: '客户总数', value: stats?.customers ?? 0, icon: Users },
    { label: '本月报价额', value: compactMoney(kpi?.monthQuoteAmount ?? 0), suffix: '元', delta: kpi?.monthQuoteAmountDelta, upIsGood: true, icon: DollarSign },
    { label: '本月成交额', value: compactMoney(kpi?.monthWonAmount ?? 0), suffix: '元', delta: kpi?.monthWonAmountDelta, upIsGood: true, icon: TrendingUp },
  ]

  const timelineItems: TimelineItem[] = (activitiesQuery.data || []).map((act: any, idx: number): TimelineItem => ({
    id: `${idx}`, title: act.title,
    time: act.time ? new Date(act.time).toLocaleString('zh-CN') : undefined,
    tone: act.type === 'quotation' ? 'warning' : act.type === 'proposal' ? 'info' : act.type === 'customer' ? 'accent' : 'neutral',
  }))

  // 漏斗
  const funnel = stats?.funnel || []
  const funnelMax = Math.max(...funnel.map((s: any) => s.value), 1)

  // 趋势
  const trend = stats?.trend || []
  const trendMax = Math.max(...trend.map((d: any) => d.amount), 1)
  const trendMaxIdx = trend.findIndex((d: any) => d.amount === trendMax)

  const totalPipeline = Object.values(stages).reduce((s, v) => s + v.count, 0)

  const renderItem = (item: any, stageKey: string) => {
    const title = item.title || item.name || item.contractNo || item.ticketNo || item.requirementNo || item.proposalNo || item.quotationNo || '—'
    const customer = item.customerName || item.customerShortName || ''
    const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN') : ''
    return (
      <div
        key={item.id}
        className="bg-surface rounded-lg border border-border p-2 hover:shadow-md hover:border-accent-300 transition-all cursor-pointer"
        onClick={() => navigate(STAGE_PATHS[stageKey])}
      >
        <p className="text-xs font-medium text-ink truncate">{title}</p>
        {customer && <p className="text-caption text-muted truncate mt-0.5">{customer}</p>}
        {date && <p className="text-caption text-muted mt-0.5">{date}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/*
        KPI 卡片行。样式已抽成 StatCards 供各业务列表页复用 ——
        这里也用同一个组件，才能保证"改一处、各模块一起跟着变"。
      */}
      <StatCards items={kpiCards} loading={statsQuery.isLoading} skeletonCount={6} />

      {/* 业务流水线 6 列 */}
      <div className="eo-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-ink">业务流水线</h2>
          <span className="text-caption text-muted">共 {totalPipeline} 项</span>
        </div>

        {/* 6 列网格 */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
          {STAGES.map((s) => {
            const data = stages[s.key] || { count: 0, items: [] }
            return (
              <div key={s.key} className="flex flex-col">
                {/* 阶段头 */}
                <div
                  className={`${s.bgClass} rounded-lg p-2 mb-2 cursor-pointer hover:shadow-sm transition-shadow border border-border`}
                  onClick={() => navigate(STAGE_PATHS[s.key])}
                >
                  <div className="flex items-center gap-1.5">
                    <div className={`w-6 h-6 rounded ${s.bgClass} flex items-center justify-center shrink-0`}>
                      <s.icon size={13} className={s.colorClass} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1">
                        <span className="text-base font-bold text-ink leading-none">{data.count}</span>
                        <span className={`text-caption ${s.colorClass} truncate`}>{s.label}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 卡片列表 */}
                <div className="space-y-1.5 flex-1 min-h-[80px]">
                  {data.items.length === 0 ? (
                    <div className="text-center py-4 text-caption text-muted bg-canvas rounded-lg border border-dashed border-border">暂无</div>
                  ) : (
                    data.items.map((item: any) => renderItem(item, s.key))
                  )}
                </div>

                {/* 更多 */}
                {data.count > 4 && (
                  <button
                    onClick={() => navigate(STAGE_PATHS[s.key])}
                    className="mt-1.5 text-caption text-accent-600 hover:text-accent-700 text-center w-full"
                  >
                    还有 {data.count - 4} 项 →
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 漏斗 + 趋势 + 动态 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* 转化漏斗 */}
        <div className="eo-card p-4">
          <h2 className="text-sm font-semibold text-ink mb-3">转化漏斗 <span className="text-caption text-muted ml-1">成单率 {kpi?.winRate ?? 0}%</span></h2>
          {statsQuery.isLoading ? <PageLoader /> : funnel.length === 0 ? (
            <EmptyState bare title="还没有商机数据" description="从录入第一个客户和需求开始，漏斗会随业务推进自动生成"
              action={<button onClick={() => navigate('/customers')} className="text-sm text-accent-600 hover:text-accent-700">去创建客户 →</button>} />
          ) : (
            <div className="space-y-1.5">
              {funnel.map((s: any, i: number) => (
                <div key={s.stage}>
                  <div className="flex items-baseline justify-between mb-0.5">
                    <span className="text-xs text-ink-soft">{s.stage}</span>
                    <span className="flex items-baseline gap-1">
                      {/* 需求/方案阶段展示商机预计金额，报价/成交展示实际金额 */}
                      {s.amount > 0 && (
                        <span className="text-caption text-muted">
                          ¥{Number(s.amount).toLocaleString('zh-CN')}
                          {i > 0 && s.amountRate != null && ` · ${s.amountRate}%`}
                        </span>
                      )}
                      <span className="text-xs text-ink font-medium">{s.value}</span>
                      {i > 0 && <span className="text-caption text-muted">{s.rate}%</span>}
                    </span>
                  </div>
                  <div className="h-3.5 bg-canvas rounded-r overflow-hidden">
                    <div className="h-full rounded-r" style={{ width: `${Math.max((s.value / funnelMax) * 100, s.value > 0 ? 2 : 0)}%`, background: `color-mix(in oklab, var(--viz-1) ${100 - i * 15}%, white)` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 报价趋势 */}
        <div className="eo-card p-4">
          <h2 className="text-sm font-semibold text-ink mb-3">报价趋势 <span className="text-caption text-muted ml-1">近6月</span></h2>
          {statsQuery.isLoading ? <PageLoader /> : trend.length === 0 ? (
            <EmptyState bare title="还没有报价记录" description="需求 → 方案 → 报价 走通一单后，这里会展示近6月报价趋势"
              action={<button onClick={() => navigate('/requirements')} className="text-sm text-accent-600 hover:text-accent-700">从需求开始 →</button>} />
          ) : (
            <div>
              <div className="flex items-end gap-1.5 h-[100px]">
                {trend.map((d: any, i: number) => (
                  <div key={d.month} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
                    {(i === trendMaxIdx || i === trend.length - 1) && d.amount > 0 && <span className="text-caption text-ink-soft mb-0.5 whitespace-nowrap">{compactMoney(d.amount)}</span>}
                    <div title={`${d.month}：${compactMoney(d.amount)}元`} className="w-full rounded-t" style={{ height: `${Math.max((d.amount / trendMax) * 100, 1.5)}%`, maxWidth: 18, background: 'var(--viz-1)' }} />
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5 mt-1">
                {trend.map((d: any) => <div key={d.month} className="flex-1 text-center"><span className="text-caption text-muted">{d.month.slice(5)}月</span></div>)}
              </div>
            </div>
          )}
        </div>

        {/* 最近动态 */}
        <div className="eo-card p-4">
          <h2 className="text-sm font-semibold text-ink mb-3">最近动态</h2>
          {activitiesQuery.isLoading ? <PageLoader /> : <Timeline items={timelineItems.slice(0, 6)} empty="暂无动态" />}
        </div>
      </div>
    </div>
  )
}
