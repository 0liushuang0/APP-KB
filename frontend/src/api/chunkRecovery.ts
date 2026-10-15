/**
 * 发版后旧页面的自动恢复。
 *
 * 前端按页面拆成带哈希的文件。重新构建后旧文件被替换，浏览器里还开着的旧页面
 * 再点开某个菜单就会报「Failed to fetch dynamically imported module」（运行日志里累计 38 次）。
 * 这类错误刷新一次就好，没必要让用户看到报错：检测到就自动刷新一次；
 * 30 秒内已经刷新过还是失败（说明是真的缺文件/网络问题），不再循环刷新，交给原有的错误处理。
 */
const KEY = 'aikb-chunk-reload-at'
const WINDOW_MS = 30_000
const PATTERN = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i

export function isChunkLoadError(reason: unknown): boolean {
  const msg = typeof reason === 'string' ? reason : (reason as any)?.message || ''
  return PATTERN.test(String(msg))
}

/** 是否应当自动刷新（读写 sessionStorage 里的时间戳）。导出用于测试 */
export function shouldReload(store: Pick<Storage, 'getItem' | 'setItem'>, now = Date.now()): boolean {
  try {
    const last = Number(store.getItem(KEY) || 0)
    if (last && now - last < WINDOW_MS) return false
    store.setItem(KEY, String(now))
    return true
  } catch {
    return false // 存储不可用时不冒险刷新(避免循环)
  }
}

export function installChunkRecovery(win: Window = window): void {
  /*
   * 只有真的要刷新时才拦下默认行为。
   * vite:preloadError 被 preventDefault 后，失败的 import 不再抛错而是返回 undefined，
   * React.lazy 随即报「Cannot read properties of undefined (reading 'default')」白屏
   * （前端错误日志 2026-10-15 23:20 实测一次）。30 秒内已刷新过、不再刷新时，
   * 必须让错误照常抛出，交给错误边界给出可读提示。
   */
  win.addEventListener('vite:preloadError', (e: Event) => {
    if (!shouldReload(win.sessionStorage)) return
    e.preventDefault()
    win.location.reload()
  })
  // React.lazy / 动态 import 的失败以未处理的 Promise 拒绝出现
  win.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    if (isChunkLoadError(e.reason) && shouldReload(win.sessionStorage)) {
      e.preventDefault()
      win.location.reload()
    }
  })
}
