import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

/**
 * 后端新鲜度检测：轮询 /api/health 的 buildTime（后端 dist 的构建时间）。
 *
 * 场景：开发/维护中后端重新构建并重启（修复已生效），但浏览器还开着旧页面 ——
 * 用户继续操作旧版本反复撞同一个 bug、报"还是不行"。检测到后端构建时间变化
 * 就提示刷新。首次加载只记录基线，不提示。
 */
const POLL_MS = 5 * 60 * 1000

export default function BackendFreshness() {
  const baseline = useRef<string | null>(null)
  const notified = useRef<Set<string>>(new Set())

  useEffect(() => {
    let stopped = false

    const probe = async () => {
      try {
        const base = import.meta.env.VITE_API_BASE_URL || '/api'
        const res = await fetch(`${base}/health`, { credentials: 'include' })
        if (!res.ok) return
        const j: any = await res.json()
        const bt = j?.data?.buildTime || j?.buildTime
        if (!bt || stopped) return
        if (baseline.current === null) {
          baseline.current = bt
          return
        }
        if (bt !== baseline.current && !notified.current.has(bt)) {
          notified.current.add(bt)
          baseline.current = bt
          toast('系统已更新，建议刷新页面（Ctrl+F5）以启用最新功能', { icon: '🔄', duration: 8000 })
        }
      } catch {
        /* 健康检查失败不打扰用户 */
      }
    }

    probe()
    const timer = setInterval(probe, POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [])

  return null
}
