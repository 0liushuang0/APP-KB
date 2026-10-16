import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, Download, Package } from 'lucide-react'
import { supplierApi, systemConfigApi } from '../api/services'
import { toList } from '../utils/apiList'
import { groupByProfession, professionOfPart } from '../utils/profession'
import Button from '../components/Button'
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
  spareType: SpareType
  suppliers: string[]
  note: string
}

type StoredSpare = Partial<Omit<SpareRow, 'key' | 'spareType' | 'suppliers'> & { spareType?: string; suppliers?: string[] }>
type StoredSpareBom = Record<string, StoredSpare[]>

let rowSeq = 0
const newSpare = (part = '', spareType: SpareType = '调试备件'): SpareRow => ({
  key: `s${++rowSeq}`,
  part,
  spareType,
  suppliers: [],
  note: '',
})

const toSpareRow = (v: StoredSpare): SpareRow => ({
  ...newSpare(),
  ...v,
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
  useEffect(() => {
    if (spareBom === undefined) return
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
    const stripped = rs.map(({ key: _k, ...rest }) => rest)
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

  const addSupplier = (row: SpareRow, name: string) => {
    const v = name.trim()
    if (!v || row.suppliers.includes(v)) return
    setCell(row.key, { suppliers: [...row.suppliers, v] })
  }
  const removeSupplier = (row: SpareRow, name: string) => {
    setCell(row.key, { suppliers: row.suppliers.filter((s) => s !== name) })
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

  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const downloadCsv = (title: string, header: string[], lines: string[], filename: string) => {
    const csv = '\uFEFF' + [title, '', header.join(','), ...lines].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const exportSheet = () => {
    const filled = visibleRows.filter((r) => exportSelected.has(r.key) && r.part.trim())
    if (!filled.length) {
      toast.warning('请先勾选要导出的备件行')
      return
    }
    const header = ['序号', '备件名称', '专业', '备件类型', '供应商', '备注']
    const lines = filled.map((r, i) =>
      [i + 1, r.part, professionOfPart(r.part), r.spareType, r.suppliers.join('、'), r.note].map(esc).join(','),
    )
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    downloadCsv(
      `${equipment} 备件清单${typeFilter ? `（${typeFilter}）` : ''}（导出日期 ${new Date().toLocaleDateString('zh-CN')}）`,
      header, lines, `${equipment}_备件清单${typeFilter || ''}_${stamp}.csv`,
    )
    toast.success(`已导出 ${filled.length} 行备件`)
  }

  /** 分专业导出：机械备件表 / 液压备件表 … */
  const exportByProfession = () => {
    const filled = visibleRows.filter((r) => exportSelected.has(r.key) && r.part.trim())
    if (!filled.length) {
      toast.warning('请先勾选要导出的备件行')
      return
    }
    const groups = groupByProfession(filled)
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    groups.forEach((g, gi) => {
      setTimeout(() => {
        const header = ['序号', '备件名称', '备件类型', '供应商', '备注']
        const lines = g.items.map((r, i) => [i + 1, r.part, r.spareType, r.suppliers.join('、'), r.note].map(esc).join(','))
        downloadCsv(
          `${equipment} ${g.profession}备件表${typeFilter ? `（${typeFilter}）` : ''}（导出日期 ${new Date().toLocaleDateString('zh-CN')}）`,
          header, lines, `${equipment}_${g.profession}备件表_${stamp}.csv`,
        )
      }, gi * 450)
    })
    toast.success(`按专业导出 ${groups.length} 个表：${groups.map((g) => `${g.profession}(${g.items.length})`).join('、')}`)
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
        <Button variant="secondary" size="sm" className="!py-1.5" onClick={exportSheet} title="导出勾选备件（含专业/备件类型列）">
          <Download size={13} className="mr-0.5" /> 导出备件表
        </Button>
        <Button size="sm" className="!py-1.5" onClick={exportByProfession} title="按机械/液压/电气/仪表各导一个表">
          <Download size={13} className="mr-0.5" /> 分专业导出
        </Button>
      </div>

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
                  <th className="py-2 pr-2 w-8 font-normal">☑</th>
                  <th className="py-2 pr-2 w-10 font-normal">序号</th>
                  <th className="py-2 pr-2 font-normal">备件名称</th>
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
                  />
                ))}
                {!visibleRows.length && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-sm text-muted">
                      {rows.length ? '当前类型筛选下没有备件' : '该设备还没有备件行，点「添加备件行」逐行录入，内容会自动保存'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-caption text-muted mt-3">
          备件按名称自动归入 机械/液压/电气/仪表 专业组（如"液压缸"→液压、"接近开关"→仪表）；备件类型区分调试备件与 2 年期备件可筛选；供应商支持多选。清单自动保存，设备与「设备配套」共享。
        </p>
      </div>
    </div>
  )
}

/** 专业分组渲染（拆出主组件避免单函数过长） */
function GroupFragment({
  profession, items, exportSelected, setExportSelected, setCell, setRows, candidatesOf, addSupplier, removeSupplier,
}: any) {
  return (
    <>
      <tr className="bg-subtle">
        <td colSpan={7} className="py-1.5 px-2">
          <span className="text-xs font-semibold text-accent-700">{profession}类备件 ({items.length})</span>
        </td>
      </tr>
      {items.map((r: SpareRow, i: number) => {
        const { cat, list } = candidatesOf(r.part)
        return (
          <tr key={r.key} className="border-b border-divider hover:bg-canvas/60">
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
