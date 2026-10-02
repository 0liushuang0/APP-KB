import { WifiOff } from 'lucide-react'
import { useNetworkStatus } from '../hooks/useNetworkStatus'

/**
 * 离线状态横幅。
 *
 * 断网时显示在页面顶部，告知用户哪些功能可用。
 * 恢复后自动消失（2秒后隐藏，给用户看到"已恢复"的反馈）。
 */
export default function OfflineBanner() {
  const { isOnline, wasOffline } = useNetworkStatus()

  if (isOnline && !wasOffline) return null

  if (!isOnline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[9999] bg-warning-fg text-white px-4 py-2 text-sm flex items-center justify-center gap-2 shadow-md">
        <WifiOff size={14} />
        <span className="font-medium">网络已断开</span>
        <span className="opacity-80">· 本地数据查看和检索可用 · AI 功能需联网</span>
      </div>
    )
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-success-fg text-white px-4 py-2 text-sm flex items-center justify-center gap-2 shadow-md animate-fade-in">
      <span className="font-medium">网络已恢复</span>
    </div>
  )
}
