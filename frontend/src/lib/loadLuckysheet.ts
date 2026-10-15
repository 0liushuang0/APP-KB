/**
 * 按需加载 Luckysheet 表格引擎。
 *
 * 原来 index.html 里同步引入（脚本 + 样式共 3.8MB，占全部前端脚本的 94%），
 * 每打开任何一个页面都要先下载它 —— 但只有「工程计算」的表格编辑器用得到。
 * 本机无感，局域网/VPN 多人使用时会明显拖慢首屏。现在进入表格编辑器时才加载，只加载一次。
 */
const CSS = [
  '/luckysheet/plugins/css/pluginsCss.css',
  '/luckysheet/plugins/plugins.css',
  '/luckysheet/css/luckysheet.css',
  '/luckysheet/assets/iconfont/iconfont.css',
]
const JS = ['/luckysheet/plugins/js/plugin.js', '/luckysheet/luckysheet.umd.js']

let loading: Promise<any> | null = null

function addScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = false
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`加载失败：${src}`))
    document.body.appendChild(el)
  })
}

export function loadLuckysheet(): Promise<any> {
  const w = window as any
  if (w.luckysheet) return Promise.resolve(w.luckysheet)
  if (loading) return loading
  for (const href of CSS) {
    if (!document.querySelector(`link[href="${href}"]`)) {
      const l = document.createElement('link')
      l.rel = 'stylesheet'
      l.href = href
      document.head.appendChild(l)
    }
  }
  loading = JS.reduce((p, src) => p.then(() => addScript(src)), Promise.resolve())
    .then(() => w.luckysheet)
    .catch((e) => {
      loading = null // 失败允许重试
      throw e
    })
  return loading
}
