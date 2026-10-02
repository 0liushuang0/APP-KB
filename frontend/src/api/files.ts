/**
 * 文件访问地址构造。
 *
 * 后端已移除 `/uploads` 静态目录（那样任何人知道 URL 就能下载技术协议和报价单，
 * 完全绕过 visibility 权限）。现在统一走 `/api/files/*`，每次请求都校验登录态与权限。
 *
 * 这里**故意不使用**记录里存的 `fileUrl` 字段 —— 历史数据里存的是已失效的
 * `http://localhost:3001/uploads/...`，按 id 现算才能同时兼容新旧数据。
 *
 * 认证通过 httpOnly Cookie 携带，fetch 需要 credentials: 'include'。
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

export type FileKind = 'documents' | 'requirements' | 'products'

/** 浏览器内预览（PDF、图片直接打开） */
export function previewUrl(kind: FileKind, id: string): string {
  return `${API_BASE}/files/${kind}/${id}`
}

/** Office 文档转 PDF 预览（后端 LibreOffice 转换，含权限校验） */
export function officePreviewUrl(kind: FileKind, id: string): string {
  return `${API_BASE}/files/${kind}/${id}/preview-pdf`
}

/** 强制下载（带 Content-Disposition: attachment） */
export function downloadUrl(kind: FileKind, id: string): string {
  return `${API_BASE}/files/${kind}/${id}?download=1`
}

/**
 * 200 但返回 JSON 说明后端没把文件当文件发（历史上全局响应拦截器会把
 * StreamableFile 包成 { success, data } 序列化掉，存下来是几百字节的 JSON，
 * 打不开、大小也对不上）。宁可报错，也不要给用户存一个坏文件。
 */
async function assertNotJson(res: globalThis.Response): Promise<void> {
  if (!res.headers.get('content-type')?.includes('application/json')) return
  const text = await res.text().catch(() => '')
  let message = '文件返回异常，请联系管理员'
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed?.message === 'string') message = parsed.message
  } catch {
    /* 非标准 JSON，用兜底文案 */
  }
  throw new Error(message)
}

/**
 * 受保护资源无法直接用 <a href> 下载 —— 浏览器不会带上 Cookie。
 * 这里用 fetch 取回 blob 再触发本地下载。
 */
export async function downloadFile(kind: FileKind, id: string, fileName: string): Promise<void> {
  const res = await fetch(downloadUrl(kind, id), {
    credentials: 'include',
  })

  if (!res.ok) {
    const message =
      res.status === 403 ? '无权下载该文件' : res.status === 404 ? '文件不存在或已被删除' : '下载失败'
    throw new Error(message)
  }

  await assertNotJson(res)

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName || 'download'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 同上，用于在新标签页预览 */
export async function openPreview(kind: FileKind, id: string): Promise<void> {
  const res = await fetch(previewUrl(kind, id), {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(res.status === 403 ? '无权查看该文件' : '文件打开失败')

  await assertNotJson(res)

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
