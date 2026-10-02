/**
 * 置信度可视化。
 *
 * 阈值：≥0.8 可直接采信；0.5~0.8 建议核对；<0.5 必须人工确认。
 * 报价要用这些参数，抽错一个公称力就是几十万的偏差，所以低置信度要显眼。
 */
interface ConfidenceBarProps {
  value?: number
  /** 紧凑模式：只显示色条，不显示百分比 */
  compact?: boolean
  className?: string
}

export function confidenceTone(value: number): 'success' | 'warning' | 'danger' {
  if (value >= 0.8) return 'success'
  if (value >= 0.5) return 'warning'
  return 'danger'
}

const FILL: Record<string, string> = {
  success: 'bg-success-fg',
  warning: 'bg-warning-fg',
  danger: 'bg-danger-fg',
}

const TEXT: Record<string, string> = {
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
}

export default function ConfidenceBar({ value, compact = false, className = '' }: ConfidenceBarProps) {
  if (value === null || value === undefined) {
    return <span className="text-caption text-muted">-</span>
  }

  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  const tone = confidenceTone(value)

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        className="h-1.5 w-14 rounded-full bg-border overflow-hidden flex-shrink-0"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="置信度"
      >
        <div className={`h-full rounded-full ${FILL[tone]}`} style={{ width: `${pct}%` }} />
      </div>
      {!compact && (
        <span className={`font-mono text-caption ${TEXT[tone]} flex-shrink-0`}>{pct}%</span>
      )}
    </div>
  )
}

