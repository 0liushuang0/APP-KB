import { useSearchParams } from 'react-router-dom'
import { X, Crosshair } from 'lucide-react'

/**
 * 列表的「正在看」筛选（?focus=）。
 *
 * 工作台「我的今天」的每一格都直达一个筛选好的列表（如 跟进超期的需求、超 14 天未签约的报价），
 * 列表顶部的统计卡也能一键切到同一视图。筛选条件写在 URL 里：返回、刷新、分享都不丢。
 */
export function useFocus() {
  const [sp, setSp] = useSearchParams()
  const focus = sp.get('focus') || ''
  /** owner=me：只看我负责的（从工作台「我的今天」按人直达时带上） */
  const owner = sp.get('owner') || ''
  const setFocus = (v: string) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (v && v !== focus) next.set('focus', v)
        else {
          next.delete('focus')
          next.delete('owner')
        }
        next.delete('page')
        return next
      },
      { replace: true },
    )
  return { focus, setFocus, owner }
}

export default function FocusBar({
  focus,
  labels,
  onClear,
  count,
}: {
  focus: string
  labels: Record<string, string>
  onClear: () => void
  count?: number
}) {
  const [sp] = useSearchParams()
  const mine = sp.get('owner') === 'me'
  if (!focus) return null
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent-300 bg-accent-50 px-3 py-2 text-sm">
      <Crosshair size={14} className="text-accent-600 shrink-0" />
      <span className="text-ink">
        正在看：<b>{labels[focus] || focus}</b>
        {mine && <span className="text-accent-700">（只看我负责的）</span>}
        {count !== undefined && <span className="text-muted">（{count} 条）</span>}
      </span>
      <button type="button" onClick={onClear} className="ml-auto flex items-center gap-0.5 text-accent-700 hover:underline">
        <X size={13} /> 看全部
      </button>
    </div>
  )
}
