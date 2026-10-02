import { useQuery } from '@tanstack/react-query'
import { Activity, Cpu, Clock, CheckCircle2, XCircle, Database, Zap, TrendingUp, Files, FileCheck2, FileWarning, LucideIcon, ThumbsUp, MessageSquare } from 'lucide-react'
import { systemApi } from '../../api/services'
import PageLoader from '../../components/PageLoader'
import ErrorState from '../../components/ErrorState'
import EmptyState from '../../components/EmptyState'

export default function PerformanceMetrics() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['performance-metrics'],
    queryFn: () => systemApi.performanceMetrics(),
  })
  // 运行健康（独立查询：巡检指标与业务效能分开刷新）
  const { data: health } = useQuery({
    queryKey: ['health-summary'],
    queryFn: () => systemApi.healthSummary(),
    refetchInterval: 60_000,
  })

  if (isLoading) return <PageLoader />
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />
  if (!data) return <EmptyState />

  const ai = data.aiCalls || {}
  const fb = (data as any).aiFeedback || {}
  const maxTrendCalls = Math.max(...(data.trend || []).map((t) => t.calls), 1)

  return (
    <div>
      <h2 className="font-serif text-heading-lg font-medium text-ink mb-6">使用与知识健康</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard icon={Zap} label="AI 调用总数" value={ai.total ?? 0} colorClass="text-warning-fg" />
        <MetricCard icon={CheckCircle2} label="成功率" value={`${ai.successRate ?? 100}%`} colorClass="text-success-fg" sub={`${ai.success ?? 0} 成功 / ${ai.failed ?? 0} 失败`} />
        <MetricCard icon={Clock} label="平均耗时" value={`${ai.avgDurationMs ?? 0}ms`} colorClass="text-info-fg" sub={`最大 ${ai.maxDurationMs ?? 0}ms / 最小 ${ai.minDurationMs ?? 0}ms`} />
        <MetricCard icon={Cpu} label="Token 消耗" value={ai.totalTokens ?? 0} colorClass="text-accent-600" />
      </div>

      {/* AI 效果评测（轻量）：用户点赞/点踩的赞同率，回答"用得多不多、好不好用" */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard icon={ThumbsUp} label="用户赞同率" value={fb.approvalRate == null ? '暂无评价' : `${fb.approvalRate}%`} colorClass={fb.approvalRate != null && fb.approvalRate < 60 ? 'text-warning-fg' : 'text-success-fg'} />
        <MetricCard icon={MessageSquare} label="评价总数" value={fb.total ?? 0} colorClass="text-info-fg" sub={`👍 ${fb.positive ?? 0} / 👎 ${fb.negative ?? 0}`} />
      </div>

      {/* 运行健康：CPU/内存/磁盘/连接池/备份/AI 可达（每分钟自动刷新，磁盘不足等异常会推送站内告警） */}
      {health && (
        <div className="eo-card p-5 mb-6">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2 mb-4">
            <Activity size={15} className="text-accent-600" /> 运行健康
            <span className="text-caption text-muted ml-auto">已运行 {Math.floor((health.uptimeSeconds || 0) / 3600)}h {Math.floor(((health.uptimeSeconds || 0) % 3600) / 60)}m · 每分钟刷新</span>
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><div className="eo-label mb-1">进程内存</div><div className="eo-num text-body text-ink">{health.process?.rssMB ?? '-'} MB</div><div className="text-caption text-muted">堆 {health.process?.heapUsedMB ?? '-'}MB · CPU {health.process?.cpuPercent ?? '-'}%</div></div>
            <div><div className="eo-label mb-1">数据盘剩余</div><div className={`eo-num text-body ${(health.system?.diskFreeRatio ?? 100) < 15 ? 'text-danger-fg font-semibold' : 'text-ink'}`}>{health.system?.diskFreeGB ?? '-'} GB</div><div className="text-caption text-muted">占盘 {health.system?.diskFreeRatio ?? 0}%{(health.system?.diskFreeRatio ?? 100) < 15 ? ' · 不足，请清理备份' : ''}</div></div>
            <div><div className="eo-label mb-1">数据库连接池</div><div className="eo-num text-body text-ink">{health.db?.total ?? 0} 连接</div><div className="text-caption text-muted">空闲 {health.db?.idle ?? 0} · 等待 {health.db?.waiting ?? 0}</div></div>
            <div>
              <div className="eo-label mb-1">AI 服务</div>
              <div className={`eo-num text-body ${health.aiServiceUp ? 'text-success-fg' : 'text-danger-fg'}`}>{health.aiServiceUp ? '正常' : '不可达'}</div>
              <div className="text-caption text-muted">备份 {health.backup?.dbAgeHours ?? '-'}h 前（库）/ {health.backup?.fullAgeHours ?? '-'}h 前（全量）</div>
            </div>
          </div>
        </div>
      )}

      <div className="eo-card p-5 mb-6">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2 mb-4">
          <Files size={16} /> 知识资料健康度
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KnowledgeStat icon={Files} label="资料总数" value={data.knowledgeHealth?.total ?? 0} />
          <KnowledgeStat icon={FileCheck2} label="已解析" value={data.knowledgeHealth?.parsed ?? 0} tone="success" />
          <KnowledgeStat icon={FileWarning} label="待解析" value={data.knowledgeHealth?.pending ?? 0} tone="warning" />
          <KnowledgeStat icon={CheckCircle2} label="当前可用" value={data.knowledgeHealth?.usable ?? 0} tone="info" />
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-caption text-muted mb-1">
            <span>资料解析覆盖率</span>
            <span>{data.knowledgeHealth?.total ? Math.round(((data.knowledgeHealth.parsed ?? 0) / data.knowledgeHealth.total) * 100) : 0}%</span>
          </div>
          <div className="h-2 rounded-full bg-canvas overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-600"
              style={{ width: `${data.knowledgeHealth?.total ? ((data.knowledgeHealth.parsed ?? 0) / data.knowledgeHealth.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard icon={Database} label="客户数" value={data.entityCounts?.customers ?? 0} colorClass="text-info-fg" />
        <MetricCard icon={Database} label="需求数" value={data.entityCounts?.requirements ?? 0} colorClass="text-cyan-600" />
        <MetricCard icon={Database} label="方案数" value={data.entityCounts?.proposals ?? 0} colorClass="text-success-fg" />
        <MetricCard icon={Database} label="报价数" value={data.entityCounts?.quotations ?? 0} colorClass="text-warning-fg" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="eo-card p-5">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2 mb-4">
            <TrendingUp size={16} /> 近 7 天 AI 调用趋势
          </h3>
          {(data.trend || []).length === 0 ? (
            <p className="text-sm text-muted">暂无数据</p>
          ) : (
            <div className="space-y-2">
              {(data.trend || []).map((t) => (
                <div key={t.date} className="flex items-center gap-3">
                  <span className="text-xs text-muted w-20">{t.date.slice(5)}</span>
                  <div className="flex-1 h-6 bg-canvas rounded relative overflow-hidden">
                    <div
                      className="h-full bg-accent-400 rounded transition-all"
                      style={{ width: `${(t.calls / maxTrendCalls) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-ink-soft w-16 text-right">{t.calls} 次</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="eo-card p-5">
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2 mb-4">
            <Activity size={16} /> 各模块 AI 调用统计
          </h3>
          {(data.byModule || []).length === 0 ? (
            <p className="text-sm text-muted">暂无数据</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2 text-xs font-medium text-muted">模块</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-muted">调用次数</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-muted">成功率</th>
                    <th className="text-right py-2 px-2 text-xs font-medium text-muted">平均耗时</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.byModule || []).map((m) => (
                    <tr key={m.module} className="border-b border-border/50 last:border-0">
                      <td className="py-2 px-2 text-ink-soft">{m.module}</td>
                      <td className="py-2 px-2 text-right text-ink-soft">{m.count}</td>
                      <td className="py-2 px-2 text-right">
                        <span className={m.successRate >= 90 ? 'text-success-fg' : m.successRate >= 70 ? 'text-warning-fg' : 'text-danger-fg'}>
                          {m.successRate}%
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right text-ink-soft">{m.avgDuration}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="eo-card p-5 mt-6">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2 mb-4">
          <XCircle size={16} /> 本机操作记录
        </h3>
        <div className="flex items-center gap-4">
          <div className="text-3xl font-bold text-ink">{data.auditLogs ?? 0}</div>
          <div className="text-sm text-muted">条操作日志已记录</div>
        </div>
      </div>
    </div>
  )
}

function KnowledgeStat({ icon: Icon, label, value, tone = 'neutral' }: { icon: LucideIcon; label: string; value: number; tone?: 'neutral' | 'success' | 'warning' | 'info' }) {
  const toneClass = {
    neutral: 'bg-neutral-bg text-neutral-fg',
    success: 'bg-success-bg text-success-fg',
    warning: 'bg-warning-bg text-warning-fg',
    info: 'bg-info-bg text-info-fg',
  }[tone]
  return (
    <div className="rounded-lg border border-border p-3 bg-subtle">
      <div className={`w-7 h-7 rounded-md flex items-center justify-center ${toneClass}`}><Icon size={14} /></div>
      <div className="eo-num text-xl font-semibold text-ink mt-2">{value}</div>
      <div className="text-caption text-muted">{label}</div>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, colorClass, sub }: { icon: LucideIcon; label: string; value: React.ReactNode; colorClass: string; sub?: string }) {
  return (
    <div className="eo-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted">{label}</span>
        <Icon size={16} className={colorClass} />
      </div>
      <div className="text-2xl font-bold text-ink">{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  )
}

