import { Maximize2, Minimize2 } from 'lucide-react'
import { useState, useCallback, useEffect } from 'react'

export default function FullscreenToggle() {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const toggle = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }, [])

  return (
    <button
      onClick={toggle}
      title={isFullscreen ? '退出全屏' : '全屏显示'}
      aria-label={isFullscreen ? '退出全屏' : '全屏显示'}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-canvas transition-colors flex-shrink-0"
    >
      {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
    </button>
  )
}
