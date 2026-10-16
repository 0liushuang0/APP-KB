import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Gauge, Info } from 'lucide-react'
import { systemApi } from '../api/services'

/**
 * 业务结果指标卡（工作台）：报价响应天数、需求→签约周期、赢单率、回款及时率、主要丢单原因。
 *
 * 历史单据多为集中补录，创建时间不代表业务发生时间 —— 每个周期都标出样本里有几个是「真实业务日期」，
 * 真实样本不足 3 个时明确提示，不拿补录日期冒充业务结论。
 */
export default function BusinessResultsCard({ scope }: { scope: 'mine' | 'all' }) {
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['cycle-metrics', scope],
    queryFn: () => systemApi.cycleMetrics(scope, 180),
    staleTime: 60_000,
  })
  if (!data) return null

  const cycle = (label: string, s: any, hint: string) => (
    <div className="rounded-lg border border-border p-3" title={hint}>
      <div className="text-caption text-muted">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-ink">
        {s.median != null ? (
          <>
            {s.median}
            <span className="text-sm font-normal text-muted ml-0.5">天</span>
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </div>
      <div className="text-caption text-muted mt-0.5">
        {s.n ? `中位数 · ${s.n} 个样本，真实日期 ${s.nReal} 个` : '暂无样本'}
      </div>
    </div>
  )

  const realShort = data.quoteResponse.nReal < 3 || data.reqToSign.nReal < 3

  return (
    <div className="eo-card p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5">
          <Gauge size={15} className="text-accent-600" /> 业务结果（近 180 天{scope === 'mine' ? ' · 我负责的' : ''}）
        </h2>
        <button type="button" className="text-caption text-accent-600 hover:underline" onClick={() => navigate('/reports/weekly')}>
          看周报 →
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {cycle('报价响应', data.quoteResponse, '需求时间 → 该需求第一份报价的报价日期')}
        {cycle('需求→签约', data.reqToSign, '需求时间 → 第一份签约合同的签订日')}
        <div className="rounded-lg border border-border p-3" title="已签约需求 ÷（已签约 + 已丢单）">
          <div className="text-caption text-muted">赢单率</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-ink">
            {data.winRate.rate != null ? `${data.winRate.rate}%` : <span className="text-muted">—</span>}
          </div>
          <div className="text-caption text-muted mt-0.5 truncate">
            签约 {data.winRate.won} · 丢单 {data.winRate.lost}
            {data.lossReasons?.[0] ? ` · 主因「${data.lossReasons[0].reason}」` : ''}
          </div>
        </div>
        <div className="rounded-lg border border-border p-3" title="已到期的回款节点里，到期日当天及以前收到的占比">
          <div className="text-caption text-muted">回款及时率</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-ink">
            {data.paymentOnTime.rate != null ? `${data.paymentOnTime.rate}%` : <span className="text-muted">—</span>}
          </div>
          <div className="text-caption text-muted mt-0.5">
            到期 {data.paymentOnTime.due} 笔 · 逾期未收 {data.paymentOnTime.overdueOpen}
          </div>
        </div>
      </div>
      {realShort && (
        <p className="mt-2 text-caption text-muted flex items-start gap-1">
          <Info size={12} className="mt-0.5 shrink-0" />
          现有单据多为集中补录：需求请填「需求时间」、报价填「报价日期」、合同填「签订日期」，按真实日期录入一个月后周期指标才有说服力
        </p>
      )}
    </div>
  )
}
