// 复制自 packages/zh-embed/zh-embed.ts (0.1.0), 勿在此单独修改
/**
 * 智汇平台嵌入件 (package 0.1.0) — 子系统前端被智汇工作台内嵌时的适配
 *
 * 分发: 本文件是唯一源, 复制到应用的 src/lib/zh-embed.ts 使用, 升级时整体替换。
 * 依赖门户转发层注入的嵌入桥 /__zh/embed.js(设置 window.__ZH_EMBED__ 与 <html data-zh-embed>)。
 * 未被内嵌(直接访问/单独运行)时: isZhEmbedded() 为 false, 其余函数不做任何事, 应用行为完全不变。
 */

type Theme = 'light' | 'dark'

/** 当前页面是否被智汇工作台内嵌 */
export function isZhEmbedded(): boolean {
  if (typeof window === 'undefined') return false
  return !!(window as unknown as { __ZH_EMBED__?: unknown }).__ZH_EMBED__ || document.documentElement.dataset.zhEmbed === '1'
}

/** 跟随门户主题: 立即回调一次已知主题, 之后每次门户切换主题都回调; 返回取消函数 */
export function onZhTheme(cb: (theme: Theme) => void): () => void {
  if (!isZhEmbedded()) return () => {}
  const handler = (e: Event) => {
    const t = (e as CustomEvent<{ theme: Theme }>).detail?.theme
    if (t === 'light' || t === 'dark') cb(t)
  }
  window.addEventListener('zh:theme', handler)
  const known = (window as unknown as { __ZH_THEME__?: () => Theme | null }).__ZH_THEME__?.()
  if (known) cb(known)
  return () => window.removeEventListener('zh:theme', handler)
}

/**
 * 统一登录: 内嵌时用门户转发层附带的签名身份换取本系统登录态。
 * 成功返回与本系统登录接口相同的结果(已解开 NestJS 全局响应包装), 失败返回 null(回到原登录表单)。
 */
export async function zhSso(url = '/api/auth/zh-sso'): Promise<any | null> {
  if (!isZhEmbedded() && (typeof location === 'undefined' || !location.hostname.endsWith('.zh.localhost'))) return null
  try {
    const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (!r.ok) return null
    const data = await r.json()
    return data && typeof data === 'object' && 'success' in data && 'data' in data && 'statusCode' in data ? data.data : data
  } catch {
    return null
  }
}
