import { Cloud, CloudOff, Loader2, Check } from 'lucide-react'

/**
 * 自动保存状态指示器。
 *
 * 显示在编辑页面的角落，让用户知道内容是否已保存。
 */
export default function AutoSaveIndicator({
  status,
  lastSavedText,
}: {
  status: 'idle' | 'saving' | 'saved' | 'error'
  lastSavedText?: string | null
}) {
  if (status === 'idle' && !lastSavedText) return null

  return (
    <div className="flex items-center gap-1.5 text-caption text-muted transition-opacity">
      {status === 'saving' && (
        <>
          <Loader2 size={12} className="animate-spin" />
          <span>保存中…</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <Check size={12} className="text-success-fg" />
          <span className="text-success-fg">{lastSavedText || '已保存'}</span>
        </>
      )}
      {status === 'error' && (
        <>
          <CloudOff size={12} className="text-danger-fg" />
          <span className="text-danger-fg">保存失败</span>
        </>
      )}
      {status === 'idle' && lastSavedText && (
        <>
          <Cloud size={12} />
          <span>{lastSavedText}</span>
        </>
      )}
    </div>
  )
}
