import { compactMoney } from '../StatCards'

/**
 * 按月对比两条序列（报价额 vs 签约额）的分组柱状图。
 *
 * 不引图表库：两条序列、六根柱，SVG 足够，配色走设计变量（明暗主题自动跟随），
 * 悬停 title 给出单月明细。签约额与工作台「本月签约额」同一口径（合同签约日）。
 */
export interface MonthlyPoint {
  month: string // YYYY-MM
  quoteAmount: number
  quoteCount: number
  dealAmount: number
  dealCount: number
}

export default function MonthlyBars({ data, height = 120 }: { data: MonthlyPoint[]; height?: number }) {
  const max = Math.max(...data.map((d) => Math.max(d.quoteAmount, d.dealAmount)), 1)
  const W = 300
  const H = height
  const PAD_B = 4
  const slot = W / Math.max(data.length, 1)
  const bw = Math.min(16, slot / 3)
  const y = (v: number) => H - PAD_B - (v / max) * (H - PAD_B - 14)
  const totalQuote = data.reduce((s, d) => s + d.quoteAmount, 0)
  const totalDeal = data.reduce((s, d) => s + d.dealAmount, 0)

  return (
    <div>
      <div className="flex items-center gap-3 mb-1.5 text-caption text-muted">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--viz-2)' }} /> 报价 {compactMoney(totalQuote)}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--viz-1)' }} /> 签约 {compactMoney(totalDeal)}
        </span>
      </div>
      <div className="relative" style={{ height: H }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" role="img" aria-label="近 6 个月报价与签约金额">
          <line x1="0" y1={H - PAD_B} x2={W} y2={H - PAD_B} stroke="var(--color-divider)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {data.map((d, i) => {
            const cx = slot * i + slot / 2
            return (
              <g key={d.month}>
                <title>{`${Number(d.month.slice(5))}月：报价 ${d.quoteCount} 单 ${compactMoney(d.quoteAmount)}元 · 签约 ${d.dealCount} 单 ${compactMoney(d.dealAmount)}元`}</title>
                <rect x={cx - bw - 1} y={y(d.quoteAmount)} width={bw} height={Math.max(H - PAD_B - y(d.quoteAmount), d.quoteAmount > 0 ? 2 : 0)} rx="2" fill="var(--viz-2)" />
                <rect x={cx + 1} y={y(d.dealAmount)} width={bw} height={Math.max(H - PAD_B - y(d.dealAmount), d.dealAmount > 0 ? 2 : 0)} rx="2" fill="var(--viz-1)" />
                {/* 透明命中区：整列可悬停 */}
                <rect x={slot * i} y="0" width={slot} height={H} fill="transparent" />
              </g>
            )
          })}
        </svg>
      </div>
      <div className="flex mt-1">
        {data.map((d) => (
          <div key={d.month} className="flex-1 text-center min-w-0">
            <div className="text-caption text-muted">{Number(d.month.slice(5))}月</div>
            <div className="text-caption text-muted leading-3 tabular-nums">
              {d.quoteCount}报{d.dealCount > 0 ? `·${d.dealCount}签` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
