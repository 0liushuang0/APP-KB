import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, Download, Package, GripVertical, Pencil, Copy, FileSpreadsheet, FileText } from 'lucide-react'
import { supplierApi, systemConfigApi } from '../api/services'
import { toList } from '../utils/apiList'
import { groupByProfession, resolveProfession, professionOfPart, PROFESSIONS, moveItem } from '../utils/profession'
import { useProfessionNames } from '../hooks/useProfessionNames'
import { exportSheetsToExcel, exportSectionsToWordDocx, stamp } from '../utils/export-sheet'
import Button from '../components/Button'
import Modal from '../components/Modal'
import PageLoader from '../components/PageLoader'

/**
 * 备件管理：按设备维护备件清单（供应管理第 4 个页签）。
 *
 * 维度：
 * · 设备（拉矫机/圆盘剪/碎边剪…，与「设备配套」共享设备清单）
 * · 专业分组（机械/液压/电气/仪表，按备件名自动归类）
 * · 备件类型（调试备件 / 2年期备件）——可筛选
 *
 * 持久化：system_configs('spare_parts_bom')，自动保存
 * （与设备配套同一套防丢守卫：未就绪不写、载入重放不写、切换即落盘）。
 */

const SPARE_TYPES = ['调试备件', '2年期备件'] as const
type SpareType = (typeof SPARE_TYPES)[number]

interface SpareRow {
  key: string
  part: string
  /** 专业：空=按名称自动判定；可手动指定（与设备配套同口径） */
  profession: '' | '机械' | '液压' | '电气' | '仪表' | '其他'
  spareType: SpareType
  suppliers: string[]
  note: string
}

type StoredSpare = Partial<Omit<SpareRow, 'spareType' | 'suppliers'> & { spareType?: string; suppliers?: string[] }>
type StoredSpareBom = Record<string, StoredSpare[]>

let rowSeq = 0
const newSpare = (part = '', spareType: SpareType = '调试备件'): SpareRow => ({
  key: `s${++rowSeq}`,
  part,
  profession: '',
  spareType,
  suppliers: [],
  note: '',
})

const toSpareRow = (v: StoredSpare): SpareRow => ({
  ...newSpare(),
  ...v,
  // 行 key 持久化复用：防自动保存重放打断输入（同设备配套）
  key: (v as any).key || `s${++rowSeq}`,
  spareType: (SPARE_TYPES as readonly string[]).includes(v.spareType || '') ? (v.spareType as SpareType) : '调试备件',
  suppliers: v.suppliers ?? [],
})

/** 备件名 → 供应商品类（供应商提示过滤用，同设备配套的关键词规则） */
const PART_CATEGORY_RULES: Array<[RegExp, string]> = [
  [/辊|卷筒|齿轮/, '辊类件'],
  [/轴承/, '轴承'],
  [/液压缸|油缸/, '液压缸'],
  [/液压|密封|阀/, '液压'],
  [/减速/, '减速机'],
  [/电机|马达/, '电机'],
  [/刀/, '刀片'],
  [/联轴/, '联轴器'],
  [/密封/, '密封'],
  [/电气|控制|电缆|操作台/, '电气'],
  [/仪表|传感器|检测|测量|编码器|接近开关/, '仪表'],
  [/机架|铸|锻|焊接/, '铸锻件'],
  [/紧固|螺栓|标准件/, '标准件'],
]
const categoryOfPart = (part: string): string | undefined => {
  const hit = PART_CATEGORY_RULES.find(([re]) => re.test(part))
  return hit ? hit[1] : undefined
}

export default function SpareParts() {
  const queryClient = useQueryClient()
  const [equipment, setEquipment] = useState('')
  const [rows, setRows] = useState<SpareRow[]>([])
  const [typeFilter, setTypeFilter] = useState<'' | SpareType>('')
  const [customEquip, setCustomEquip] = useState('')
  const [exportSelected, setExportSelected] = useState<Set<string>>(new Set())
  /** 专业组显示名（与设备配套共享改名）与组名编辑态 */
  const { displayName, rename: renameProfession } = useProfessionNames()
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  /** 从其他设备复制备件的弹窗 */
  const [copyOpen, setCopyOpen] = useState(false)
  const [copySource, setCopySource] = useState('')
  /** 拖拽排序（同设备配套：拖动手柄，目标行接收 drop） */
  const dragKeyRef = useRef<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const onDropRow = (targetKey: string) => {
    const src = dragKeyRef.current
    dragKeyRef.current = null
    setDragOverKey(null)
    if (!src || src === targetKey) return
    setRows((prev) => {
      const from = prev.findIndex((r) => r.key === src)
      const to = prev.findIndex((r) => r.key === targetKey)
      return moveItem(prev, from, to)
    })
  }

  // 备件配置
  const { data: spareBom } = useQuery({
    queryKey: ['spare-parts-bom'],
    queryFn: async () => {
      try {
        const res: any = await systemConfigApi.get('spare_parts_bom')
        const raw = typeof res === 'string' ? res : res?.value || res?.data?.value
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) return parsed as StoredSpareBom
        }
      } catch {
        /* 未配置 */
      }
      return {} as StoredSpareBom
    },
    staleTime: 5 * 60_000,
  })

  // 设备清单：与「设备配套」共享（equipment_bom 的键）∪ 备件配置里出现过的设备
  const { data: equipmentBomKeys } = useQuery({
    queryKey: ['equipment-bom-names-for-spare'],
    queryFn: async () => {
      try {
        const res: any = await systemConfigApi.get('equipment_bom')
        const raw = typeof res === 'string' ? res : res?.value || res?.data?.value
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) return Object.keys(parsed)
        }
      } catch {
        /* 未配置 */
      }
      return ['拉弯矫直机', '圆盘剪', '碎边剪', '开卷机', '卷取机', '升降机', '联轴器']
    },
    staleTime: 5 * 60_000,
  })
  const equipmentNames = useMemo(
    () => [...new Set([...(equipmentBomKeys || []), ...Object.keys(spareBom || {})])],
    [equipmentBomKeys, spareBom],
  )

  useEffect(() => {
    if (!equipment && equipmentNames.length) setEquipment(equipmentNames[0])
  }, [equipmentNames, equipment])

  // 供应商池
  const { data: supplierPool } = useQuery({
    queryKey: ['spare-parts-suppliers'],
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

  // 载入（配置未就绪不置空，防清库）
  const skipNextSaveRef = useRef(false)
  const lastLoadedEquipRef = useRef<string | null>(null)
  useEffect(() => {
    if (spareBom === undefined) return
    // 自动保存回写的 refetch 不重放（同设备配套：防打字间隙覆盖输入）
    if (lastLoadedEquipRef.current === equipment) return
    lastLoadedEquipRef.current = equipment
    const stored = (spareBom as StoredSpareBom)?.[equipment]
    const next = (stored || []).map(toSpareRow)
    skipNextSaveRef.current = true
    setRows(next)
    setExportSelected(new Set(next.map((r) => r.key)))
  }, [equipment, spareBom])

  const persistBom = async (next: StoredSpareBom, quiet = false) => {
    try {
      bomRef.current = next
      await systemConfigApi.set({
        key: 'spare_parts_bom',
        value: JSON.stringify(next),
        category: 'supplier',
        description: '备件清单（按设备，含专业/备件类型/供应商）',
      })
      queryClient.invalidateQueries({ queryKey: ['spare-parts-bom'] })
      if (!quiet) toast.success('已保存')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '保存失败')
    }
  }

  // 自动保存（三重守卫，同设备配套）
  const bomRef = useRef<StoredSpareBom | undefined>(undefined)
  useEffect(() => { bomRef.current = spareBom }, [spareBom])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistCurrent = async (rs: SpareRow[], equip: string) => {
    if (!bomRef.current || !Object.prototype.hasOwnProperty.call(bomRef.current, equip)) return
    const stripped = rs.map((r) => ({ ...r }))
    await persistBom({ ...bomRef.current, [equip]: stripped }, true)
  }
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      if (skipNextSaveRef.current) return
      await persistCurrent(rows, equipment)
    }, 600)
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        if (!skipNextSaveRef.current) persistCurrent(rows, equipment)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, equipment])

  const setCell = (key: string, patch: Partial<SpareRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  /** 追加供应商：名册里没有的自动创建到供应管理（与设备配套同口径） */
  const addSupplier = async (row: SpareRow, name: string) => {
    const v = name.trim()
    if (!v || row.suppliers.includes(v)) return
    setCell(row.key, { suppliers: [...row.suppliers, v] })
    const hit = (supplierPool || []).find((s) => s.name === v)
    if (!hit) {
      try {
        await supplierApi.create({ name: v })
        queryClient.invalidateQueries({ queryKey: ['spare-parts-suppliers'] })
        queryClient.invalidateQueries({ queryKey: ['suppliers'] })
        toast.success(`「${v}」不在供应管理，已自动加入厂家名册`)
      } catch (e: any) {
        toast.error(`「${v}」加入供应管理失败：${e?.response?.data?.message || e?.message || '未知原因'}`)
      }
    }
  }
  const removeSupplier = (row: SpareRow, name: string) => {
    const nextRows = rows.map((r) => (r.key === row.key ? { ...r, suppliers: r.suppliers.filter((s) => s !== name) } : r))
    setRows(nextRows)
    void cleanupBareSupplier(name, nextRows)
  }

  /** × 掉后：两份配置都无引用且名册为裸记录 → 自动移出供应管理（同设备配套） */
  const cleanupBareSupplier = async (name: string, currentRows?: SpareRow[]) => {
    try {
      const stillUsed = Object.entries(spareBom || {}).some(([equip, items]) => {
        const list = equip === equipment ? (currentRows as any) : items
        return (Array.isArray(list) ? list : []).some((it: any) => Array.isArray(it?.suppliers) && it.suppliers.includes(name))
      })
      if (stillUsed) return
      const eqRaw: any = await systemConfigApi.get('equipment_bom')
      const eqParsed = typeof eqRaw === 'string' ? JSON.parse(eqRaw) : JSON.parse(eqRaw?.value || eqRaw?.data?.value || '{}')
      const eqUsed = Object.values(eqParsed || {}).some((items: any) =>
        (Array.isArray(items) ? items : []).some((it: any) => Array.isArray(it?.suppliers) && it.suppliers.includes(name)),
      )
      if (eqUsed) return
      const list: any = await supplierApi.list({ keyword: name, pageSize: 10 })
      const hit = toList<any>(list).find((x) => x.name === name)
      if (!hit) return
      const bare = !(hit.productCategories || []).length && !hit.contactName && !hit.phone && !hit.email
      if (!bare) return
      await supplierApi.remove(hit.id)
      queryClient.invalidateQueries({ queryKey: ['spare-parts-suppliers'] })
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      toast.info(`「${name}」已不再被引用，且名册里无资料，已同步移出供应管理`)
    } catch {
      /* 清理失败不打扰用户 */
    }
  }

  /** 组内添加：新行直接落在本专业组 */
  const addRowInGroup = (profession: string) => {
    const r: SpareRow = { ...newSpare('', typeFilter || '调试备件'), profession: profession as SpareRow['profession'] }
    setExportSelected((s2) => new Set(s2).add(r.key))
    setRows((prev) => [...prev, r])
  }

  const candidatesOf = (part: string) => {
    const cat = categoryOfPart(part)
    const pool = supplierPool || []
    const filtered = cat ? pool.filter((s) => (s.productCategories || []).includes(cat)) : []
    return { cat, list: filtered.length ? filtered : pool }
  }

  const addCustomEquipment = async () => {
    const name = customEquip.trim()
    if (!name) return
    if (equipmentNames.includes(name)) {
      setEquipment(name)
      setCustomEquip('')
      return
    }
    await persistBom({ ...(bomRef.current || {}), [name]: [] }, true)
    setRows([newSpare(), newSpare()])
    setEquipment(name)
    setCustomEquip('')
    toast.info(`新设备「${name}」：请添加备件行，内容会自动保存`)
  }

  /** 筛选后的行（备件类型筛选影响显示与导出，不影响存储） */
  const visibleRows = useMemo(
    () => (typeFilter ? rows.filter((r) => r.spareType === typeFilter) : rows),
    [rows, typeFilter],
  )

  /** 勾选且有效的行（各导出入口共用） */
  const selectedFilled = () => visibleRows.filter((r) => exportSelected.has(r.key) && r.part.trim())
  const typeSuffix = typeFilter ? `（${typeFilter}）` : ''

  /** 导出 Excel：全部勾选行一个工作表（含专业/备件类型列） */
  const exportExcel = async () => {
    const filled = selectedFilled()
    if (!filled.length) return toast.warning('请先勾选要导出的备件行')
    await exportSheetsToExcel(
      [
        {
          name: '备件清单',
          header: ['序号', '备件名称', '专业', '备件类型', '供应商', '备注'],
          rows: filled.map((r, i) => [i + 1, r.part, resolveProfession(r), r.spareType, r.suppliers.join('、'), r.note]),
        },
      ],
      `${equipment}_备件清单${typeFilter || ''}_${stamp()}.xlsx`,
    )
    toast.success(`已导出 ${filled.length} 行备件（Excel 单表）`)
  }

  /** 导出 Word：单文件按专业分小节，可直接复制进技术附件 */
  const exportWord = () => {
    const filled = selectedFilled()
    if (!filled.length) return toast.warning('请先勾选要导出的备件行')
    exportSectionsToWordDocx(
      `${equipment} 备件清单${typeSuffix}（导出日期 ${new Date().toLocaleDateString('zh-CN')}）`,
      groupByProfession(filled).map((g) => ({
        name: `${displayName(g.profession)}类备件 (${g.items.length})`,
        header: ['序号', '备件名称', '备件类型', '供应商', '备注'],
        rows: g.items.map((r, i) => [i + 1, r.part, r.spareType, r.suppliers.join('、'), r.note]),
      })),
      `${equipment}_备件清单${typeFilter || ''}_${stamp()}.doc`,
    )
    toast.success(`已导出 Word（含 ${groupByProfession(filled).length} 个专业分组）`)
  }

  /** 分专业导出 Excel：一个工作簿、每专业一个工作表 */
  const exportByProfession = async () => {
    const filled = selectedFilled()
    if (!filled.length) return toast.warning('请先勾选要导出的备件行')
    const groups = groupByProfession(filled)
    await exportSheetsToExcel(
      groups.map((g) => ({
        name: displayName(g.profession),
        header: ['序号', '备件名称', '备件类型', '供应商', '备注'],
        rows: g.items.map((r, i) => [i + 1, r.part, r.spareType, r.suppliers.join('、'), r.note]),
      })),
      `${equipment}_分专业备件表_${stamp()}.xlsx`,
    )
    toast.success(`已导出 1 个 Excel（${groups.map((g) => `${displayName(g.profession)}(${g.items.length})`).join('、')} 各一个工作表）`)
  }

  /** 从其他设备复制备件清单：整表带入后局部修改 */
  const copyFrom = (source: string) => {
    const stored = (spareBom as StoredSpareBom | undefined)?.[source]
    if (!stored || !stored.length) {
      toast.warning(`「${source}」还没有备件行，无可复制`)
      return
    }
    const rekeyed = stored.map((v) => toSpareRow(v))
    setRows(rekeyed)
    setExportSelected(new Set(rekeyed.map((r) => r.key)))
    setCopyOpen(false)
    toast.success(`已从「${source}」复制 ${rekeyed.length} 行备件，可直接局部修改`)
  }

  return (
    <div className="space-y-4">
      {/* 设备选择 + 筛选 + 操作 */}
      <div className="eo-card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block eo-label mb-1.5">选择设备</label>
          <select
            value={equipment}
            onChange={(e) => setEquipment(e.target.value)}
            className="eo-input !w-48 !py-1.5 !text-sm"
            aria-label="选择设备"
          >
            {equipmentNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-1.5">
          <div>
            <label className="block eo-label mb-1.5">或输入自定义设备</label>
            <input
              value={customEquip}
              onChange={(e) => setCustomEquip(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomEquipment()}
              placeholder="例：酸洗线"
              className="eo-input !w-40 !py-1.5 !text-sm"
            />
          </div>
          <Button variant="secondary" size="sm" className="!py-1.5" onClick={addCustomEquipment}>使用</Button>
        </div>
        <div>
          <label className="block eo-label mb-1.5">备件类型</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as '' | SpareType)}
            className="eo-input !w-32 !py-1.5 !text-sm"
            aria-label="按备件类型筛选"
          >
            <option value="">全部类型</option>
            {SPARE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="flex-1" />
        <Button variant="secondary" size="sm" className="!py-1.5" onClick={() => { setCopySource(''); setCopyOpen(true) }} title="把其他设备的备件清单复制到当前设备，再做局部修改">
          <Copy size={13} className="mr-0.5" /> 从其他设备复制
        </Button>
        <Button size="sm" className="!py-1.5" onClick={exportExcel} title="全部勾选行导出为一个 Excel（含专业/备件类型列）">
          <FileSpreadsheet size={13} className="mr-0.5" /> 导出 Excel
        </Button>
        <Button variant="secondary" size="sm" className="!py-1.5" onClick={exportWord} title="导出为 Word 文档（按专业分小节）">
          <FileText size={13} className="mr-0.5" /> 导出 Word
        </Button>
        <Button variant="secondary" size="sm" className="!py-1.5" onClick={exportByProfession} title="一个 Excel，每个专业各一个工作表">
          <Download size={13} className="mr-0.5" /> 分专业导出
        </Button>
      </div>

      {/* 从其他设备复制备件 */}
      <Modal
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title={`复制备件到「${equipment || '…'}」`}
        size="sm"
        cancelText="取消"
        onConfirm={() => copySource && copyFrom(copySource)}
        confirmText="复制"
        confirmDisabled={!copySource || copySource === equipment}
      >
        <p className="text-sm text-muted mb-3">选择来源设备，其全部备件行（含类型/专业/供应商）将替换当前设备的清单，复制后可直接局部修改：</p>
        <select value={copySource} onChange={(e) => setCopySource(e.target.value)} className="eo-input !py-1.5 !text-sm w-full" aria-label="来源设备">
          <option value="">— 选择来源设备 —</option>
          {equipmentNames.filter((n) => n !== equipment).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        {copySource && copySource !== equipment && (
          <p className="text-caption text-muted mt-2">「{copySource}」现有 {((spareBom as StoredSpareBom | undefined)?.[copySource] || []).length} 行备件</p>
        )}
      </Modal>

      {/* 备件清单（按专业分组） */}
      <div className="eo-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5">
            <Package size={15} className="text-accent-600" />
            {equipment} · 备件清单{typeFilter ? `（${typeFilter}）` : ''}
          </h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={visibleRows.length > 0 && visibleRows.every((r) => exportSelected.has(r.key))}
                onChange={(e) => setExportSelected(e.target.checked ? new Set(visibleRows.map((r) => r.key)) : new Set())}
                className="accent-emerald-600"
              />
              全选（导出范围）
            </label>
            <button
              onClick={() => {
                const r = newSpare('', typeFilter || '调试备件')
                setExportSelected((s) => new Set(s).add(r.key))
                setRows((prev) => [...prev, r])
              }}
              className="text-xs text-accent-600 hover:text-accent-700 flex items-center gap-0.5"
            >
              <Plus size={13} /> 添加备件行
            </button>
          </div>
        </div>
        {!supplierPool ? (
          <PageLoader />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-caption text-muted border-b border-border">
                  <th className="py-2 w-6 font-normal" title="拖动调整顺序" />
                  <th className="py-2 pr-2 w-8 font-normal">☑</th>
                  <th className="py-2 pr-2 w-10 font-normal">序号</th>
                  <th className="py-2 pr-2 font-normal">备件名称</th>
                  <th className="py-2 pr-2 w-28 font-normal">专业分类</th>
                  <th className="py-2 pr-2 w-32 font-normal">备件类型</th>
                  <th className="py-2 pr-2 font-normal">供应商（输入提示该品类厂家）</th>
                  <th className="py-2 pr-2 w-40 font-normal">备注</th>
                  <th className="py-2 w-8 font-normal" />
                </tr>
              </thead>
              <tbody>
                {groupByProfession(visibleRows).map((g) => (
                  <GroupFragment
                    key={g.profession}
                    profession={g.profession}
                    items={g.items}
                    rows={rows}
                    exportSelected={exportSelected}
                    setExportSelected={setExportSelected}
                    setCell={setCell}
                    setRows={setRows}
                    candidatesOf={candidatesOf}
                    addSupplier={addSupplier}
                    removeSupplier={removeSupplier}
                    dragState={{ dragOverKey, setDragOver: setDragOverKey, drop: onDropRow, dragRef: dragKeyRef }}
                    groupNaming={{ displayName, editingGroup, setEditingGroup, rename: renameProfession }}
                    addRowInGroup={addRowInGroup}
                  />
                ))}
                {!visibleRows.length && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-sm text-muted">
                      {rows.length ? '当前类型筛选下没有备件' : '该设备还没有备件行，点「添加备件行」逐行录入，内容会自动保存'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-caption text-muted mt-3">
          备件按名称自动归入 机械/液压/电气/仪表 专业组（可在行内手动改组，组名可改名）；备件类型区分调试备件与 2 年期备件可筛选；供应商支持多选，手柄可拖动排序。清单自动保存，设备与「设备配套」共享。
        </p>
      </div>
    </div>
  )
}

/** 专业分组渲染（拆出主组件避免单函数过长） */
function GroupFragment({
  profession, items, exportSelected, setExportSelected, setCell, setRows, candidatesOf, addSupplier, removeSupplier, dragState, groupNaming, addRowInGroup,
}: any) {
  return (
    <>
      <tr className="bg-subtle">
        <td colSpan={9} className="py-1.5 px-2">
          <span className="text-xs font-semibold text-accent-700">
            {groupNaming.displayName(profession)}类备件 ({items.length})
          </span>
          <button
            onClick={() => groupNaming.setEditingGroup(profession)}
            className="ml-1.5 text-muted hover:text-accent-600 align-middle p-0.5"
            title="修改本组显示名称"
            aria-label={`改名 ${profession}组`}
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={() => addRowInGroup(profession)}
            className="ml-2 text-xs text-accent-600 hover:text-accent-700 inline-flex items-center gap-0.5"
            title={`在${groupNaming.displayName(profession)}组内添加备件行`}
          >
            <Plus size={12} /> 组内添加
          </button>
          {groupNaming.editingGroup === profession && (
            <span className="inline-flex items-center gap-1 ml-2">
              <input
                autoFocus
                defaultValue={groupNaming.displayName(profession)}
                className="eo-input !py-0.5 !text-xs !w-24"
                aria-label="组的新名称"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { groupNaming.rename(profession, (e.target as HTMLInputElement).value); groupNaming.setEditingGroup(null) }
                  if (e.key === 'Escape') groupNaming.setEditingGroup(null)
                }}
                onBlur={(e) => { groupNaming.rename(profession, e.target.value); groupNaming.setEditingGroup(null) }}
              />
              <span className="text-caption text-muted">回车保存 / Esc 取消</span>
            </span>
          )}
        </td>
      </tr>
      {items.map((r: SpareRow, i: number) => {
        const { cat, list } = candidatesOf(r.part)
        return (
          <tr
            key={r.key}
            className={`border-b border-divider hover:bg-canvas/60 ${dragState.dragOverKey === r.key ? 'outline outline-2 outline-accent-400' : ''}`}
            onDragOver={(e) => { e.preventDefault(); dragState.setDragOver(r.key) }}
            onDragLeave={() => dragState.setDragOver((k: string | null) => (k === r.key ? null : k))}
            onDrop={(e) => { e.preventDefault(); dragState.drop(r.key) }}
          >
            <td className="py-1.5 pr-0 w-6" title="拖动调整上下顺序">
              <span
                draggable
                onDragStart={(e) => {
                  dragState.dragRef.current = r.key
                  const tr = (e.currentTarget as HTMLElement).closest('tr')
                  if (tr && e.dataTransfer) e.dataTransfer.setDragImage(tr, 24, 12)
                }}
                onDragEnd={() => dragState.setDragOver(null)}
                className="text-muted/70 hover:text-ink inline-flex cursor-grab active:cursor-grabbing"
                aria-label={`拖动 ${r.part || '该行'}`}
              >
                <GripVertical size={14} />
              </span>
            </td>
            <td className="py-1.5 pr-2 w-8">
              <input
                type="checkbox"
                checked={exportSelected.has(r.key)}
                onChange={() =>
                  setExportSelected((prev: Set<string>) => {
                    const next = new Set(prev)
                    if (next.has(r.key)) next.delete(r.key)
                    else next.add(r.key)
                    return next
                  })
                }
                className="accent-emerald-600"
                aria-label={`导出行 ${r.part || i + 1}`}
                title="勾选/取消导出该行"
              />
            </td>
            <td className="py-1.5 pr-2 text-muted tabular-nums">{i + 1}</td>
            <td className="py-1.5 pr-2">
              <input
                value={r.part}
                onChange={(e: any) => setCell(r.key, { part: e.target.value })}
                className="eo-input !py-1 !text-sm !border-transparent hover:!border-border focus:!border-accent-400 !w-44"
                placeholder="备件名称"
              />
            </td>
            <td className="py-1.5 pr-2">
              {/* 专业分类：默认自动判定，可手动改组（与设备配套同口径） */}
              <select
                value={r.profession || ''}
                onChange={(e: any) => setCell(r.key, { profession: e.target.value })}
                className="eo-input !py-1 !text-xs w-full"
                aria-label={`专业分类 ${r.part}`}
                title="手动指定专业分组"
              >
                <option value="">自动·{professionOfPart(r.part)}</option>
                {PROFESSIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </td>
            <td className="py-1.5 pr-2">
              <select
                value={r.spareType}
                onChange={(e: any) => setCell(r.key, { spareType: e.target.value })}
                className="eo-input !py-1 !text-xs w-full"
                aria-label="备件类型"
              >
                {SPARE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </td>
            <td className="py-1.5 pr-2">
              <div className="flex flex-wrap items-center gap-1 min-w-48">
                {r.suppliers.map((sup: string) => (
                  <span key={sup} className="inline-flex items-center gap-1 text-xs pl-1.5 pr-0.5 py-0.5 rounded bg-accent-50 text-accent-700 border border-accent-200">
                    {sup}
                    <button
                      onClick={() => removeSupplier(r, sup)}
                      className="text-accent-600 hover:text-danger-fg p-0.5 leading-none"
                      title={`移除 ${sup}`}
                      aria-label={`移除供应商 ${sup}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  list={`spare-sup-${r.key}`}
                  className="eo-input !py-0.5 !text-xs !border-transparent hover:!border-border focus:!border-accent-400 flex-1 min-w-28"
                  placeholder={r.suppliers.length ? '继续添加…' : cat ? `按「${cat}」提示厂家` : '输入提示厂家'}
                  onKeyDown={(e: any) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const v = e.target.value.trim()
                      if (v) { addSupplier(r, v); e.target.value = '' }
                    }
                  }}
                  onBlur={(e: any) => {
                    const v = e.target.value.trim()
                    if (v) { addSupplier(r, v); e.target.value = '' }
                  }}
                />
                <datalist id={`spare-sup-${r.key}`}>
                  {list.slice(0, 100).map((s: any) => (
                    <option key={s.id} value={s.name}>
                      {[s.contactName, s.phone].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </datalist>
              </div>
            </td>
            <td className="py-1.5 pr-2">
              <input value={r.note} onChange={(e: any) => setCell(r.key, { note: e.target.value })} className="eo-input !py-1 !text-xs !border-transparent hover:!border-border w-full" placeholder="型号/数量建议等" />
            </td>
            <td className="py-1.5">
              <button
                onClick={() => setRows((prev: SpareRow[]) => prev.filter((x) => x.key !== r.key))}
                className="text-muted hover:text-danger-fg p-1"
                title="删除该行"
                aria-label="删除行"
              >
                <Trash2 size={14} />
              </button>
            </td>
          </tr>
        )
      })}
    </>
  )
}
