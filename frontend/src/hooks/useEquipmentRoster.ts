import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { systemConfigApi } from '../api/services'
import {
  DEFAULT_EQUIPMENT_BOM,
  QK_EQUIPMENT_BOM,
  QK_OUTSOURCING_BOM,
  QK_SPARE_BOM,
  readConfigJson,
  useEquipmentBom,
  useOutsourcingBom,
  useSpareBom,
  type StoredBom,
} from './useSupplyData'

/**
 * 设备名册的改名 / 删除（供「管理设备」弹窗用），设备配套 / 备件管理 / 外协加工三个页签共用。
 *
 * 此前这套逻辑只写在设备配套页里：改名/删设备只能在那一个页签操作，备件管理、外协加工
 * 既没有入口、也不知道自己的数据会不会被落下（改名只同步了备件，外协是后加的第 5 个页签，
 * 完全没跟上）。抽成一个 hook 后，三个页签都能挂同一个「管理设备」弹窗，行为（包括改名
 * 同步三份清单、删除前提示另外两份清单各留了多少行）完全一致。
 *
 * 设备名册以 equipment_bom 的键为准（即「设备配套」页列出的设备）；备件清单 / 外协配置里
 * 单独出现过的设备名（尚未在设备配套登记）不算在管理范围内，调用方按需自行并入显示列表。
 */
export function useEquipmentRoster() {
  const queryClient = useQueryClient()
  const { data: bomConfig } = useEquipmentBom()
  const { data: spareBom } = useSpareBom()
  const { data: outBom } = useOutsourcingBom()

  const equipmentNames = [...new Set(Object.keys(bomConfig || {}))]

  const persistEquipmentBom = async (next: StoredBom) => {
    await systemConfigApi.set({
      key: 'equipment_bom',
      value: JSON.stringify(next),
      category: 'supplier',
      description: '设备配套选型（配件与供应商，按设备持久化）',
    })
    queryClient.invalidateQueries({ queryKey: QK_EQUIPMENT_BOM })
  }

  /** 备件清单 / 外协配置都按设备名分组存储，改名时要同步，否则数据挂在旧名下找不到 */
  const syncBomRenames = async (
    key: 'spare_parts_bom' | 'outsourcing_bom',
    queryKey: readonly unknown[],
    description: string,
    edits: Array<{ from: string; to: string }>,
  ) => {
    const bom = await readConfigJson<Record<string, unknown[]>>(key)
    if (!bom || !edits.some((e) => Object.prototype.hasOwnProperty.call(bom, e.from))) return 0
    const next: Record<string, unknown[]> = {}
    let moved = 0
    for (const [k, v] of Object.entries(bom)) {
      const e = edits.find((x) => x.from === k)
      if (e) moved++
      const to = e ? e.to : k
      next[to] = [...(next[to] || []), ...(Array.isArray(v) ? v : [])]
    }
    await systemConfigApi.set({ key, value: JSON.stringify(next), category: 'supplier', description })
    queryClient.invalidateQueries({ queryKey: queryKey as any })
    return moved
  }
  const syncSpareRenames = (edits: Array<{ from: string; to: string }>) =>
    syncBomRenames('spare_parts_bom', QK_SPARE_BOM, '备件清单（按设备，含专业/备件类型/供应商）', edits)
  const syncOutsourcingRenames = (edits: Array<{ from: string; to: string }>) =>
    syncBomRenames('outsourcing_bom', QK_OUTSOURCING_BOM, '外协加工（配件供应方式+工序外协明细）', edits)

  /** 批量改名（管理弹窗「保存修改」一次提交多项） */
  const renameEquipments = async (edits: Array<{ from: string; to: string }>) => {
    if (!edits.length) return { synced: [] as string[] }
    const bom: StoredBom = {}
    equipmentNames.forEach((name) => {
      const e = edits.find((x) => x.from === name)
      const to = e ? e.to.trim() : name
      bom[to] = (bomConfig as StoredBom)?.[name] ?? DEFAULT_EQUIPMENT_BOM[name] ?? []
    })
    await persistEquipmentBom(bom)
    const movedSpare = await syncSpareRenames(edits).catch(() => 0)
    const movedOut = await syncOutsourcingRenames(edits).catch(() => 0)
    const synced = [movedSpare ? '备件清单' : '', movedOut ? '外协加工' : ''].filter(Boolean)
    return { synced }
  }

  /** 单个改名（行尾铅笔 / 回车） */
  const renameEquipment = async (from: string, to: string) => {
    const name = to.trim()
    if (!name || name === from) return { ok: false as const }
    if (equipmentNames.includes(name) && name !== from) {
      toast.error(`已有同名设备「${name}」`)
      return { ok: false as const }
    }
    const { synced } = await renameEquipments([{ from, to: name }])
    toast.success(`已改名：${from} → ${name}${synced.length ? `（${synced.join('/')}同步改名）` : ''}`)
    return { ok: true as const, to: name }
  }

  /** 删除前另外两份清单各留了多少行（用于确认弹窗提示，不阻止删除） */
  const keptElsewhere = (name: string) => ({
    spareCount: (spareBom?.[name] || []).length,
    outCount: (outBom?.[name] || []).length,
  })

  const removeEquipment = async (name: string) => {
    const bom = { ...(bomConfig as StoredBom) }
    delete bom[name]
    await persistEquipmentBom(bom)
    toast.success(`已删除设备「${name}」`)
  }

  return {
    equipmentNames,
    bomConfig: bomConfig as StoredBom | undefined,
    renameEquipment,
    renameEquipments,
    removeEquipment,
    keptElsewhere,
  }
}
