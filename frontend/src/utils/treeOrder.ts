/**
 * 树节点的本机显示顺序（存 localStorage）。
 *
 * 顺序只是浏览偏好、不入库 —— 与 ParamTemplates 的大类/子类排序同一理念：
 * 「大类不是实体、没有可以写回的地方」。这里推广成按**父路径**索引的顺序表，
 * 产品树、方案目录树共用，支持任意层级。
 *
 * 结构：{ [parentPath]: string[] }，值为该父下子项的 key（分类段名 / 产品 id / 目录段名）。
 */
export type OrderMap = Record<string, string[]>

export function loadOrder(storageKey: string): OrderMap {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) return JSON.parse(raw) as OrderMap
  } catch {
    /* 坏数据忽略，按无序处理 */
  }
  return {}
}

export function saveOrder(storageKey: string, map: OrderMap): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(map))
  } catch {
    /* 存储不可用时静默降级：本次会话仍生效，只是不持久化 */
  }
}

/** 按顺序表给某父路径下的 keys 排序；未登记的保持原序、追加在已登记之后 */
export function applyOrder(order: OrderMap, parentPath: string, keys: string[]): string[] {
  const pref = order[parentPath]
  if (!pref || pref.length === 0) return keys
  const rank = (k: string) => {
    const i = pref.indexOf(k)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...keys].sort((a, b) => {
    const d = rank(a) - rank(b)
    return d !== 0 ? d : keys.indexOf(a) - keys.indexOf(b)
  })
}

/** 把 parentPath 下的 key 上移(-1)/下移(1)一位，返回新的顺序表（不改传入对象） */
export function reorder(
  order: OrderMap,
  parentPath: string,
  siblingKeys: string[],
  key: string,
  dir: -1 | 1,
): OrderMap {
  const base = applyOrder(order, parentPath, siblingKeys)
  const idx = base.indexOf(key)
  if (idx === -1) return order
  const to = idx + dir
  if (to < 0 || to >= base.length) return order
  const arr = [...base]
  ;[arr[idx], arr[to]] = [arr[to], arr[idx]]
  return { ...order, [parentPath]: arr }
}
