/**
 * 列表响应归一化。
 *
 * 服务端分页上线后，`/customers`、`/requirements` 这些接口从返回数组
 * 改成了返回 `{ list, total, page, pageSize, totalPages }`。
 * 调用处普遍写着 `Array.isArray(data) ? data : []`，形状一变判定就落到 `[]`——
 * 不报错、不告警，只是下拉框空了，用户看到的是"关联客户选不了"。
 *
 * 这种静默失败必须收敛到一个函数里：以后再改分页形状，只改这里。
 */
export function toList<T = any>(data: any): T[] {
  if (!data) return []
  if (Array.isArray(data)) return data as T[]
  if (Array.isArray(data.list)) return data.list as T[]
  // 少数接口历史上用的是 items
  if (Array.isArray(data.items)) return data.items as T[]
  if (Array.isArray(data.data)) return data.data as T[]
  return []
}

/** 分页总数；非分页响应回落到数组长度 */
export function totalOf(data: any): number {
  if (!data) return 0
  if (Array.isArray(data)) return data.length
  if (typeof data.total === 'number') return data.total
  return toList(data).length
}

/**
 * 下拉选项用的拉取上限。
 *
 * 后端默认每页 20 条，直接 `list()` 拿到的选项只有 20 个 ——
 * 195 个客户里选不到第 21 个之后的任何一个，而且界面上完全看不出被截断了。
 * 选择器统一带上这个上限（后端 MAX_PAGE_SIZE 为 200），
 * 超过则必须靠关键词搜索来收敛。
 */
export const OPTION_PAGE_SIZE = 200
