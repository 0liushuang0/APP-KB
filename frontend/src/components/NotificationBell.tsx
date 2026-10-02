import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck } from 'lucide-react'
import { notificationApi, type AppNotification } from '../api/services'

const TYPE_ICON: Record<string, string> = {
  approval: '📋', document: '📄', ai: '🤖', system: '⚙️', warranty: '🛡️',
}

/**
 * 通知铃铛（topbar 右侧）。
 * 每 30 秒轮询未读数，点击弹出最近 5 条通知 + 查看全部。
 */
export default function NotificationBell() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 30 秒轮询未读数
  const { data: unreadData } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: () => notificationApi.unreadCount(),
    refetchInterval: 30_000,
  })
  const unreadCount = unreadData?.count || 0

  // 下拉面板里最近 5 条
  const { data: recent } = useQuery({
    queryKey: ['notifications-recent'],
    queryFn: () => notificationApi.list(),
    enabled: open,
  })

  const markAllMutation = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-recent'] })
    },
  })

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleClick = (n: AppNotification) => {
    if (!n.read) {
      notificationApi.markRead(n.id).then(() => {
        queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] })
      })
    }
    setOpen(false)
    if (n.linkUrl) navigate(n.linkUrl)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative w-8 h-8 flex items-center justify-center rounded-md text-muted hover:text-ink hover:bg-canvas transition-colors"
        title={"通知"}
        aria-label="通知"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-danger-fg rounded-full">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 eo-card shadow-pop overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">通知</span>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllMutation.mutate()}
                className="flex items-center gap-1 text-xs text-accent-600 hover:text-accent-700"
              >
                <CheckCheck size={12} /> 全部已读
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {(recent || []).length === 0 ? (
              <p className="text-sm text-muted text-center py-8">暂无通知</p>
            ) : (
              (recent || []).slice(0, 5).map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full text-left px-4 py-3 border-b border-border/50 last:border-0 hover:bg-canvas transition-colors flex gap-2.5 ${!n.read ? 'bg-accent-50' : ''}`}
                >
                  <span className="text-base flex-shrink-0 mt-0.5">{TYPE_ICON[n.type] || '📣'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{n.title}</p>
                    {n.content && <p className="text-xs text-muted mt-0.5 line-clamp-2">{n.content}</p>}
                    <p className="text-caption text-muted mt-1">
                      {new Date(n.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-accent-500 flex-shrink-0 mt-1.5" />}
                </button>
              ))
            )}
          </div>
          <button
            onClick={() => { setOpen(false); navigate('/notifications') }}
            className="w-full px-4 py-2.5 text-sm text-accent-600 hover:bg-canvas border-t border-border transition-colors"
          >
            查看全部通知
          </button>
        </div>
      )}
    </div>
  )
}
