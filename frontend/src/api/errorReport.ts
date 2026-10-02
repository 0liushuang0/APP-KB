/**
 * 前端错误上报。
 *
 * 客户那边白屏时，如果没有上报，你手上不会有任何线索 —— 只能靠对方口述"点了就没反应"。
 * 这里把现场发回后端落库，配合审计日志就能定位到具体操作。
 *
 * 刻意不使用 apiClient：
 *   · apiClient 的响应拦截器自身可能出错，会造成递归上报
 *   · 上报必须在页面即将崩溃时也能发出，用 sendBeacon / keepalive 更可靠
 */

export interface ClientErrorPayload {
  message: string
  stack?: string
  componentStack?: string
  /** 出错位置，如 'route:/requirements' */
  scope?: string
  url?: string
}

const ENDPOINT = `${import.meta.env.VITE_API_BASE_URL || '/api'}/client-errors`

/** 同一条错误短时间内只报一次，避免渲染循环把日志刷爆 */
const recent = new Map<string, number>()
const DEDUPE_WINDOW = 10_000

function shouldReport(key: string): boolean {
  const now = Date.now()
  const last = recent.get(key)
  if (last && now - last < DEDUPE_WINDOW) return false
  recent.set(key, now)
  // 控制内存占用
  if (recent.size > 50) {
    for (const [k, t] of recent) {
      if (now - t > DEDUPE_WINDOW) recent.delete(k)
    }
  }
  return true
}

export async function reportClientError(payload: ClientErrorPayload): Promise<void> {
  const key = `${payload.scope || ''}|${payload.message}`
  if (!shouldReport(key)) return

  const body = JSON.stringify({
    ...payload,
    url: payload.url || window.location.href,
    userAgent: navigator.userAgent,
    occurredAt: new Date().toISOString(),
  })

  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
      credentials: 'include',
      keepalive: true,
    })
  } catch {
    // 上报本身失败就放弃：不能因为记错误而制造新错误
  }
}

/**
 * 挂载全局兜底：Promise 未捕获拒绝与窗口级错误。
 * 错误边界只能捕获渲染期异常，事件回调、异步任务里的异常要靠这两个。
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('unhandledrejection', (e) => {
    const reason: any = e.reason
    reportClientError({
      message: reason?.message || String(reason),
      stack: reason?.stack,
      scope: 'unhandledrejection',
    })
  })

  window.addEventListener('error', (e) => {
    // 资源加载失败（img/script）没有 error 对象，跳过以免噪音
    if (!e.error) return
    reportClientError({
      message: e.error.message || e.message,
      stack: e.error.stack,
      scope: 'window.onerror',
    })
  })
}
