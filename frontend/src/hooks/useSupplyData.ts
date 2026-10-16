import { useQuery } from '@tanstack/react-query'
import { supplierApi, supplierProductApi, systemConfigApi } from '../api/services'
import { toList } from '../utils/apiList'

/**
 * 供应管理四个页签共用的数据源。
 *
 * 原来设备配套、备件管理各拉一份设备清单与供应商池，查询键各不相同、缓存 5 分钟：
 * 在设备配套加了设备，切到备件管理看不到；在供应管理新建了厂家，设备配套的提示里也没有。
 * 现在统一查询键 —— 任何一处写入后失效同一个键，其它页签立即拿到新数据：
 *   · ['equipment-bom']        设备配套（system_configs.equipment_bom）
 *   · ['spare-parts-bom']      备件清单（system_configs.spare_parts_bom）
 *   · ['suppliers', 'pool']    供应商池（挂在 ['suppliers'] 前缀下：供应管理里增删改厂家时失效 ['suppliers'] 即一并刷新）
 */

export interface StoredBomRow {
  key?: string
  part?: string
  profession?: string
  suppliers?: string[]
  supplierName?: string
  note?: string
  spareType?: string
  [k: string]: unknown
}
export type StoredBom = Record<string, Array<string | StoredBomRow>>

export const QK_EQUIPMENT_BOM = ['equipment-bom'] as const
export const QK_SPARE_BOM = ['spare-parts-bom'] as const
export const QK_SUPPLIER_POOL = ['suppliers', 'pool'] as const

/** 出厂设备清单与各设备的默认配件模板（贴合博亚产品线；只在从未配置过时兜底） */
export const DEFAULT_EQUIPMENT_BOM: Record<string, string[]> = {
  拉弯矫直机: ['机架（焊接件）', '工作辊/矫直辊', '轴承', '液压缸', '减速机', '电机', '联轴器', '液压系统', '电气控制系统', '测张装置'],
  圆盘剪: ['机架（焊接件）', '刀片', '传动减速机', '电机', '轴承', '联轴器'],
  碎边剪: ['机架（焊接件）', '刀片', '减速机', '电机', '轴承'],
  开卷机: ['卷筒', '机架（焊接件）', '电机', '减速机', '液压缸', '轴承'],
  卷取机: ['卷筒', '电机', '减速机', '液压缸', '轴承'],
  升降机: ['液压缸', '电机', '减速机', '导轨', '轴承'],
  联轴器: ['联轴器本体', '膜片/弹性件', '螺栓紧固件'],
}

/** 读一个 JSON 型系统配置；没配过 / 解析失败返回 undefined */
export async function readConfigJson<T = any>(key: string): Promise<T | undefined> {
  try {
    const res: any = await systemConfigApi.get(key)
    const raw = typeof res === 'string' ? res : res?.value || res?.data?.value
    if (!raw) return undefined
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

const nonEmptyObject = (v: any) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0

/** 设备配套：库里配过就完全以库为准（含删除内置设备的语义），从未配置才用出厂默认 */
export function useEquipmentBom() {
  return useQuery({
    queryKey: QK_EQUIPMENT_BOM,
    queryFn: async () => {
      const parsed = await readConfigJson<StoredBom>('equipment_bom')
      return (nonEmptyObject(parsed) ? parsed : DEFAULT_EQUIPMENT_BOM) as StoredBom
    },
    staleTime: 5 * 60_000,
  })
}

export function useSpareBom() {
  return useQuery({
    queryKey: QK_SPARE_BOM,
    queryFn: async () => {
      const parsed = await readConfigJson<StoredBom>('spare_parts_bom')
      return (nonEmptyObject(parsed) ? parsed : {}) as StoredBom
    },
    staleTime: 5 * 60_000,
  })
}

/** 供应商池：一次拉全（200 一页，最多 2000 家） */
export function useSupplierPool() {
  return useQuery({
    queryKey: QK_SUPPLIER_POOL,
    queryFn: async () => {
      const PAGE = 200
      const first: any = await supplierApi.list({ pageSize: PAGE })
      const total = Number(first?.total ?? 0)
      let all = toList<any>(first)
      for (let p = 2; p <= Math.min(Math.ceil(total / PAGE) || 1, 10); p++) {
        const next: any = await supplierApi.list({ pageSize: PAGE, page: p })
        all = all.concat(toList<any>(next))
      }
      return all
    },
    staleTime: 5 * 60_000,
  })
}

// ── 行里的供应商引用 ──

export const rowSuppliers = (it: string | StoredBomRow): string[] =>
  typeof it === 'string' ? [] : Array.isArray(it.suppliers) ? it.suppliers : it.supplierName ? [it.supplierName] : []
export const rowPart = (it: string | StoredBomRow): string => (typeof it === 'string' ? it : String(it.part || ''))

export interface SupplierUse {
  source: '设备配套' | '备件管理'
  equipment: string
  part: string
}

/** 某厂家在设备配套 / 备件清单里被哪些行引用（供应商详情「在哪用到」、删除前提示） */
export function whereUsed(name: string, eqBom?: StoredBom, spareBom?: StoredBom): SupplierUse[] {
  const out: SupplierUse[] = []
  const scan = (bom: StoredBom | undefined, source: SupplierUse['source']) => {
    for (const [equipment, items] of Object.entries(bom || {})) {
      for (const it of Array.isArray(items) ? items : []) {
        if (rowSuppliers(it).includes(name)) out.push({ source, equipment, part: rowPart(it) || '（未命名配件）' })
      }
    }
  }
  scan(eqBom, '设备配套')
  scan(spareBom, '备件管理')
  return out
}

// ── 供应商候选 ──

/** 配件名 → 供应商品类（给候选做过滤）。两页原来各写一份且不一致，合成一份并补上后加的品类 */
const PART_CATEGORY_RULES: Array<[RegExp, string]> = [
  [/胶辊/, '胶辊'],
  [/辊|卷筒|齿轮/, '辊类件'],
  [/轴承/, '轴承'],
  [/液压缸|油缸/, '液压缸'],
  [/阀门|球阀|闸阀|蝶阀/, '工业阀门'],
  [/液压|阀/, '液压'],
  [/气动|气缸/, '气动'],
  [/减速/, '减速机'],
  [/电机|马达/, '电机'],
  [/刀/, '刀片'],
  [/联轴/, '联轴器'],
  [/密封/, '密封'],
  [/仪表|传感器|检测|测量|测张|编码器|接近开关/, '仪表'],
  [/电气|控制|电缆|操作台/, '电气'],
  [/焊接件|焊结构|机架/, '焊结构件'],
  [/铸|锻/, '铸锻件'],
  [/加工/, '机加工'],
  [/紧固|螺栓|标准件/, '标准件'],
  [/传动|链/, '传动'],
]

export const categoryOfPart = (part: string, categories?: string[]): string | undefined => {
  for (const [re, cat] of PART_CATEGORY_RULES) {
    if (re.test(part) && (!categories || categories.includes(cat))) return cat
  }
  // 配件名本身就是一个品类（如「减速机」「轴承」）
  return categories?.find((c) => c.length >= 2 && part.includes(c))
}

/** 同名配件在两份清单里用过哪些厂家（按次数降序）：选型时最可能复用的放最前 */
export function suppliersUsedForPart(part: string, eqBom?: StoredBom, spareBom?: StoredBom): string[] {
  const p = part.trim()
  if (!p) return []
  const count = new Map<string, number>()
  for (const bom of [eqBom, spareBom]) {
    for (const items of Object.values(bom || {})) {
      for (const it of Array.isArray(items) ? items : []) {
        if (rowPart(it).trim() !== p) continue
        for (const s of rowSuppliers(it)) count.set(s, (count.get(s) || 0) + 1)
      }
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s)
}

/**
 * 某行的供应商候选：同名配件用过的厂家 → 同品类厂家 → 其余（品类没匹配上时）。
 * used 里的名字在名册中不存在的不出现（名册外的名字由「不在名册」标签提示）。
 */
export function rankCandidates(part: string, pool: any[], eqBom?: StoredBom, spareBom?: StoredBom) {
  const cat = categoryOfPart(part)
  const byName = new Map(pool.map((s) => [s.name, s]))
  const used = suppliersUsedForPart(part, eqBom, spareBom).map((n) => byName.get(n)).filter(Boolean)
  const usedSet = new Set(used.map((s: any) => s.name))
  const sameCat = cat ? pool.filter((s) => !usedSet.has(s.name) && (s.productCategories || []).includes(cat)) : []
  const rest = sameCat.length ? [] : pool.filter((s) => !usedSet.has(s.name))
  return { cat, usedCount: used.length, list: [...used, ...sameCat, ...rest] }
}

// ── 打错字自动入册的厂家清理 ──

/**
 * 本次打开页面以来「输入时自动加入名册」的厂家。
 * 只有这些才可能是打错字的垃圾记录；从外购件清单导入的、在供应管理里建的厂家，
 * 即使没填联系人也是正式资料，绝不能因为在某一行被 × 掉就从名册删除（删除会连带删掉它的供应产品与报价）。
 */
const autoCreated = new Set<string>()
export const markAutoCreated = (name: string) => autoCreated.add(name)

/**
 * × 掉供应商后的名册清理：仅当 ① 本次自动入册 ② 两份清单都不再引用 ③ 名册里是裸记录（无品类/联系人/电话/邮箱）
 * ④ 没有任何供应产品 —— 全部满足才删。两份清单从服务器现读，不用页面缓存（另一页签可能刚改过）。
 * currentEquip/currentRows：当前页面正在编辑、可能还没自动保存的那台设备的最新行。
 */
export async function cleanupAutoCreatedSupplier(
  name: string,
  current: { source: 'equipment' | 'spare'; equipment: string; rows: Array<{ suppliers: string[] }> },
): Promise<boolean> {
  if (!autoCreated.has(name)) return false
  const [eq, spare] = await Promise.all([readConfigJson<StoredBom>('equipment_bom'), readConfigJson<StoredBom>('spare_parts_bom')])
  const usedIn = (bom: StoredBom | undefined, mine: boolean) =>
    Object.entries(bom || {}).some(([equip, items]) => {
      const list: any[] = mine && equip === current.equipment ? current.rows : Array.isArray(items) ? items : []
      return list.some((it) => rowSuppliers(it).includes(name))
    })
  if (usedIn(eq, current.source === 'equipment') || usedIn(spare, current.source === 'spare')) return false
  if (current.rows.some((r) => r.suppliers.includes(name))) return false
  const list: any = await supplierApi.list({ keyword: name, pageSize: 10 })
  const hit = toList<any>(list).find((x) => x.name === name)
  if (!hit) return false
  const bare = !(hit.productCategories || []).length && !hit.contactName && !hit.phone && !hit.email
  if (!bare) return false
  const products = toList<any>(await supplierProductApi.list({ supplierId: hit.id, pageSize: 1 }))
  if (products.length) return false
  await supplierApi.remove(hit.id)
  autoCreated.delete(name)
  return true
}
