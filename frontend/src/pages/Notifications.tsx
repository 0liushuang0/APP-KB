import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, Bell } from 'lucide-react'
import { notificationApi, type AppNotification } from '../api/services'
import Button from '../components/Button'
import PageLoader from '../components/PageLoader'

const TYPE_ICON: Record<string, string> = {
  approval: '📋', document: '📄', ai: '🤖', system: '⚙️', warranty: '🛡️', report: '📊',
}

export default function Notifications() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'all' | 'unread'>('all')

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications', tab],
    queryFn: () => notificationApi.list(tab === 'unread'),
  })

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] })
    },
  })

  const markAllMutation = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] })
    },
  })

  const handleClick = (n: AppNotification) => {
    if (!n.read) markReadMutation.mutate(n.id)
    if (n.linkUrl) navigate(n.linkUrl)
  }

  if (isLoading) return <PageLoader />

  const list = notifications || []
  const unreadCount = list.filter((n) => !n.read).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-ink">通知中心</h1>
          <div className="flex gap-1">
            <button
              onClick={() => setTab('all')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${tab === 'all' ? 'bg-accent-50 text-accent-700 font-medium' : 'text-muted hover:text-ink'}`}
            >
              全部 ({list.length})
            </button>
            <button
              onClick={() => setTab('unread')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${tab === 'unread' ? 'bg-accent-50 text-accent-700 font-medium' : 'text-muted hover:text-ink'}`}
            >
              未读 ({unreadCount})
            </button>
          </div>
        </div>
        {unreadCount > 0 && (
          <Button variant="secondary" size="sm" onClick={() => markAllMutation.mutate()} loading={markAllMutation.isPending}>
            <CheckCheck size={14} className="mr-1" /> 全部标记已读
          </Button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="eo-card p-12 text-center">
          <Bell size={32} className="text-muted mx-auto mb-3 opacity-50" />
          <p className="text-sm text-muted">{tab === 'unread' ? '没有未读通知' : '暂无通知'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((n) => (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={`w-full text-left eo-card p-4 hover:shadow-md transition-all flex gap-3 ${!n.read ? 'border-l-4 border-l-accent-500' : ''}`}
            >
              <span className="text-xl flex-shrink-0 mt-0.5">{TYPE_ICON[n.type] || '📣'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-sm ${!n.read ? 'font-semibold text-ink' : 'font-medium text-ink-soft'}`}>{n.title}</p>
                  <span className="text-caption text-muted flex-shrink-0">
                    {new Date(n.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {n.content && <p className="text-sm text-muted mt-1">{n.content}</p>}
              </div>
              {!n.read && <span className="w-2 h-2 rounded-full bg-accent-500 flex-shrink-0 mt-2" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
