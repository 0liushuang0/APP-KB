/**
 * Documents 页面共享的工具函数和常量。
 * 从 Documents.tsx 提取，主文件减负 ~70 行。
 */
import { toast } from 'sonner'

export const handleError = (error: any) => {
  toast.error(error?.response?.data?.message || error?.message || '操作失败')
}

// ─── 左侧导航展示顺序（本地浏览偏好，按 scope 分别存） ───
export const NAV_GROUP_ORDER_KEY = 'aikb-doc-nav-group-order-v1'
export const NAV_SUB_ORDER_KEY = 'aikb-doc-nav-sub-order-v1'

export function loadNavOrders(key: string): Record<string, any> {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}')
  } catch { return {} }
}

export function saveNavOrders(key: string, map: Record<string, any>) {
  localStorage.setItem(key, JSON.stringify(map))
}

// ─── 分类改名展示覆盖 ───
export const NAV_LABEL_OVERRIDES_KEY = 'aikb-doc-nav-label-overrides-v1'

// ─── 用户新增子类 ───
export const NAV_EXTRA_SUBS_KEY = 'aikb-doc-nav-extra-subs-v1'
export const NAV_EXTRA_GRANDSUBS_KEY = 'aikb-doc-nav-extra-grandsubs-v1'
export const NAV_GRANDSUB_ORDER_KEY = 'aikb-doc-nav-grandsub-order-v1'
export const NAV_HIDDEN_KEY = 'aikb-doc-nav-hidden-v1'

// ─── 上传限制：与后端保持一致 ───
export const MAX_DOC_FILE_SIZE = 200 * 1024 * 1024

export const PRODUCT_DOC_GROUP = 'product_docs'
export const PRODUCT_DOC_PREFIX = 'product:'

export const formatSize = (bytes?: number) => {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
