// 复制自 packages/zh-embed/ZhManagedNotice.tsx (0.1.0), 勿在此单独修改
/**
 * 智汇平台嵌入件 (package 0.1.0) — 「由智汇工作台统一管理」提示条 (React)
 *
 * 分发: 复制到应用 src/lib/ZhManagedNotice.tsx。放在本系统设置页顶部:
 * 接入平台且存在被统一管理的设置项时显示提示(这些项在本页修改会被拒绝), 否则不渲染任何内容。
 * url: 本系统返回 {managed, labels, portal} 的接口(需登录, 同源相对路径)。
 */
import { useEffect, useState } from 'react'

export default function ZhManagedNotice({ url }: { url: string }) {
  const [labels, setLabels] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    fetch(url, { credentials: 'include', headers: authHeader() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const data = d && 'success' in d && 'data' in d ? d.data : d
        if (alive && data?.portal && Array.isArray(data.labels)) setLabels(data.labels)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [url])
  if (!labels.length) return null
  return (
    <div className="mb-3 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      以下设置由<b className="mx-0.5">智汇工作台</b>统一管理，请在工作台「系统设置 → 统一设置」中修改：{labels.join('、')}
    </div>
  )
}

/** 令牌存本地存储的系统(如 CRM)需带 Authorization; Cookie 会话的系统该值为空不影响 */
function authHeader(): Record<string, string> {
  try {
    for (const k of Object.keys(localStorage)) {
      const v = localStorage.getItem(k) || ''
      const m = /"accessToken"\s*:\s*"([^"]+)"/.exec(v)
      if (m) return { Authorization: `Bearer ${m[1]}` }
    }
  } catch {
    /* 无本地存储 */
  }
  return {}
}
