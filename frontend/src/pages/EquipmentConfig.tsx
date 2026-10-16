import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useSearchParams } from 'react-router-dom'
import { Plus, Trash2, Download, Save, Wrench, Settings2, Pencil, GripVertical, Copy, FileSpreadsheet, FileText, Tags, AlertTriangle, LayoutGrid, ListChecks, CircleAlert, BadgeAlert } from 'lucide-react'
import { supplierApi, systemConfigApi } from '../api/services'
import { groupByProfession, resolveProfession, moveItem } from '../utils/profession'
import { useProfessions } from '../hooks/useProfessions'
import {
  DEFAULT_EQUIPMENT_BOM,
  cleanupAutoCreatedSupplier,
  markAutoCreated,
  rankCandidates,
  useEquipmentBom,
  useSpareBom,
  useSupplierPool,
} from '../hooks/useSupplyData'
import ProfessionManager from '../components/ProfessionManager'
import EquipmentManagerModal from '../components/EquipmentManagerModal'
import { exportSheetsToExcel, exportSectionsToWordDocx, stamp } from '../utils/export-sheet'
import { deleteRowWithUndo } from '../utils/rowUndo'
import Button from '../components/Button'
import Modal from '../components/Modal'
import PageLoader from '../components/PageLoader'
import StatCards from '../components/StatCards'
import ToolbarDivider from '../components/ToolbarDivider'
import SupplierCandidateInput from '../components/SupplierCandidateInput'

/**
 * 设备配套选型表：设备 → 配件清单 → 每个配件选供应商 → 导出对照表。
 *
 * 用途：做技术方案/投标附件时，选"拉弯矫直机"自动带出它的常用配件，
 * 每行从供应管理里挑供应商（新厂家自动入名册），一键导出
 * 可直接复制进技术附件文档的表格。
 *
 * 持久化（全部自动，无需手动保存）：
 * - 自定义设备（如"酸洗线"）添加即写入配置，切换/返回不丢
 * - 配件行与供应商选择防抖自动保存为该设备的"最近选型"，
 *   下次选同一设备直接带出（含上次的供应商），微调后导出
 * - 设备清单可改名/删除（「管理设备」弹窗）
 */

const DEFAULT_NAMES = Object.keys(DEFAULT_EQUIPMENT_BOM)

interface ConfigRow {
  key: string
  part: string
  /** 专业：空=按名称自动判定；手动指定可把"接近开关"从仪表调到电气 */
  profession: string
  /** 供应商支持多个（如液压缸：力士乐、派克），datalist 选中/回车追加 */
  suppliers: string[]
  tier: string
  contact: string
  phone: string
  note: string
}

/** 持久化形态：业务字段 + 行 key（保存/载入复用同一 key，防止自动保存重放时输入框被重建打断输入） */
type StoredRow = Partial<Omit<ConfigRow, never> & { supplierName?: string }>
type StoredBom = Record<string, Array<string | StoredRow>>

let rowSeq = 0
const newRow = (part = ''): ConfigRow => ({
  key: `r${++rowSeq}`,
  part,
  profession: '',
  suppliers: [],
  tier: '',
  contact: '',
  phone: '',
  note: '',
})

const toConfigRow = (v: string | StoredRow): ConfigRow => {
  if (typeof v === 'string') return newRow(v)
  const base = newRow()
  return {
    ...base,
    ...v,
    // 行 key 持久化复用：自动保存 → 刷新配置 → 载入重放时 React 按 key 复用 DOM，
    // 输入框不会卸载重建（否则打字到一半被重置，只留下第一个字符）
    key: (v as any).key || base.key,
    // 兼容旧的单值 supplierName 字符串
    suppliers: v.suppliers ?? (v.supplierName ? [v.supplierName] : []),
  }
}

export default function EquipmentConfig() {
  const queryClient = useQueryClient()
  // ?equipment= 直达某台设备（供应商详情「在哪用到」点过来）
  const [searchParams] = useSearchParams()
  const [equipment, setEquipment] = useState(searchParams.get('equipment') || DEFAULT_NAMES[0])
  const [rows, setRows] = useState<ConfigRow[]>([])
  const [customEquip, setCustomEquip] = useState('')
  /** 导出行勾选（默认全选；载入/增删行时自动补齐新行） */
  const [exportSelected, setExportSelected] = useState<Set<string>>(new Set())
  const [manageOpen, setManageOpen] = useState(false)
  /** 专业分类清单（可增删改，设备配套/备件管理共用）与组名编辑态 */
  const { defs: professions, displayName, rename: renameProfession } = useProfessions()
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const [professionMgrOpen, setProfessionMgrOpen] = useState(false)
  /** 只看还没选供应商的行（补全选型用） */
  const [onlyMissing, setOnlyMissing] = useState(false)
  /** 从其他设备复制配套的弹窗 */
  const [copyOpen, setCopyOpen] = useState(false)
  const [copySource, setCopySource] = useState('')
  /** 拖拽排序：拖动手柄把行插到目标行前（rows 数组序即持久化顺序） */
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
  // 设备-配件配置 / 备件清单 / 供应商池：与其它页签共用同一份查询（任一处写入，各页签立即同步）
  const { data: bomConfig } = useEquipmentBom()
  const { data: spareBom } = useSpareBom()

  // 设备清单 = 库配置的键。当前选中若已被删（不在清单），自动跳回第一项
  const equipmentNames = useMemo(
    () => [...new Set(Object.keys(bomConfig || {}))],
    [bomConfig],
  )
  useEffect(() => {
    if (bomConfig && equipmentNames.length && !equipmentNames.includes(equipment)) {
      setEquipment(equipmentNames[0])
    }
  }, [equipmentNames, bomConfig])

  // 供应商池：一次拉全，每行的候选按「同名配件用过的 → 同品类 → 其余」排序
  const { data: supplierPool } = useSupplierPool()
  const supplierNames = useMemo(() => new Set((supplierPool || []).map((s: any) => s.name)), [supplierPool])

  // 切设备 → 载入该设备的持久化选型（默认模板 / 最近保存）。
  // 守卫：配置未加载完成（undefined）时不置空行 —— 否则空行会触发自动保存，
  // 把该设备的配件清空写库（刷新页面后"配件全部丢失"的根因）。
  // 置 skipNextSave：载入重放的行不算用户编辑，不回写。
  const skipNextSaveRef = useRef(false)
  const lastLoadedEquipRef = useRef<string | null>(null)
  useEffect(() => {
    if (bomConfig === undefined) return
    // 自动保存回写会触发 refetch：服务器数据就是我们 600ms 前写进去的，
    // 此时重放 setRows 会在打字间隙覆盖输入（表现为只打出第一个字母）。
    // 只有切换设备或首次载入才重放；自动保存路径的数据本来就在本地 state 里。
    if (lastLoadedEquipRef.current === equipment) return
    lastLoadedEquipRef.current = equipment
    const stored = (bomConfig as StoredBom)?.[equipment]
    const next = (stored || []).map(toConfigRow)
    skipNextSaveRef.current = true
    setRows(next)
    // 载入默认全选：导出整表最常用；只导个别配件时取消勾选即可
    setExportSelected(new Set(next.map((r) => r.key)))
  }, [equipment, bomConfig])

  /** 全量写回配置（合并内置默认之外的设备）。写后同步 bomRef，
   *  让随后的自动保存/flush 拿到最新值 —— 否则删除设备后残留的
   *  旧快照会把刚删掉的设备又写回来（"删除后重新出现"的根因）。 */
  const persistBom = async (next: StoredBom, quiet = false) => {
    try {
      bomRef.current = next
      await systemConfigApi.set({
        key: 'equipment_bom',
        value: JSON.stringify(next),
        category: 'supplier',
        description: '设备配套选型（配件与供应商，按设备持久化）',
      })
      queryClient.invalidateQueries({ queryKey: ['equipment-bom'] })
      if (!quiet) toast.success('已保存')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '保存失败')
    }
  }

  // ── 自动保存：行变化后防抖 600ms 持久化 ──
  // 三个防丢要点：
  // · bomRef 实时同步最新配置：保存合并时不能依赖 effect 闭包里的旧 bomConfig
  //   （旧值可能是 undefined → 展开成 {} → 整份配置被覆盖成只剩当前设备，历史设备全丢）
  // · 配置未就绪（bomRef.current === undefined）禁止写库
  // · 切设备/卸载时立即落盘（flush），防抖窗口内的编辑不因切换而丢
  const bomRef = useRef<StoredBom | undefined>(undefined)
  useEffect(() => { bomRef.current = bomConfig }, [bomConfig])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [autoSaved, setAutoSaved] = useState(false)
  const persistCurrent = async (rs: ConfigRow[], equip: string) => {
    // 配置未就绪不写；设备不在当前配置（刚被删除）不写 —— 写回即删除被撤销
    if (!bomRef.current || !Object.prototype.hasOwnProperty.call(bomRef.current, equip)) return
    // key 一并保存：载入重放时复用，输入不被自动保存打断
    const stripped: StoredRow[] = rs.map((r) => ({ ...r }))
    await persistBom({ ...bomRef.current, [equip]: stripped }, true)
  }
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      // 双保险：定时器到期时若已被标记"即将载入"（跳过保存），不再写库
      if (skipNextSaveRef.current) return
      await persistCurrent(rows, equipment)
      setAutoSaved(true)
      setTimeout(() => setAutoSaved(false), 1500)
    }, 600)
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        // 防抖未到点就切走/卸载：立即保存，编辑不丢。
        // 但 skipNextSave 置位说明本次重跑是"载入新行"引发的 ——
        // 旧 rows 是待替换的空壳，flush 它会把该设备清空写库。
        if (!skipNextSaveRef.current) persistCurrent(rows, equipment)
      }
    }
    // bomConfig 不进依赖：保存回写会刷新 query，再触发 effect 成环（写时经 bomRef 取最新）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, equipment])

  const setCell = (key: string, patch: Partial<ConfigRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  /**
   * 追加一个供应商（去重）：
   * · 供应管理里已有 → datalist 搜索提示选中（自动跳出）
   * · 供应管理里没有 → 自动创建到供应管理（厂家名册），编号按规则生成，
   *   下次任何页面搜索该厂家都能找到
   */
  const addSupplier = async (row: ConfigRow, name: string) => {
    const v = name.trim()
    if (!v || row.suppliers.includes(v)) return
    setCell(row.key, { suppliers: [...row.suppliers, v] })
    const hit = (supplierPool || []).find((s) => s.name === v)
    if (!hit) {
      try {
        await supplierApi.create({ name: v })
        markAutoCreated(v)
        queryClient.invalidateQueries({ queryKey: ['suppliers'] })
        toast.success(`「${v}」不在供应管理，已自动加入厂家名册`)
      } catch (e: any) {
        toast.error(`「${v}」加入供应管理失败：${e?.response?.data?.message || e?.message || '未知原因'}`)
      }
    }
  }

  const removeSupplier = (row: ConfigRow, name: string) => {
    // 先算好 × 之后的最新行集（闭包里的 rows 是 × 前的），清理判断要用新值
    const nextRows = rows.map((r) => (r.key === row.key ? { ...r, suppliers: r.suppliers.filter((s) => s !== name) } : r))
    setRows(nextRows)
    /*
     * 名册清理只针对「刚才输入时自动入册、现在又 × 掉」的打错字记录（见 cleanupAutoCreatedSupplier）。
     * 原来只要名册里没填品类/联系人就删 —— 外购件清单导入的厂家大多如此，删除会连带删掉它的供应产品与报价。
     */
    void cleanupAutoCreatedSupplier(name, { source: 'equipment', equipment, rows: nextRows })
      .then((removed) => {
        if (!removed) return
        queryClient.invalidateQueries({ queryKey: ['suppliers'] })
        toast.info(`「${name}」是刚才输入时自动加入的，现已不再被引用，已从供应管理撤回`)
      })
      .catch(() => undefined)
  }

  /** 在指定专业组内添加行（组标题的 ＋：新行直接落在本组） */
  const addRowInGroup = (profession: string) => {
    const r: ConfigRow = { ...newRow(), profession: profession as ConfigRow['profession'] }
    setExportSelected((s2) => new Set(s2).add(r.key))
    setRows((prev) => [...prev, r])
  }

  /** 某行配件的供应商候选：同名配件用过的厂家优先，其次同品类，品类没匹配上时给全量 */
  const candidatesOf = (part: string) => rankCandidates(part, supplierPool || [], bomConfig, spareBom)

  /** 新增自定义设备：立即持久化空清单，切换/返回不丢 */
  const addCustomEquipment = async (nameOverride?: string) => {
    const name = (nameOverride ?? customEquip).trim()
    if (!name) return
    if (equipmentNames.includes(name)) {
      setEquipment(name)
      setCustomEquip('')
      return
    }
    await persistBom({ ...(bomConfig as StoredBom), [name]: [] }, true)
    setRows([newRow(), newRow(), newRow()])
    setEquipment(name)
    setCustomEquip('')
    toast.info(`新设备「${name}」已加入清单：请添加配件行，内容会自动保存`)
  }

  /** 本设备选型完成度：有名称的行里多少已选供应商、引用了多少名册外的厂家 */
  const filledRows = rows.filter((r) => r.part.trim())
  const missingSupplierRows = filledRows.filter((r) => !r.suppliers.length)
  const offRoster = supplierPool ? [...new Set(rows.flatMap((r) => r.suppliers).filter((n) => !supplierNames.has(n)))] : []
  const visibleRows = onlyMissing ? rows.filter((r) => !r.suppliers.length) : rows

  /**
   * 全部设备合计（不只是当前这台）：原来页面只有当前设备的选型进度，看不到整体概况，
   * 跟供应商页顶部的统计卡片不一样，切到这个页签会有种"从仪表盘掉进 Excel"的感觉。
   */
  const allStats = useMemo(() => {
    let totalParts = 0, selected = 0
    const offSet = new Set<string>()
    for (const items of Object.values(bomConfig || {})) {
      for (const it of Array.isArray(items) ? items : []) {
        const row = toConfigRow(it)
        if (!row.part.trim()) continue
        totalParts++
        if (row.suppliers.length) selected++
        if (supplierPool) for (const s of row.suppliers) if (!supplierNames.has(s)) offSet.add(s)
      }
    }
    return { totalParts, selected, missing: totalParts - selected, offCount: offSet.size }
  }, [bomConfig, supplierPool, supplierNames])
  const statCards = [
    { label: '设备总数', value: equipmentNames.length, icon: LayoutGrid },
    { label: '配件行（全部设备）', value: allStats.totalParts, icon: ListChecks },
    { label: '已选型', value: allStats.selected, icon: ListChecks },
    { label: '未选供应商', value: allStats.missing, icon: CircleAlert, alert: allStats.missing > 0 },
    { label: '厂家不在名册', value: allStats.offCount, icon: BadgeAlert, alert: allStats.offCount > 0 },
  ]

  /** 勾选且有效的行（各导出入口共用） */
  const selectedFilled = () =>
    rows.filter((r) => exportSelected.has(r.key) && (r.part.trim() || r.suppliers.length))

  const rowToCells = (r: ConfigRow) => [r.part, r.suppliers.join('、'), r.note]

  /** 导出 Excel：全部勾选行进一个工作表（含专业列），xlsx 按需加载 */
  const exportExcel = async () => {
    const filled = selectedFilled()
    if (!filled.length) return toast.warning('请先勾选要导出的配件行')
    await exportSheetsToExcel(
      [
        {
          name: '配套件',
          header: ['序号', '配件名称', '专业', '供应商', '备注'],
          rows: filled.map((r, i) => [i + 1, r.part, displayName(resolveProfession(r, professions)), r.suppliers.join('、'), r.note]),
        },
      ],
      `${equipment}_配套供应商表_${stamp()}.xlsx`,
    )
    toast.success(`已导出 ${filled.length} 行（Excel 单表）`)
  }

  /** 导出 Word：单文件，按专业分小节（HTML→.doc，双击即用 Word 打开，可直接复制进技术附件） */
  const exportWord = () => {
    const filled = selectedFilled()
    if (!filled.length) return toast.warning('请先勾选要导出的配件行')
    exportSectionsToWordDocx(
      `${equipment} 配套件供应商表（导出日期 ${new Date().toLocaleDateString('zh-CN')}）`,
      groupByProfession(filled, professions).map((g) => ({
        name: `${displayName(g.profession)}类配件 (${g.items.length})`,
        header: ['序号', '配件名称', '供应商', '备注'],
        rows: g.items.map((r, i) => [i + 1, ...rowToCells(r)]),
      })),
      `${equipment}_配套供应商表_${stamp()}.doc`,
    )
    toast.success(`已导出 Word（含 ${groupByProfession(filled, professions).length} 个专业分组）`)
  }

  /** 分专业导出 Excel：一个工作簿、每个专业一个工作表（如"机械""液压"） */
  const exportByProfession = async () => {
    const filled = selectedFilled()
    if (!filled.length) return toast.warning('请先勾选要导出的配件行')
    const groups = groupByProfession(filled, professions)
    await exportSheetsToExcel(
      groups.map((g) => ({
        name: displayName(g.profession),
        header: ['序号', '配件名称', '供应商', '备注'],
        rows: g.items.map((r, i) => [i + 1, ...rowToCells(r)]),
      })),
      `${equipment}_分专业供应商表_${stamp()}.xlsx`,
    )
    toast.success(`已导出 1 个 Excel（${groups.map((g) => `${displayName(g.profession)}(${g.items.length})`).join('、')} 各一个工作表）`)
  }

  /** 从其他设备复制配套：整表带入后局部修改，避免重复录入 */
  const copyFrom = async (source: string) => {
    const stored = (bomConfig as StoredBom | undefined)?.[source]
    if (!stored || !stored.length) {
      toast.warning(`「${source}」还没有配件行，无可复制`)
      return
    }
    const next = stored.map((v) => toConfigRow(v))
    // 行 key 重新生成，避免与当前行冲突
    const rekeyed = next.map((r) => ({ ...r, key: `r${++rowSeq}` }))
    setRows(rekeyed)
    setExportSelected(new Set(rekeyed.map((r) => r.key)))
    setCopyOpen(false)
    toast.success(`已从「${source}」复制 ${rekeyed.length} 行配件，可直接局部修改`)
  }

  // ── 设备管理：改名 / 删除 ──
  // 改名/删除同步到备件清单/外协配置的逻辑，抽成了三个页签共用的 EquipmentManagerModal + useEquipmentRoster
  // （此前只有这个页签能改名/删设备，且外协那一份清单完全没跟着同步）。
  const openManage = () => setManageOpen(true)

  return (
    <div className="space-y-4">
      {/* 统计卡片：全部设备合计，与供应管理其它页签同一套组件、同一种"先看全局"的开场 */}
      <StatCards loading={!bomConfig} skeletonCount={5} items={statCards} />

      {/* 设备选择 + 操作 */}
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
          <Button variant="secondary" size="sm" className="!py-1.5" onClick={() => addCustomEquipment()}>使用</Button>
        </div>
        <div className="flex-1" />
        <span className="text-caption text-muted self-center h-5 flex items-center" aria-live="polite">
          {autoSaved ? '✓ 已自动保存' : ''}
        </span>
        <Button variant="secondary" size="sm" className="!py-1.5" onClick={() => { setCopySource(''); setCopyOpen(true) }} title="把其他设备的整表配套复制到当前设备，再做局部修改">
          <Copy size={13} className="mr-0.5" /> 从其他设备复制
        </Button>
        <Button variant="secondary" size="sm" className="!py-1.5" onClick={openManage} title="设备清单改名 / 删除 / 新增">
          <Settings2 size={13} className="mr-0.5" /> 管理设备
        </Button>
        <Button variant="secondary" size="sm" className="!py-1.5" onClick={() => setProfessionMgrOpen(true)} title="专业分类新增 / 改名 / 删除 / 调顺序 / 改自动归类关键词（与备件管理共用）">
          <Tags size={13} className="mr-0.5" /> 管理分类
        </Button>
        <Button variant="secondary" size="sm" className="!py-1.5" onClick={async () => {
          const stripped: StoredRow[] = rows.map((r) => ({ ...r }))
          await persistBom({ ...(bomConfig as StoredBom), [equipment]: stripped })
        }} title="内容已自动保存，此按钮为立即保存兜底">
          <Save size={13} className="mr-0.5" /> 立即保存
        </Button>
        <ToolbarDivider />
        <Button size="sm" className="!py-1.5" onClick={exportExcel} title="全部勾选行导出为一个 Excel（含专业列）">
          <FileSpreadsheet size={13} className="mr-0.5" /> 导出 Excel{rows.length > 0 ? ` (${[...exportSelected].filter((k) => rows.some((r) => r.key === k)).length}/${rows.length})` : ''}
        </Button>
        <Button variant="secondary" size="sm" className="!py-1.5" onClick={exportWord} title="导出为 Word 文档（按专业分小节），可直接复制进技术附件">
          <FileText size={13} className="mr-0.5" /> 导出 Word
        </Button>
        {/* 分专业导出：一个 Excel 工作簿、每个专业一个工作表 */}
        <Button variant="secondary" size="sm" className="!py-1.5" onClick={exportByProfession} title="一个 Excel，每个专业各一个工作表">
          <Download size={13} className="mr-0.5" /> 分专业导出
        </Button>
      </div>

      {/* 从其他设备复制配套：整表带入当前设备后局部修改 */}
      <Modal
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title={`复制配套到「${equipment}」`}
        size="sm"
        cancelText="取消"
        onConfirm={() => copySource && copyFrom(copySource)}
        confirmText="复制"
        confirmDisabled={!copySource || copySource === equipment}
      >
        <p className="text-sm text-muted mb-3">选择来源设备，其全部配件行（含供应商/专业/备注）将替换当前设备的清单，复制后可直接局部修改：</p>
        <select value={copySource} onChange={(e) => setCopySource(e.target.value)} className="eo-input !py-1.5 !text-sm w-full" aria-label="来源设备">
          <option value="">— 选择来源设备 —</option>
          {equipmentNames.filter((n) => n !== equipment).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        {copySource && copySource !== equipment && (
          <p className="text-caption text-muted mt-2">「{copySource}」现有 {((bomConfig as StoredBom | undefined)?.[copySource] || []).length} 行配件</p>
        )}
      </Modal>

      {/* 配件-供应商对照表 */}
      <div className="eo-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-ink flex items-center gap-1.5">
              <Wrench size={15} className="text-accent-600" />
              {equipment} · 配套件供应商选型
            </h2>
            {filledRows.length > 0 && (
              <span className="text-caption text-muted flex items-center gap-2">
                <span>{filledRows.length} 项配件 · 已选型 {filledRows.length - missingSupplierRows.length}</span>
                {missingSupplierRows.length > 0 && (
                  <button
                    onClick={() => setOnlyMissing((v) => !v)}
                    className={`rounded px-1.5 py-0.5 border ${onlyMissing ? 'bg-warning-bg text-warning-fg border-warning-line' : 'border-border hover:border-accent-400'}`}
                    title="只显示还没选供应商的行"
                  >
                    {onlyMissing ? `只看未选型（${missingSupplierRows.length}）· 点此显示全部` : `${missingSupplierRows.length} 项未选供应商`}
                  </button>
                )}
                {offRoster.length > 0 && (
                  <span className="text-warning-fg flex items-center gap-0.5" title={`这些厂家不在供应管理名册里（可能已删除或改过名）：${offRoster.join('、')}`}>
                    <AlertTriangle size={12} /> {offRoster.length} 家不在名册
                  </span>
                )}
              </span>
            )}
          </div>
          <button
            onClick={() =>
              setRows((prev) => {
                const r = newRow()
                // 新行默认选中（要导出的）
                setExportSelected((s) => new Set(s).add(r.key))
                return [...prev, r]
              })
            }
            className="text-caption text-accent-600 hover:text-accent-700 flex items-center gap-0.5"
          >
            <Plus size={13} /> 添加配件行
          </button>
        </div>
        {!supplierPool ? (
          <PageLoader />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-caption text-muted border-b border-border">
                  <th className="py-2 w-6 font-normal" title="拖动调整顺序" />
                  <th className="py-2 pr-2 w-8 font-normal">
                    {/* 全选 = 导出范围（默认全选，取消个别行即只导其余） */}
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((r) => exportSelected.has(r.key))}
                      onChange={(e) =>
                        setExportSelected(e.target.checked ? new Set(rows.map((r) => r.key)) : new Set())
                      }
                      className="accent-accent-500"
                      aria-label="全选（导出范围）"
                      title="全选/清空导出范围"
                    />
                  </th>
                  <th className="py-2 pr-2 w-10 font-normal">序号</th>
                  <th className="py-2 pr-2 font-normal">配件/部件名称</th>
                  <th className="py-2 pr-2 w-28 font-normal">专业分类</th>
                  <th className="py-2 pr-2 font-normal">供应商（输入提示该品类厂家，新厂家自动入名册）</th>
                  <th className="py-2 pr-2 w-36 font-normal">备注</th>
                  <th className="py-2 w-8 font-normal" />
                </tr>
              </thead>
              <tbody>
                {/* 按 机械/液压/电气/仪表 专业分组显示（组内序号从 1 起，与分专业导出一致） */}
                {groupByProfession(visibleRows, professions).map((g) => (
                  <Fragment key={g.profession}>
                    <tr className="bg-subtle">
                      <td colSpan={8} className="py-1.5 px-2">
                        <span className="text-caption font-semibold text-accent-700">
                          {displayName(g.profession)}类配件 ({g.items.length})
                        </span>
                        {/* 组名改名：如"其他类配件"→"附件类配件"（键不变，仅显示名，两页共享） */}
                        <button
                          onClick={() => setEditingGroup(g.profession)}
                          className="ml-1.5 text-muted hover:text-accent-600 align-middle p-0.5"
                          title="修改本组显示名称"
                          aria-label={`改名 ${displayName(g.profession)}组`}
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={() => addRowInGroup(g.profession)}
                          className="ml-2 text-caption text-accent-600 hover:text-accent-700 inline-flex items-center gap-0.5"
                          title={`在${displayName(g.profession)}组内添加配件行`}
                        >
                          <Plus size={12} /> 组内添加
                        </button>
                        {editingGroup === g.profession && (
                          <span className="inline-flex items-center gap-1 ml-2">
                            <input
                              autoFocus
                              defaultValue={displayName(g.profession)}
                              className="eo-input !py-0.5 !text-caption !w-24"
                              aria-label="组的新名称"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { renameProfession(g.profession, (e.target as HTMLInputElement).value); setEditingGroup(null) }
                                if (e.key === 'Escape') setEditingGroup(null)
                              }}
                              onBlur={(e) => { renameProfession(g.profession, e.target.value); setEditingGroup(null) }}
                            />
                            <span className="text-caption text-muted">回车保存 / Esc 取消</span>
                          </span>
                        )}
                      </td>
                    </tr>
                    {g.items.map((r, i) => {
                  const { cat, usedCount, sameCatCount, list } = candidatesOf(r.part)
                  const candidateGroups = [
                    { label: '同名配件用过', items: list.slice(0, usedCount) },
                    { label: cat && sameCatCount ? `同品类「${cat}」` : '其他候选', items: list.slice(usedCount) },
                  ].map((g) => ({ ...g, items: g.items.map((s: any) => ({ id: s.id, name: s.name, hint: [s.contactName, s.phone].filter(Boolean).join(' · ') })) }))
                  return (
                    <tr
                      key={r.key}
                      className={`border-b border-divider hover:bg-canvas/60 ${dragOverKey === r.key ? 'outline outline-2 outline-accent-400' : ''}`}
                      onDragOver={(e) => { e.preventDefault(); setDragOverKey(r.key) }}
                      onDragLeave={() => setDragOverKey((k) => (k === r.key ? null : k))}
                      onDrop={(e) => { e.preventDefault(); onDropRow(r.key) }}
                    >
                      {/* 拖拽手柄：手柄自身 draggable（mousedown 动态开 tr 的 draggable 来不及生效），拖影用整行影像 */}
                      <td className="py-1.5 pr-0 w-6" title="拖动调整上下顺序">
                        <span
                          draggable
                          onDragStart={(e) => {
                            dragKeyRef.current = r.key
                            const tr = (e.currentTarget as HTMLElement).closest('tr')
                            if (tr && e.dataTransfer) e.dataTransfer.setDragImage(tr, 24, 12)
                          }}
                          onDragEnd={() => { setDragOverKey(null) }}
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
                            setExportSelected((prev) => {
                              const next = new Set(prev)
                              if (next.has(r.key)) next.delete(r.key)
                              else next.add(r.key)
                              return next
                            })
                          }
                          className="accent-accent-500"
                          aria-label={`导出行 ${r.part || i + 1}`}
                          title="勾选/取消导出该行"
                        />
                      </td>
                      <td className="py-1.5 pr-2 text-muted tabular-nums">{i + 1}</td>
                      <td className="py-1.5 pr-2">
                        <input
                          value={r.part}
                          onChange={(e) => setCell(r.key, { part: e.target.value })}
                          className="eo-input !py-1 !text-sm !border-transparent hover:!border-border focus:!border-accent-400 !w-44"
                          placeholder="配件名称"
                        />
                        {rows.filter((x) => x.part.trim() && x.part.trim() === r.part.trim()).length > 1 && (
                          <span className="text-caption text-warning-fg block leading-3" title="同名配件出现多次，请确认是否重复录入">⚠ 重名</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2">
                        {/* 专业分类：全手动指定（不自动归类），默认机械 */}
                        <select
                          value={r.profession && professions.some((d: any) => d.key === r.profession) ? r.profession : professions[0]?.key || '机械'}
                          onChange={(e) => setCell(r.key, { profession: e.target.value })}
                          className="eo-input !py-1 !text-caption w-full"
                          aria-label={`专业分类 ${r.part}`}
                          title="手动指定专业分组（不自动归类）"
                        >
                          {professions.map((p) => (
                            <option key={p.key} value={p.key}>{p.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-2">
                        {/* 供应商多选：已选厂家以标签展示（点 × 移除），输入提示该品类厂家、选中/回车追加 */}
                        <div className="flex flex-wrap items-center gap-1 min-w-48">
                          {r.suppliers.map((sup) => (
                            <span
                              key={sup}
                              className={`inline-flex items-center gap-1 text-caption pl-1.5 pr-0.5 py-0.5 rounded border ${
                                supplierPool && !supplierNames.has(sup) ? 'bg-warning-bg text-warning-fg border-warning-line' : 'bg-accent-50 text-accent-700 border-accent-200'
                              }`}
                              title={supplierPool && !supplierNames.has(sup) ? '不在供应管理名册里（可能已删除或改名）：× 掉后重新输入可从名册选择' : undefined}
                            >
                              {supplierPool && !supplierNames.has(sup) && <AlertTriangle size={11} />}
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
                          <SupplierCandidateInput
                            groups={candidateGroups}
                            placeholder={r.suppliers.length ? '继续添加…' : usedCount ? '提示同名配件用过的厂家' : cat ? `按「${cat}」提示厂家` : '输入提示厂家'}
                            onPick={(v) => addSupplier(r, v)}
                          />
                        </div>
                      </td>
                      <td className="py-1.5 pr-2">
                        <input value={r.note} onChange={(e) => setCell(r.key, { note: e.target.value })} className="eo-input !py-1 !text-caption !border-transparent hover:!border-border w-full" placeholder="型号/品牌等" />
                      </td>
                      <td className="py-1.5">
                        <button
                          onClick={() => deleteRowWithUndo(rows, r.key, setRows, r.part)}
                          className="text-muted hover:text-danger-fg p-1"
                          title="删除该行（5 秒内可在提示里撤销）"
                          aria-label="删除行"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                    })}
                  </Fragment>
                ))}
                {onlyMissing && rows.length > 0 && !visibleRows.length && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-sm text-muted">所有配件都已选好供应商</td>
                  </tr>
                )}
                {!rows.length && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-sm text-muted">
                      该设备还没有配件行，点「添加配件行」逐行录入，内容会自动保存（切换设备后不丢）
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-caption text-muted mt-3">
          配件与供应商选择自动保存；供应商输入先提示同名配件用过的厂家、再按配件品类提示名册里的厂家，名册里没有的新厂家回车即自动加入供应管理（标黄的是名册里找不到的厂家）。专业分类可在「管理分类」里新增/删除，与备件管理共用。勾选行后导出 Excel / Word，可直接复制进技术附件文档。
        </p>
      </div>

      <ProfessionManager open={professionMgrOpen} onClose={() => setProfessionMgrOpen(false)} />

      {/* 设备管理：改名 / 删除 / 新增（三个页签共用的组件，行为与备件管理/外协加工一致） */}
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
