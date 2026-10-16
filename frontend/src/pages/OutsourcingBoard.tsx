import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useSearchParams } from 'react-router-dom'
import { Plus, Trash2, Download, Factory, Settings2, Save, Wrench, Tags, LayoutGrid, ListChecks, CircleAlert, BadgeAlert } from 'lucide-react'
import { supplierApi, systemConfigApi } from '../api/services'
import {
  QK_OUTSOURCING_BOM,
  QK_SUPPLIER_POOL,
  cleanupAutoCreatedSupplier,
  markAutoCreated,
  rowPart,
  rowSuppliers,
  useEquipmentBom,
  useOutsourcingBom,
  useSpareBom,
  useSupplierPool,
} from '../hooks/useSupplyData'
import { exportSheetsToExcel, exportSectionsToWordDocx, stamp } from '../utils/export-sheet'
import { deleteRowWithUndo } from '../utils/rowUndo'
import Button from '../components/Button'
import Modal from '../components/Modal'
import EquipmentManagerModal from '../components/EquipmentManagerModal'
import PageLoader from '../components/PageLoader'
import StatCards from '../components/StatCards'
import ToolbarDivider from '../components/ToolbarDivider'
import SupplierCandidateInput from '../components/SupplierCandidateInput'

/**
 * 外协加工（供应管理第 5 个页签）——按“供应方式”管理每个加工件的供应：
 *
 * · 每个配件行选供应方式：成品采购 / 整体外协 / 工序外协 / 自制
 * · 成品采购、整体外协 → 选供应商（按供应商性质过滤：成品件厂 / 外协厂）
 * · 工序外协 → 展开工序子表：每道工序（发黑/热处理/焊接…，清单可维护）单独选
 *   有该工序能力的外协厂
 * · 持久化 system_configs('outsourcing_bom')，自动保存（防丢守卫与设备配套同款）
 * · 导出 Excel（含工序明细）/ Word（按供应方式分节）
 */

const SUPPLY_MODES = [
  { value: 'purchase', label: '成品采购' },
  { value: 'whole', label: '整体外协' },
  { value: 'process', label: '工序外协' },
  { value: 'self', label: '自制' },
] as const
type SupplyMode = (typeof SUPPLY_MODES)[number]['value']
const modeLabel = (v?: string) => SUPPLY_MODES.find((m) => m.value === v)?.label || '—'

const NATURE_LABEL: Record<string, string> = { finished: '成品件', process: '工序外协', both: '成品+外协' }

/** 出厂工序清单（可在界面维护，存 system_configs: process_catalog） */
const DEFAULT_PROCESSES = ['下料', '焊接', '机加工', '热处理', '发黑', '镀锌', '喷漆', '探伤', '退火', '校直']

interface ProcessRow {
  name: string
  supplier: string
}

interface OutRow {
  key: string
  part: string
  mode: SupplyMode | ''
  suppliers: string[]
  processes: ProcessRow[]
  note: string
}

type StoredOut = Partial<Omit<OutRow, 'mode'> & { mode?: string }>
type StoredOutBom = Record<string, StoredOut[]>

let rowSeq = 0
const newOutRow = (part = ''): OutRow => ({
  key: `o${++rowSeq}`,
  part,
  mode: '',
  suppliers: [],
  processes: [],
  note: '',
})

const toOutRow = (v: StoredOut): OutRow => {
  const base = newOutRow()
  return {
    ...base,
    ...v,
    key: (v as any).key || base.key,
    mode: (SUPPLY_MODES.map((m) => m.value) as string[]).includes(v.mode || '') ? (v.mode as SupplyMode) : '',
    suppliers: v.suppliers ?? [],
    processes: Array.isArray(v.processes) ? v.processes : [],
  }
}

export default function OutsourcingBoard() {
  const queryClient = useQueryClient()
  // ?equipment= 直达某台设备（供应商详情「在哪用到」点过来，与设备配套/备件管理同口径）
  const [searchParams] = useSearchParams()
  const [equipment, setEquipment] = useState(searchParams.get('equipment') || '')
  const [rows, setRows] = useState<OutRow[]>([])
  const [customEquip, setCustomEquip] = useState('')
  const [processManageOpen, setProcessManageOpen] = useState(false)
  const [newProcess, setNewProcess] = useState('')
  /** 管理设备清单（改名/删除，与设备配套/备件管理共用的 EquipmentManagerModal） */
  const [manageOpen, setManageOpen] = useState(false)

  /*
   * 外协配置 / 设备清单 / 供应商池：改用与设备配套、备件管理相同的统一查询键（useSupplyData.ts），
   * 不再自己另起 ['outsourcing-suppliers']、['equipment-bom-names-for-out'] 两个独立查询 ——
   * 那样设备配套改名/删设备、供应商改性质与工序能力标签，这里都要等 5 分钟 staleTime 过期才能看到。
   */
  const { data: outBom } = useOutsourcingBom()
  const { data: equipmentBom } = useEquipmentBom()
  const { data: spareBom } = useSpareBom()
  const { data: supplierPool } = useSupplierPool()
  const supplierNames = useMemo(() => new Set((supplierPool || []).map((s: any) => s.name)), [supplierPool])

  // 设备清单：设备配套 ∪ 外协配置出现过的设备
  const equipmentNames = useMemo(
    () => [...new Set([...Object.keys(equipmentBom || {}), ...Object.keys(outBom || {})])],
    [equipmentBom, outBom],
  )
  useEffect(() => {
    if (equipmentNames.length && !equipmentNames.includes(equipment)) {
      setEquipment(equipmentNames[0])
    }
  }, [equipmentNames, equipment])

  // 工序清单（可维护）
  const { data: processCatalog } = useQuery({
    queryKey: ['process-catalog'],
    queryFn: async () => {
      try {
        const res: any = await systemConfigApi.get('process_catalog')
        const raw = typeof res === 'string' ? res : res?.value || res?.data?.value
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed) && parsed.length) return parsed as string[]
        }
      } catch {
        /* 未配置 */
      }
      return DEFAULT_PROCESSES
    },
    staleTime: 5 * 60_000,
  })
  const processes = processCatalog || DEFAULT_PROCESSES

  const persistCatalog = async (next: string[]) => {
    await systemConfigApi.set({
      key: 'process_catalog', value: JSON.stringify(next),
      category: 'supplier', description: '外协工序清单（外协加工页用）',
    })
    queryClient.invalidateQueries({ queryKey: ['process-catalog'] })
  }

  // 载入（防丢守卫同设备配套：自动保存 refetch 不重放）
  const skipNextSaveRef = useRef(false)
  const lastLoadedEquipRef = useRef<string | null>(null)
  useEffect(() => {
    if (outBom === undefined) return
    if (lastLoadedEquipRef.current === equipment) return
    lastLoadedEquipRef.current = equipment
    const stored = (outBom as StoredOutBom)?.[equipment]
    const next = (stored || []).map(toOutRow)
    skipNextSaveRef.current = true
    setRows(next)
  }, [equipment, outBom])

  const persistBom = async (next: StoredOutBom, quiet = false) => {
    try {
      bomRef.current = next
      await systemConfigApi.set({
        key: 'outsourcing_bom', value: JSON.stringify(next),
        category: 'supplier', description: '外协加工（配件供应方式+工序外协明细）',
      })
      queryClient.invalidateQueries({ queryKey: QK_OUTSOURCING_BOM })
      if (!quiet) toast.success('已保存')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '保存失败')
    }
  }
  const bomRef = useRef<StoredOutBom | undefined>(undefined)
  useEffect(() => { bomRef.current = outBom as StoredOutBom | undefined }, [outBom])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** "已自动保存"提示（设备配套页有、这里原来没有——保没保存全靠猜） */
  const [autoSaved, setAutoSaved] = useState(false)
  const persistCurrent = async (rs: OutRow[], equip: string) => {
    // 设备清单与「设备配套」共享：该设备在外协配置里还没有键时允许创建
    // （守卫只挡"设备已从清单删除"的情况）
    if (!bomRef.current || !equip || !equipmentNames.includes(equip)) return
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
      setAutoSaved(true)
      setTimeout(() => setAutoSaved(false), 1500)
    }, 600)
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        if (!skipNextSaveRef.current) persistCurrent(rows, equipment)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, equipment])

  const setCell = (key: string, patch: Partial<OutRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const addSupplier = async (row: OutRow, name: string) => {
    const v = name.trim()
    if (!v || row.suppliers.includes(v)) return
    setCell(row.key, { suppliers: [...row.suppliers, v] })
    const hit = (supplierPool || []).find((s) => s.name === v)
    if (!hit) {
      try {
        // 外协页新建的厂家默认按当前供应方式给性质，便于后续过滤
        const nature = row.mode === 'purchase' ? 'finished' : row.mode === 'whole' || row.mode === 'process' ? 'process' : ''
        await supplierApi.create({ name: v, ...(nature ? { nature } : {}) })
        markAutoCreated(v)
        queryClient.invalidateQueries({ queryKey: QK_SUPPLIER_POOL })
        queryClient.invalidateQueries({ queryKey: ['suppliers'] })
        toast.success(`「${v}」不在供应管理，已自动加入厂家名册`)
      } catch (e: any) {
        toast.error(`「${v}」加入供应管理失败：${e?.response?.data?.message || e?.message || '未知原因'}`)
      }
    }
  }
  const removeSupplier = (row: OutRow, name: string) => {
    const nextRows = rows.map((r) => (r.key === row.key ? { ...r, suppliers: r.suppliers.filter((s) => s !== name) } : r))
    setRows(nextRows)
    /*
     * 名册清理只针对「刚才输入时自动入册、现在又 × 掉」的打错字记录（见 cleanupAutoCreatedSupplier）。
     * 与设备配套/备件管理同口径：导入的、正式建档的厂家绝不因为在这一行被 × 掉就从名册删除。
     */
    void cleanupAutoCreatedSupplier(name, { source: 'outsourcing', equipment, rows: nextRows })
      .then((removed) => {
        if (!removed) return
        queryClient.invalidateQueries({ queryKey: QK_SUPPLIER_POOL })
        queryClient.invalidateQueries({ queryKey: ['suppliers'] })
        toast.info(`「${name}」是刚才输入时自动加入的，现已不再被引用，已从供应管理撤回`)
      })
      .catch(() => undefined)
  }

  /** 行供应商候选：按供应方式过滤性质（purchase→成品件厂；whole/process→外协厂；未选/自制→全部） */
  const rowCandidates = (row: OutRow) => {
    const pool = supplierPool || []
    const filtered =
      row.mode === 'purchase'
        ? pool.filter((s) => !s.nature || s.nature === 'finished' || s.nature === 'both')
        : row.mode === 'whole' || row.mode === 'process'
          ? pool.filter((s) => !s.nature || s.nature === 'process' || s.nature === 'both')
          : []
    return filtered.length ? filtered : pool
  }
  /** 工序候选厂：有该工序能力标签的外协厂 */
  const processCandidates = (procName: string) => {
    const pool = (supplierPool || []).filter((s) => !s.nature || s.nature === 'process' || s.nature === 'both')
    const hit = pool.filter((s) => (s.processTags || []).includes(procName))
    return hit.length ? hit : pool
  }

  const addCustomEquipment = async (nameOverride?: string) => {
    const name = (nameOverride ?? customEquip).trim()
    if (!name) return
    if (equipmentNames.includes(name)) { setEquipment(name); setCustomEquip(''); return }
    await persistBom({ ...(bomRef.current || {}), [name]: [] }, true)
    setRows([newOutRow()])
    setEquipment(name)
    setCustomEquip('')
    toast.info(`新设备「${name}」：请添加加工件行，内容会自动保存`)
  }

  /**
   * 从设备配套 / 备件管理带入配件名：外协加工此前要把配件名在三个页签各打一遍，
   * 其中设备配套/备件管理之间已经有「从设备配套带入」互通，外协加工是后加的第 5 个页签，
   * 一直没补上。这里只带入配件名（+已有供应商作为初始候选），供应方式/工序明细仍需手动选，
   * 因为采购/外协/自制是外协加工特有的维度，设备配套/备件清单里没有对应字段可带。
   */
  const kitParts = useMemo(() => {
    const seen = new Map<string, string[]>()
    for (const bom of [equipmentBom, spareBom]) {
      for (const it of (bom?.[equipment] || [])) {
        const part = rowPart(it).trim()
        if (!part || seen.has(part)) continue
        seen.set(part, rowSuppliers(it))
      }
    }
    return seen
  }, [equipmentBom, spareBom, equipment])
  const importFromKit = () => {
    const have = new Set(rows.map((r) => r.part.trim()).filter(Boolean))
    const add: OutRow[] = []
    for (const [part, suppliers] of kitParts) {
      if (have.has(part)) continue
      add.push({ ...newOutRow(part), suppliers })
    }
    if (!add.length) {
      toast.info(kitParts.size ? '设备配套/备件管理里的配件都已在外协加工清单中' : `「${equipment}」在设备配套、备件管理里还没有配件`)
      return
    }
    setRows((prev) => [...prev, ...add])
    toast.success(`已带入 ${add.length} 项配件名（含已有供应商作为初始候选），供应方式与工序明细仍需逐行选择`)
  }

  /** 全部设备合计（不只是当前这台），与设备配套/备件管理同一套统计卡片口径 */
  const allStats = useMemo(() => {
    let totalParts = 0, selected = 0
    const offSet = new Set<string>()
    for (const items of Object.values(outBom || {})) {
      for (const it of Array.isArray(items) ? items : []) {
        // 外协数据从不存裸字符串行（与设备配套/备件不同），这里只是共用了同一个宽松的 StoredBom 类型
        if (typeof it === 'string') continue
        const row = toOutRow(it)
        if (!row.part.trim()) continue
        totalParts++
        if (row.mode) selected++
        if (supplierPool) {
          for (const s of row.suppliers) if (!supplierNames.has(s)) offSet.add(s)
          for (const p of row.processes || []) if (p.supplier && !supplierNames.has(p.supplier)) offSet.add(p.supplier)
        }
      }
    }
    return { totalParts, selected, missing: totalParts - selected, offCount: offSet.size }
  }, [outBom, supplierPool, supplierNames])
  const statCards = [
    { label: '设备总数', value: equipmentNames.length, icon: LayoutGrid },
    { label: '加工件行（全部设备）', value: allStats.totalParts, icon: ListChecks },
    { label: '已选供应方式', value: allStats.selected, icon: ListChecks },
    { label: '未选供应方式', value: allStats.missing, icon: CircleAlert, alert: allStats.missing > 0 },
    { label: '厂家不在名册', value: allStats.offCount, icon: BadgeAlert, alert: allStats.offCount > 0 },
  ]

  // ── 导出 ──
  const filledRows = () => rows.filter((r) => r.part.trim())
  const exportExcel = async () => {
    const filled = filledRows()
    if (!filled.length) return toast.warning('没有可导出的行')
    const header = ['序号', '加工件/配件', '供应方式', '供应商/外协厂', '工序明细', '备注']
    const data = filled.map((r, i) => [
      i + 1, r.part, modeLabel(r.mode),
      r.suppliers.join('、'),
      (r.processes || []).map((p) => `${p.name}→${p.supplier}`).join('；'),
      r.note,
    ])
    await exportSheetsToExcel([{ name: '外协加工', header, rows: data }], `${equipment}_外协加工表_${stamp()}.xlsx`)
    toast.success(`已导出 ${filled.length} 行（Excel）`)
  }
  const exportWord = () => {
    const filled = filledRows()
    if (!filled.length) return toast.warning('没有可导出的行')
    const sections = SUPPLY_MODES.map((m) => {
      const items = filled.filter((r) => r.mode === m.value)
      if (!items.length) return null
      const header = m.value === 'process'
        ? ['序号', '加工件', '工序', '外协厂']
        : ['序号', '加工件', '供应商', '备注']
      const rowsData = m.value === 'process'
        ? items.flatMap((r, ri) => (r.processes?.length ? r.processes : [{ name: '（未拆分工序）', supplier: r.suppliers.join('、') }]).map((p) => [ri + 1, r.part, p.name, p.supplier]))
        : items.map((r, i) => [i + 1, r.part, r.suppliers.join('、'), r.note])
      return { name: `${m.label}（${items.length}）`, header, rows: rowsData }
    }).filter(Boolean)
    exportSectionsToWordDocx(
      `${equipment} 外协加工供应表（导出日期 ${new Date().toLocaleDateString('zh-CN')}）`,
      sections as any,
      `${equipment}_外协加工表_${stamp()}.docx`,
    )
    toast.success('已导出 Word（按供应方式分节）')
  }

  const addRow = () => {
    const r = newOutRow()
    setRows((prev) => [...prev, r])
  }

  return (
    <div className="space-y-4">
      {/* 统计卡片：全部设备合计，与供应管理其它页签同一套组件 */}
      <StatCards loading={!outBom} skeletonCount={5} items={statCards} />

      {/* 顶栏 */}
      <div className="eo-card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block eo-label mb-1.5">选择设备</label>
          <select value={equipment} onChange={(e) => setEquipment(e.target.value)} className="eo-input !w-48 !py-1.5 !text-sm" aria-label="选择设备">
            {equipmentNames.map((n) => (<option key={n} value={n}>{n}</option>))}
          </select>
        </div>
        <div className="flex items-end gap-1.5">
          <div>
            <label className="block eo-label mb-1.5">或输入自定义设备</label>
            <input value={customEquip} onChange={(e) => setCustomEquip(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCustomEquipment()} placeholder="例：酸洗线" className="eo-input !w-40 !py-1.5 !text-sm" />
          </div>
          <Button variant="secondary" size="sm" className="!py-1.5" onClick={() => addCustomEquipment()}>使用</Button>
        </div>
        <div className="flex-1" />
        <span className="text-caption text-muted self-center h-5 flex items-center" aria-live="polite">
          {autoSaved ? '✓ 已自动保存' : ''}
        </span>
        <Button
          variant="secondary"
          size="sm"
          className="!py-1.5"
          onClick={importFromKit}
          disabled={!equipment}
          title={kitParts.size ? `把「${equipment}」在设备配套/备件管理里的 ${kitParts.size} 项配件名（含已有供应商）带入，已有的跳过` : '该设备在设备配套、备件管理里还没有配件'}
        >
          <Wrench size={13} className="mr-0.5" /> 从设备配套/备件带入{kitParts.size ? `（${kitParts.size}）` : ''}
        </Button>
        <Button variant="secondary" size="sm" className="!py-1.5" onClick={() => setManageOpen(true)} title="设备清单改名 / 删除 / 新增（与设备配套/备件管理共用）">
          <Settings2 size={13} className="mr-0.5" /> 管理设备
        </Button>
        <Button variant="secondary" size="sm" className="!py-1.5" onClick={() => setProcessManageOpen(true)} title="外协工序清单的新增 / 删除">
          <Tags size={13} className="mr-0.5" /> 管理工序
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="!py-1.5"
          onClick={async () => {
            const stripped = rows.map((r) => ({ ...r }))
            await persistBom({ ...(bomRef.current || {}), [equipment]: stripped })
          }}
          title="内容已自动保存，此按钮为立即保存兜底"
        >
          <Save size={13} className="mr-0.5" /> 立即保存
        </Button>
        <ToolbarDivider />
        <Button variant="secondary" size="sm" className="!py-1.5" onClick={exportExcel} title="导出 Excel（含工序明细列）">
          <Download size={13} className="mr-0.5" /> 导出 Excel
        </Button>
        <Button size="sm" className="!py-1.5" onClick={exportWord} title="导出 Word（按供应方式分节：成品采购/整体外协/工序外协/自制）">
          <Download size={13} className="mr-0.5" /> 导出 Word
        </Button>
      </div>

      {/* 加工件表 */}
      <div className="eo-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5">
            <Factory size={15} className="text-accent-600" />
            {equipment} · 外协加工供应
          </h2>
          <button onClick={addRow} className="text-xs text-accent-600 hover:text-accent-700 flex items-center gap-0.5">
            <Plus size={13} /> 添加加工件行
          </button>
        </div>
        {!supplierPool ? (
          <PageLoader />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-caption text-muted border-b border-border">
                  <th className="py-2 pr-2 w-10 font-normal">序号</th>
                  <th className="py-2 pr-2 font-normal">加工件/配件</th>
                  <th className="py-2 pr-2 w-32 font-normal">供应方式</th>
                  <th className="py-2 pr-2 font-normal">供应商（按性质过滤）</th>
                  <th className="py-2 pr-2 w-40 font-normal">备注</th>
                  <th className="py-2 w-8 font-normal" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const cands = rowCandidates(r)
                  const candidateGroups = [{
                    label: r.mode === 'purchase' ? '成品件厂' : '外协厂（按性质过滤）',
                    items: cands.slice(0, 100).map((s) => ({ id: s.id, name: s.name, hint: [NATURE_LABEL[s.nature || ''] || '', (s.processTags || []).slice(0, 3).join('/')].filter(Boolean).join(' · ') })),
                  }]
                  return (
                    <Fragment key={r.key}>
                      <tr className="border-b border-divider hover:bg-canvas/60">
                        <td className="py-1.5 pr-2 text-muted tabular-nums">{i + 1}</td>
                        <td className="py-1.5 pr-2">
                          <input value={r.part} onChange={(e) => setCell(r.key, { part: e.target.value })} className="eo-input !py-1 !text-sm !border-transparent hover:!border-border focus:!border-accent-400 !w-44" placeholder="如：机架" />
                          {rows.filter((x) => x.part.trim() && x.part.trim() === r.part.trim()).length > 1 && (
                            <span className="text-caption text-warning-fg block leading-3" title="同名加工件出现多次，请确认是否重复录入">⚠ 重名</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2">
                          <select value={r.mode} onChange={(e) => setCell(r.key, { mode: e.target.value as SupplyMode })} className="eo-input !py-1 !text-xs w-full" aria-label="供应方式">
                            <option value="">— 选择 —</option>
                            {SUPPLY_MODES.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
                          </select>
                        </td>
                        <td className="py-1.5 pr-2">
                          {r.mode === 'process' ? (
                            <span className="text-caption text-muted">工序明细在下方子表选择 ↓</span>
                          ) : r.mode === 'self' ? (
                            <span className="text-caption text-muted">自制，不外选供应商</span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1 min-w-48">
                              {r.suppliers.map((sup) => (
                                <span key={sup} className="inline-flex items-center gap-1 text-xs pl-1.5 pr-0.5 py-0.5 rounded bg-accent-50 text-accent-700 border border-accent-200">
                                  {sup}
                                  <button onClick={() => removeSupplier(r, sup)} className="text-accent-600 hover:text-danger-fg p-0.5 leading-none" aria-label={`移除供应商 ${sup}`}>×</button>
                                </span>
                              ))}
                              <SupplierCandidateInput
                                groups={candidateGroups}
                                placeholder={r.suppliers.length ? '继续添加…' : r.mode === 'purchase' ? '提示成品件厂家' : '提示外协厂家'}
                                onPick={(v) => addSupplier(r, v)}
                              />
                            </div>
                          )}
                        </td>
                        <td className="py-1.5 pr-2">
                          <input value={r.note} onChange={(e) => setCell(r.key, { note: e.target.value })} className="eo-input !py-1 !text-xs !border-transparent hover:!border-border w-full" placeholder="备注" />
                        </td>
                        <td className="py-1.5">
                          <button onClick={() => deleteRowWithUndo(rows, r.key, setRows, r.part)} className="text-muted hover:text-danger-fg p-1" title="删除该行（5 秒内可在提示里撤销）" aria-label="删除行">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                      {r.mode === 'process' && (
                        <tr className="bg-subtle/60">
                          <td colSpan={6} className="py-2 px-4">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-caption font-semibold text-ink">工序外协明细</span>
                              <button
                                onClick={() => setCell(r.key, { processes: [...(r.processes || []), { name: processes[0] || '', supplier: '' }] })}
                                className="text-caption text-accent-600 hover:text-accent-700 inline-flex items-center gap-0.5"
                              >
                                <Plus size={12} /> 加工序
                              </button>
                            </div>
                            <div className="space-y-1.5">
                              {(r.processes || []).map((p, pi) => {
                                const pcands = processCandidates(p.name)
                                return (
                                  <div key={pi} className="flex items-center gap-2 flex-wrap">
                                    <select
                                      value={p.name}
                                      onChange={(e) => {
                                        const next = [...r.processes]
                                        next[pi] = { ...p, name: e.target.value }
                                        setCell(r.key, { processes: next })
                                      }}
                                      className="eo-input !py-1 !text-xs !w-28"
                                      aria-label="工序"
                                    >
                                      {processes.map((pn) => (<option key={pn} value={pn}>{pn}</option>))}
                                      {!processes.includes(p.name) && p.name && <option value={p.name}>{p.name}</option>}
                                    </select>
                                    <span className="text-muted text-xs">→</span>
                                    <input
                                      list={`out-proc-${r.key}-${pi}`}
                                      defaultValue={p.supplier}
                                      className="eo-input !py-1 !text-xs !w-56"
                                      placeholder={`有「${p.name}」能力的厂家`}
                                      onBlur={(e) => {
                                        const next = [...r.processes]
                                        next[pi] = { ...p, supplier: e.target.value.trim() }
                                        setCell(r.key, { processes: next })
                                      }}
                                    />
                                    <datalist id={`out-proc-${r.key}-${pi}`}>
                                      {pcands.slice(0, 100).map((s) => (
                                        <option key={s.id} value={s.name}>{(s.processTags || []).join('、')}</option>
                                      ))}
                                    </datalist>
                                    <button
                                      onClick={() => setCell(r.key, { processes: r.processes.filter((_, k) => k !== pi) })}
                                      className="text-muted hover:text-danger-fg p-1"
                                      aria-label="删除工序"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                )
                              })}
                              {!(r.processes || []).length && <p className="text-caption text-muted">点「加工序」按道拆分，如：焊接→A厂、发黑→B厂、机加工→C厂</p>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {!rows.length && (
                  <tr><td colSpan={6} className="py-6 text-center text-sm text-muted">该设备还没有加工件行，点「添加加工件行」逐行录入，内容会自动保存</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-caption text-muted mt-3">
          供应方式决定供应商候选：成品采购提示成品件厂、整体外协/工序外协提示外协厂（按供应管理里设置的「供应商性质」过滤）；
          工序外协按每道工序选有该能力标签的外协厂（能力标签在供应管理编辑厂家时维护）。清单自动保存。
        </p>
      </div>

      {/* 工序管理弹窗 */}
      <Modal open={processManageOpen} onClose={() => setProcessManageOpen(false)} title={`管理外协工序（${processes.length}）`} size="sm" cancelText="关闭">
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {processes.map((pn) => (
            <div key={pn} className="flex items-center gap-2">
              <span className="text-sm text-ink flex-1">{pn}</span>
              <button
                onClick={() => persistCatalog(processes.filter((x) => x !== pn)).then(() => toast.success(`已删除工序「${pn}」`))}
                className="text-muted hover:text-danger-fg p-1"
                aria-label={`删除工序 ${pn}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-divider">
          <input
            value={newProcess}
            onChange={(e) => setNewProcess(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newProcess.trim()) { persistCatalog([...processes, newProcess.trim()]); setNewProcess('') } }}
            placeholder="新增工序，如 抛丸"
            className="eo-input !py-1 !text-sm flex-1"
            aria-label="新增工序"
          />
          <Button size="sm" className="!py-1" onClick={() => { if (newProcess.trim()) { persistCatalog([...processes, newProcess.trim()]); setNewProcess('') } }}>添加</Button>
        </div>
        <p className="text-caption text-muted mt-2">工序清单是外协子表的下拉选项；删除工序不影响已录入的外协明细。</p>
      </Modal>

      {/* 设备管理：改名 / 删除 / 新增（与设备配套/备件管理共用的组件，此前只能切回设备配套页才能操作） */}
      <EquipmentManagerModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onAddNew={(name) => addCustomEquipment(name)}
        onRenamed={(from, to) => { if (equipment === from) setEquipment(to) }}
        onDeleted={(name) => { if (equipment === name) setEquipment(equipmentNames.find((n) => n !== name) || '') }}
      />
    </div>
  )
}
