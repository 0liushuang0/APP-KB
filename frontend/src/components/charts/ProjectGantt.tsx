/**
 * 项目交期甘特图：每个项目一条横条（计划开工 → 计划完工），按健康度着色，
 * 竖线标出今天；进度用条内深色段表示。点一条打开该项目。
 *
 * 一眼回答负责人最关心的两件事：哪些项目已经过了完工日、接下来一个月谁要交货。
 */
export interface GanttRow {
  id: string
  label: string
  sub?: string
  start?: string | null
  end?: string | null
  progress?: number | null
  health?: string | null
}

const COLOR: Record<string, string> = {
  red: 'var(--color-danger-fg)',
  yellow: 'var(--color-warning-fg)',
  green: 'var(--color-success-fg)',
}

const DAY = 86400000

export default function ProjectGantt({ rows, onPick }: { rows: GanttRow[]; onPick?: (id: string) => void }) {
  const dated = rows.filter((r) => r.start || r.end)
  const undated = rows.length - dated.length
  if (!dated.length) {
    return <div className="text-caption text-muted py-4 text-center">项目还没有计划开工/完工日期 —— 从合同立项时会自动带出</div>
  }
  const t = (s?: string | null) => (s ? new Date(s).getTime() : NaN)
  const today = Date.now()
  const min = Math.min(...dated.map((r) => (Number.isNaN(t(r.start)) ? t(r.end) : t(r.start))), today) - 7 * DAY
  const max = Math.max(...dated.map((r) => (Number.isNaN(t(r.end)) ? t(r.start) : t(r.end))), today) + 7 * DAY
  const span = Math.max(max - min, DAY)
  const pct = (v: number) => ((v - min) / span) * 100

  // 月份刻度
  const ticks: Array<{ x: number; label: string }> = []
  const d0 = new Date(min)
  for (let d = new Date(d0.getFullYear(), d0.getMonth() + 1, 1); d.getTime() < max; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    ticks.push({ x: pct(d.getTime()), label: d.getMonth() === 0 ? `${d.getFullYear()}/1` : `${d.getMonth() + 1}月` })
  }
  const sorted = [...dated].sort((a, b) => (t(a.end) || 9e15) - (t(b.end) || 9e15))

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="relative h-5 ml-40 border-b border-border">
          {ticks.map((k) => (
            <span key={k.x} className="absolute text-caption text-muted -translate-x-1/2" style={{ left: `${k.x}%` }}>
              {k.label}
            </span>
          ))}
        </div>
        <div className="relative">
          {/* 今天 */}
          <div className="absolute top-0 bottom-0 ml-40 right-0 pointer-events-none">
            <div className="absolute top-0 bottom-0 w-px" style={{ left: `${pct(today)}%`, background: 'var(--color-danger-fg)', opacity: 0.6 }} />
          </div>
          {sorted.map((r) => {
            const s = Number.isNaN(t(r.start)) ? t(r.end) : t(r.start)
            const e = Number.isNaN(t(r.end)) ? s + DAY : t(r.end)
            const left = pct(s)
            const width = Math.max(pct(e) - left, 0.8)
            const color = COLOR[r.health || ''] || 'var(--viz-2)'
            const prog = Math.min(Math.max(Number(r.progress || 0), 0), 100)
            const overdue = e < today && prog < 100
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onPick?.(r.id)}
                className="w-full flex items-center h-7 hover:bg-subtle text-left"
                title={`${r.label}${r.sub ? ` · ${r.sub}` : ''}\n${r.start || '?'} → ${r.end || '?'} · 进度 ${prog}%${overdue ? ' · 已过计划完工' : ''}`}
              >
                <span className="w-40 shrink-0 pr-2 truncate text-caption text-ink-soft">{r.label}</span>
                <span className="relative flex-1 h-full">
                  <span
                    className="absolute top-1.5 h-4 rounded"
                    style={{ left: `${left}%`, width: `${width}%`, background: `color-mix(in oklab, ${color} 28%, transparent)`, outline: overdue ? `1px solid ${color}` : undefined }}
                  >
                    <span className="block h-full rounded" style={{ width: `${prog}%`, background: color }} />
                  </span>
                </span>
              </button>
            )
          })}
        </div>
        {undated > 0 && <div className="text-caption text-muted mt-1 ml-40">另有 {undated} 个项目未填计划日期</div>}
      </div>
    </div>
  )
}
