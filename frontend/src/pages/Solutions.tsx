import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, Plus, Eye, Pencil, Trash2, PlusCircle, Calculator, Boxes, Copy, Ban, CheckCircle2, FileEdit, FolderTree, Package } from 'lucide-react'
import { solutionApi, productApi, projectApi } from '../api/services'
import { useDebounce } from '../hooks/useDebounce'
import { useFormValidation, required } from '../hooks/useFormValidation'
import { usePageActions } from '../contexts/PageActionsContext'
import { useResizablePanel, ResizeHandle } from '../hooks/useResizablePanel'
import type { Solution, ConfigOption, PriceTable } from '../types'
import Button from '../components/Button'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import Drawer from '../components/Drawer'
import FormInput from '../components/FormInput'
import FormSelect from '../components/FormSelect'
import SearchableSelect from '../components/SearchableSelect'
import FormTextarea from '../components/FormTextarea'
import DataTable from '../components/DataTable'
import BatchEditBar from '../components/BatchEditBar'
import SolutionAssetSection from '../components/SolutionAssetSection'
import SolutionParamEditor, { SolutionParamView, parseSolutionParams } from '../components/SolutionParamEditor'
import SolutionDirectoryTree, { inDirectory } from '../components/SolutionDirectoryTree'
import StatCards from '../components/StatCards'
import { loadOrder, saveOrder, reorder as reorderOrder, type OrderMap } from '../utils/treeOrder'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import StatusBadge from '../components/StatusBadge'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'
import { FormSection, FieldGrid, DetailHeader, DetailSection, DescList, Stat } from '../components/layout-kit'

const initialForm = {
  name: '',
  productId: '',
  solutionType: 'standard',
  material: '',
  plant: '',
  line: '',
  description: '',
  scenario: '',
  keyParams: '',
  priceRange: '',
  deliveryCycle: '',
  tags: '',
  status: 'published',
  cadTemplateUrl: '',
  agreementTemplateUrl: '',
}

/** 方案类型：标准 / 选配 / 定制模板 */
const solutionTypeOptions = [
  { value: 'standard', label: '标准方案' },
  { value: 'optional', label: '选配方案' },
  { value: 'custom_template', label: '定制方案模板' },
]

const solutionTypeLabel = (v?: string) => solutionTypeOptions.find((o) => o.value === v)?.label || '—'

/** 状态生命周期：草稿 / 已发布 / 已停用 */
const statusOptions = [
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'disabled', label: '已停用' },
]

const handleError = (error: any) => {
  toast.error(error?.response?.data?.message || error?.message || '操作失败')
}

export default function Solutions() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get('highlight') || ''
  // 从项目列表「成交沉淀」跳来：把成交项目转成标准方案模板
  const fromProjectId = searchParams.get('fromProjectId') || ''
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  const [selectedDir, setSelectedDir] = useState('')
  // 目录树的本机显示顺序 + 节点「移动/重命名」弹窗
  const [dirOrder, setDirOrder] = useState<OrderMap>(() => loadOrder('aikb-solution-dir-order'))
  const [nodeAction, setNodeAction] = useState<{ mode: 'move' | 'rename'; path: string } | null>(null)
  const [nodeActionValue, setNodeActionValue] = useState('')
  const [page, setPage] = useState(1)
  // 与其他列表页一致：默认每页 15 条（翻页条提供 10/15/20 切换）
  const [pageSize, setPageSize] = useState(15)
  const [modalOpen, setModalOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  // 批量选择的方案行（复选框勾选，顶栏出现批量修改/删除）
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [editing, setEditing] = useState<Solution | null>(null)
  const [selected, setSelected] = useState<Solution | null>(null)
  const { values: form, errors, isValid, setValue, setValues, validateAll, reset } = useFormValidation({
    initialValues: initialForm,
    rules: { name: required('请输入方案名称') },
  })

  const [configOptionOpen, setConfigOptionOpen] = useState(false)
  const [configOptionForm, setConfigOptionForm] = useState({ id: '', key: '', label: '', choices: '[]', constraintRules: '', sortOrder: 0 })

  const [priceTableOpen, setPriceTableOpen] = useState(false)
  const [priceTableForm, setPriceTableForm] = useState({
    id: '',
    optionKey: '',
    optionValue: '',
    priceDelta: 0,
    cost: 0,
    leadTime: '',
    supplyLevel: '',
  })

  const [priceResult, setPriceResult] = useState<any>(null)
  // 待确认删除的配置项 / 价格表：这两处删除图标和编辑图标挨着，误点直接就删了
  const [deletingConfigOption, setDeletingConfigOption] = useState<any | null>(null)
  const [deletingPriceTable, setDeletingPriceTable] = useState<any | null>(null)

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  // 带 ?fromProjectId= 进来：自动开新建弹窗，名称/摘要从成交项目预填，其余参数由用户补全
  useEffect(() => {
    if (!fromProjectId || modalOpen || editing) return
    setEditing(null)
    setModalOpen(true)
    projectApi.get(fromProjectId).then((p: any) => {
      setValues((prev) => ({
        ...prev,
        name: p?.name ? `${p.name}标准方案模板` : prev.name,
        description: p?.description || prev.description,
      }))
    }).catch(() => {})
     
  }, [fromProjectId])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['solutions', debouncedSearch],
    queryFn: () => solutionApi.list({ keyword: debouncedSearch }),
  })

  const detailQuery = useQuery({
    queryKey: ['solution', selected?.id],
    queryFn: () => (selected?.id ? solutionApi.get(selected.id) : null),
    enabled: !!selected?.id,
  })

  const productsQuery = useQuery({
    queryKey: ['products-for-solution'],
    queryFn: () => productApi.list(),
  })

  const allSolutions = Array.isArray(data) ? data : []

  /** 左侧目录树选中某节点，只显示该目录（含所有子目录）下的方案 */
  const listData = allSolutions.filter((s: Solution) => inDirectory(s, selectedDir))

  useRegisterPageAssistant({
    key: 'solutions',
    label: '标准方案',
    sourceTypes: ['solution', 'product', 'requirement', 'proposal'],
    questions: [
      '当前目录下有哪些标准方案？',
      '这些方案的关键参数差异在哪？',
      '按适用场景，该选哪个方案？',
      '哪些方案还没发布、仍在草稿？',
      '这些方案的参考价格和交期分别是多少？',
    ],
    context: [
      `页面：标准方案（共 ${allSolutions.length} 个，当前目录下 ${listData.length} 个）`,
      selectedDir ? `当前目录：${selectedDir}` : '当前目录：全部',
      search ? `搜索关键词：${search}` : '',
      '当前方案清单：',
      ...listData
        .slice(0, 40)
        .map(
          (x: Solution, i: number) =>
            `${i + 1}. ${(x as any).solutionNo || ''} ${x.name || ''}｜目录 ${(x as any).directory || '—'}｜状态 ${x.status || '—'}｜参考价 ${(x as any).priceRange || '—'}｜交期 ${(x as any).deliveryCycle || '—'}`,
        ),
    ]
      .filter(Boolean)
      .join('\n'),
  })

  // 目录各级已有值，作为级联下拉的候选（选已有或输新的）
  const dirSegmentValues = (idx: number) => {
    const set = new Set<string>()
    for (const s of allSolutions) {
      const seg = (s.directory || '').split('/')[idx]?.trim()
      if (seg) set.add(seg)
    }
    return [...set].sort()
  }
  const materialOptions = dirSegmentValues(0)
  const plantOptions = dirSegmentValues(1)
  const lineOptions = dirSegmentValues(2)

  useEffect(() => {
    if (!highlightId || !listData.length) return
    const highlighted = listData.find((item: Solution) => item.id === highlightId)
    if (highlighted) {
      setSelected(highlighted)
      setDrawerOpen(true)
    }
  }, [highlightId, listData])
  const products = Array.isArray(productsQuery.data) ? productsQuery.data : productsQuery.data?.list || []
  // 按产品分类的「大类 / 子类」分组，便于在几十上百个产品里定位。value 仍是 productId。
  const productOptions = products
    .map((p) => {
      const parts = String(p.category || '其他').split('/').map((s: string) => s.trim()).filter(Boolean)
      const group = parts.slice(0, 2).join(' / ') || '其他'
      return { value: p.id, label: p.name, group }
    })
    .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group.localeCompare(b.group)))
  const productName = (pid?: string) => (pid ? products.find((p) => p.id === pid)?.name : undefined)

  const refreshDetail = () => {
    if (selected?.id) queryClient.invalidateQueries({ queryKey: ['solution', selected.id] })
  }

  const saveMutation = useMutation({
    mutationFn: (dto: any) => (editing ? solutionApi.update(editing.id, dto) : solutionApi.create(dto)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['solutions'] })
      closeModal()
      refetch()
    },
    onError: handleError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => solutionApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['solutions'] })
      setDeleteId(null)
      refetch()
    },
    onError: handleError,
  })

  const copyMutation = useMutation({
    mutationFn: (id: string) => solutionApi.copy(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['solutions'] })
      toast.success('已复制为新方案（草稿）')
      refetch()
    },
    onError: handleError,
  })

  // 停用 / 启用：只改状态，不进编辑弹窗
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => solutionApi.update(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['solutions'] })
      refreshDetail()
      refetch()
    },
    onError: handleError,
  })

  const saveConfigOptionMutation = useMutation({
    mutationFn: (dto: any) => solutionApi.upsertConfigOption(dto),
    onSuccess: () => {
      refreshDetail()
      setConfigOptionOpen(false)
      toast.success('配置项已保存')
    },
    onError: handleError,
  })

  const deleteConfigOptionMutation = useMutation({
    mutationFn: (id: string) => solutionApi.removeConfigOption(id),
    onSuccess: () => {
      refreshDetail()
      setDeletingConfigOption(null)
      toast.success('配置项已删除')
    },
    onError: handleError,
  })

  const savePriceTableMutation = useMutation({
    mutationFn: (dto: any) => solutionApi.upsertPriceTable(dto),
    onSuccess: () => {
      refreshDetail()
      setPriceTableOpen(false)
      toast.success('价格表已保存')
    },
    onError: handleError,
  })

  const deletePriceTableMutation = useMutation({
    mutationFn: (id: string) => solutionApi.removePriceTable(id),
    onSuccess: () => {
      refreshDetail()
      setDeletingPriceTable(null)
      toast.success('价格表已删除')
    },
    onError: handleError,
  })

  const calcMutation = useMutation({
    mutationFn: (dto: any) => solutionApi.calculatePrice(dto),
    onSuccess: (res) => setPriceResult(res),
    onError: handleError,
  })

  const openCreate = () => {
    setEditing(null)
    reset()
    setModalOpen(true)
  }

  // ── 目录树管理 ──
  const dirActions = {
    order: dirOrder,
    onReorder: (parentPath: string, siblings: string[], key: string, dir: -1 | 1) => {
      const next = reorderOrder(dirOrder, parentPath, siblings, key, dir)
      setDirOrder(next)
      saveOrder('aikb-solution-dir-order', next)
    },
    // 点节点「+」：把节点路径拆成材料/厂名/机组预填进新建弹窗，只需填名称+选设备
    onAddChild: (path: string) => {
      const segs = path.split('/').map((s) => s.trim()).filter(Boolean)
      setEditing(null)
      reset()
      setValues((prev) => ({ ...prev, material: segs[0] || '', plant: segs[1] || '', line: segs[2] || '' }))
      setModalOpen(true)
    },
    onMoveNode: (path: string) => {
      setNodeAction({ mode: 'move', path })
      setNodeActionValue(path.split('/').slice(0, -1).join('/'))
    },
    onRenameNode: (path: string) => {
      setNodeAction({ mode: 'rename', path })
      setNodeActionValue(path.split('/').slice(-1)[0] || '')
    },
  }

  const moveDirMutation = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => solutionApi.moveDirectory(from, to),
    onSuccess: (res) => {
      toast.success(`已更新 ${res.moved} 个方案的目录`)
      setNodeAction(null)
      queryClient.invalidateQueries({ queryKey: ['solutions'] })
      refetch()
    },
    onError: handleError,
  })

  const confirmNodeAction = () => {
    if (!nodeAction) return
    const segs = nodeAction.path.split('/')
    const last = segs[segs.length - 1]
    const parent = segs.slice(0, -1).join('/')
    const v = nodeActionValue.trim()
    if (!v) return
    const to = nodeAction.mode === 'rename' ? [parent, v].filter(Boolean).join('/') : [v, last].filter(Boolean).join('/')
    if (to === nodeAction.path) { setNodeAction(null); return }
    moveDirMutation.mutate({ from: nodeAction.path, to })
  }

  // 目录节点的已有路径，供「移动到」输入补全
  const allDirPaths = (() => {
    const set = new Set<string>()
    for (const s of allSolutions as Solution[]) {
      const segs = (s.directory || '').split('/').map((x: string) => x.trim()).filter(Boolean)
      let p = ''
      for (const seg of segs) { p = p ? `${p}/${seg}` : seg; set.add(p) }
    }
    return [...set].sort()
  })()

  const setPageActions = usePageActions()
  // 左侧目录树可拖拽调宽（宽度存本地，右侧随 flex 伸缩）
  const navPanel = useResizablePanel('aikb-nav-width-solutions', 250)
  useEffect(() => {
    setPageActions(
      <>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          {/* 非受控：受控 value 在 IME 组字时被重渲染打断（拼音乱码），搜索只靠 onChange */}
          <input
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索方案…"
            className="eo-input !w-60 !pl-8 !py-1 !text-sm"
          />
        </div>
        <Button onClick={openCreate} size="sm" className="!py-1 !text-sm">
          <Plus size={13} className="mr-0.5" /> 新建
        </Button>
        {/* 批量操作收到顶栏：选中后才出现，琥珀修改/红色删除一眼可见 */}
        <BatchEditBar
          selectedKeys={selectedKeys}
          onClear={() => setSelectedKeys([])}
          moduleName="方案"
          queryKey={['solutions']}
          updateFn={(id, dto) => solutionApi.update(id, dto)}
          deleteFn={(id) => solutionApi.remove(id)}
          fields={[
            { key: 'solutionType', label: '方案类型', options: solutionTypeOptions },
            { key: 'status', label: '状态', options: statusOptions },
          ]}
        />
      </>
    )
    return () => setPageActions(null)
     
  }, [selectedKeys])

  const openEdit = (row: Solution) => {
    setEditing(row)
    setValues({
      name: row.name || '',
      productId: row.productId || '',
      solutionType: row.solutionType || 'standard',
      // 目录路径拆回材料/厂名/机组三段；第 4 级设备由 productId 决定
      material: (row.directory || '').split('/')[0]?.trim() || '',
      plant: (row.directory || '').split('/')[1]?.trim() || '',
      line: (row.directory || '').split('/')[2]?.trim() || '',
      description: row.description || '',
      scenario: row.scenario || '',
      keyParams: row.keyParams || '',
      priceRange: row.priceRange || '',
      deliveryCycle: row.deliveryCycle || '',
      tags: (row.tags || []).join(', '),
      // 旧数据的 approved 归一到 published，避免下拉出现空选项
      status: (row.status === 'approved' ? 'published' : row.status) || 'published',
      cadTemplateUrl: row.cadTemplateUrl || '',
      agreementTemplateUrl: row.agreementTemplateUrl || '',
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    reset()
  }

  const openDetail = (row: Solution) => {
    setSelected(row)
    setDrawerOpen(true)
  }

  const handleSubmit = () => {
    if (!validateAll()) return
    // material/plant/line 是本地表单字段，不进 DTO（后端 forbidNonWhitelisted）；
    // 目录由 材料/厂名/机组/设备(所选产品名) 四级拼成
    const { material, plant, line, ...rest } = form as any
    const dto: any = { ...rest }
    const deviceName = productName(form.productId) || ''
    dto.directory = [material, plant, line, deviceName]
      .map((s: string) => (s || '').trim())
      .filter(Boolean)
      .join('/')
    dto.tags = (form.tags as string).split(',').map((t) => t.trim()).filter(Boolean)
    // 适用参数摘要由结构化关键参数自动派生，供展示与匹配召回，无需手填
    const params = parseSolutionParams(form.keyParams as string).filter((p) => (p.value ?? '') !== '')
    dto.paramSummary = params.map((p) => `${p.name} ${p.value}${p.unit || ''}`.trim()).join('；')
    saveMutation.mutate(dto)
  }

  const openAddConfigOption = () => {
    setConfigOptionForm({ id: '', key: '', label: '', choices: '[]', constraintRules: '', sortOrder: 0 })
    setConfigOptionOpen(true)
  }

  const openEditConfigOption = (opt: ConfigOption) => {
    setConfigOptionForm({
      id: opt.id || '',
      key: opt.key,
      label: opt.label,
      choices: opt.choices || '[]',
      constraintRules: opt.constraintRules || '',
      sortOrder: opt.sortOrder || 0,
    })
    setConfigOptionOpen(true)
  }

  const handleConfigOptionSubmit = () => {
    if (!selected?.id || !configOptionForm.key.trim()) return
    saveConfigOptionMutation.mutate({
      id: configOptionForm.id || undefined,
      solutionId: selected.id,
      key: configOptionForm.key,
      label: configOptionForm.label,
      choices: configOptionForm.choices,
      constraintRules: configOptionForm.constraintRules?.trim() || undefined,
      sortOrder: configOptionForm.sortOrder,
    })
  }

  const openAddPriceTable = () => {
    setPriceTableForm({ id: '', optionKey: '', optionValue: '', priceDelta: 0, cost: 0, leadTime: '', supplyLevel: '' })
    setPriceTableOpen(true)
  }

  const openEditPriceTable = (pt: PriceTable) => {
    setPriceTableForm({
      id: pt.id || '',
      optionKey: pt.optionKey,
      optionValue: pt.optionValue,
      priceDelta: pt.priceDelta,
      cost: pt.cost ?? 0,
      leadTime: pt.leadTime || '',
      supplyLevel: pt.supplyLevel || '',
    })
    setPriceTableOpen(true)
  }

  const handlePriceTableSubmit = () => {
    if (!selected?.id || !priceTableForm.optionKey.trim()) return
    savePriceTableMutation.mutate({
      id: priceTableForm.id || undefined,
      solutionId: selected.id,
      optionKey: priceTableForm.optionKey,
      optionValue: priceTableForm.optionValue,
      priceDelta: Number(priceTableForm.priceDelta),
      cost: Number(priceTableForm.cost),
      leadTime: priceTableForm.leadTime,
      supplyLevel: priceTableForm.supplyLevel,
    })
  }

  const handleCalculate = () => {
    if (!selected?.id) return
    calcMutation.mutate({ solutionId: selected.id, config: '{}' })
  }

  // 方案全量在前端，卡片与左侧目录树同源
  const solutionCards = [
    { label: '方案总数', value: allSolutions.length, icon: Boxes },
    {
      label: '已发布',
      value: allSolutions.filter((s: Solution) => s.status === 'published' || s.status === 'approved').length,
      icon: CheckCircle2,
    },
    {
      label: '草稿',
      value: allSolutions.filter((s: Solution) => !s.status || s.status === 'draft').length,
      icon: FileEdit,
    },
    {
      label: '目录数',
      value: new Set(allSolutions.map((s: Solution) => s.directory).filter(Boolean)).size,
      icon: FolderTree,
    },
    {
      label: '关联产品',
      value: new Set(allSolutions.map((s: Solution) => s.productId).filter(Boolean)).size,
      icon: Package,
    },
  ]

  return (
    <div className="space-y-4">
    <StatCards loading={isLoading && !data} skeletonCount={5} items={solutionCards} />

    <div className="flex flex-col lg:flex-row gap-4">
      {/*
        左右布局：目录树当导航常驻左侧；搜索框已移到顶栏操作区。
        目录以方案的 directory（斜杠路径，如 普碳钢/酸洗线）表达层级，
        前端还原成父/子目录树，点节点即筛出该目录（含子目录）下的方案。
      */}
      <aside className="lg:w-[250px] flex-shrink-0" style={navPanel.panelStyle}>
        <div className="eo-card p-3 lg:sticky lg:top-4 space-y-3">
          <div className="max-h-[62vh] overflow-y-auto eo-scroll">
            <SolutionDirectoryTree solutions={allSolutions} selected={selectedDir} onSelect={setSelectedDir} actions={dirActions} />
          </div>
          <p className="text-caption text-muted mt-2 px-1">悬停目录可 新建 / 排序 / 移动 / 重命名</p>
        </div>
      </aside>
      <ResizeHandle onMouseDown={navPanel.startDrag} />

      <div className="flex-1 min-w-0">
      {isLoading && !data && <PageLoader />}
      {isError && <ErrorState message={error?.message || '加载失败'} onRetry={refetch} />}
      {!isLoading && !isError && (
        <DataTable
          loading={isLoading}
          data={listData}
          columns={[
            { key: 'solutionNo', title: '方案编号', render: (row) => <span className="font-mono text-caption">{row.solutionNo || '—'}</span> },
            { key: 'name', title: '方案名称' },
            { key: 'solutionType', title: '方案类型', render: (row) => solutionTypeLabel(row.solutionType) },
            { key: 'productId', title: '适用产品线', render: (row) => productName(row.productId) || '—' },
            { key: 'version', title: '版本', render: (row) => `v${row.version || 1}` },
            { key: 'status', title: '状态', render: (row) => <StatusBadge kind="library" status={row.status} /> },
          ]}
          rowKey={(row) => row.id}
          onRowDoubleClick={(row) => openDetail(row)}
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          pagination={{
            page,
            pageSize,
            onChange: (p, ps) => {
              setPage(p)
              setPageSize(ps)
            },
          }}
          actions={(row) => (
            <div className="flex items-center gap-2">
              <button onClick={() => openDetail(row)} className="text-accent-600 hover:text-accent-700" title={"查看"}
              aria-label="查看">
                <Eye size={16} />
              </button>
              <button onClick={() => openEdit(row)} className="text-ink-soft hover:text-ink" title={"编辑"}
              aria-label="编辑">
                <Pencil size={16} />
              </button>
              <button onClick={() => copyMutation.mutate(row.id)} className="text-ink-soft hover:text-ink" title={"复制"}
              aria-label="复制">
                <Copy size={16} />
              </button>
              {row.status === 'disabled' ? (
                <button onClick={() => statusMutation.mutate({ id: row.id, status: 'published' })} className="text-success-fg hover:opacity-80" title={"启用"}
                aria-label="启用">
                  <CheckCircle2 size={16} />
                </button>
              ) : (
                <button onClick={() => statusMutation.mutate({ id: row.id, status: 'disabled' })} className="text-ink-soft hover:text-warning-fg" title={"停用"}
                aria-label="停用">
                  <Ban size={16} />
                </button>
              )}
              <button onClick={() => setDeleteId(row.id)} className="text-danger-fg hover:text-danger-fg" title={"删除"}
              aria-label="删除">
                <Trash2 size={16} />
              </button>
            </div>
          )}
        />
      )}
      </div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? '编辑方案' : '新建方案'}
        onConfirm={handleSubmit}
        loading={saveMutation.isPending}
        confirmDisabled={!isValid}
        size="lg"
      >
        <div className="space-y-6">
          <FormSection title="基本信息" icon={Boxes}>
          <FieldGrid>
            {editing && (
              <>
                <FormInput
                  label="方案编号"
                  value={editing.solutionNo || '—'}
                  readOnly
                  helper="标准方案不走流水编号（靠技术方案匹配定位），历史编号仅保留展示"
                />
                <FormInput label="版本" value={`v${editing.version || 1}`} readOnly />
              </>
            )}
            <FormInput label="方案名称" value={form.name} onChange={(e) => setValue('name', e.target.value)} error={errors.name} required />
            <FormSelect label="方案类型" options={solutionTypeOptions} value={form.solutionType} onChange={(e) => setValue('solutionType', e.target.value)} />
            {/* 产品可能有几十上百个，原生 select 只能滚着找，改成输入即筛选 */}
            <SearchableSelect
              label="产品类型"
              options={productOptions}
              value={form.productId}
              onChange={(v) => setValue('productId', v)}
              placeholder="按产品名筛选，或点击展开选择（按大类/子类分组）"
              emptyText="没有匹配的产品"
              helper="目录第 4 级「设备」取自这里"
            />
            <FormSelect label="状态" options={statusOptions} value={form.status} onChange={(e) => setValue('status', e.target.value)} />
            <div className="md:col-span-2">
              <span className="eo-label">目录归属（左侧树：材料 / 厂名 / 机组 / 设备）</span>
              {/*
                原来是 <input list=datalist>：候选要靠浏览器自己弹，点击不一定展开、
                中文筛选各家实现还不一致。换成与「需求模板」分类一致的可搜索下拉，
                allowCustom 保留"直接打新名字即建新目录"的用法。
              */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1.5">
                <SearchableSelect
                  ariaLabel="材料"
                  value={form.material}
                  onChange={(v) => setValue('material', v)}
                  options={materialOptions.map((o) => ({ value: o, label: o }))}
                  placeholder="材料，如 普碳钢"
                  allowCustom
                  emptyText="没有匹配的材料"
                  newValueHint={(t) => `将新建材料目录「${t}」`}
                />
                <SearchableSelect
                  ariaLabel="厂名"
                  value={form.plant}
                  onChange={(v) => setValue('plant', v)}
                  options={plantOptions.map((o) => ({ value: o, label: o }))}
                  placeholder="厂名，如 冷轧厂"
                  allowCustom
                  emptyText="没有匹配的厂名"
                  newValueHint={(t) => `将新建厂名目录「${t}」`}
                />
                <SearchableSelect
                  ariaLabel="机组"
                  value={form.line}
                  onChange={(v) => setValue('line', v)}
                  options={lineOptions.map((o) => ({ value: o, label: o }))}
                  placeholder="机组，如 酸洗线"
                  allowCustom
                  emptyText="没有匹配的机组"
                  newValueHint={(t) => `将新建机组目录「${t}」`}
                />
              </div>
              <p className="text-caption text-muted mt-1">第 4 级「设备」取自上方「适用产品线」；可选已有目录或直接输入新目录。</p>
            </div>
            <FormInput label="关键词标签 (逗号分隔)" value={form.tags} onChange={(e) => setValue('tags', e.target.value)} placeholder="如：铝板带, 拉矫, 1500mm" />
            <div className="md:col-span-2">
              <FormTextarea label="方案摘要" value={form.description} onChange={(e) => setValue('description', e.target.value)} rows={3} />
            </div>
            <div className="md:col-span-2">
              <FormTextarea label="适用场景" value={form.scenario} onChange={(e) => setValue('scenario', e.target.value)} rows={2} placeholder="典型应用场景" />
            </div>
          </FieldGrid>
          </FormSection>

          <FormSection title="关键参数" hint="填写方案适用的参数值/范围，用于需求自动匹配">
            <SolutionParamEditor
              key={editing?.id || 'new'}
              value={form.keyParams}
              onChange={(v) => setValue('keyParams', v)}
            />
          </FormSection>

          <FormSection title="商务信息">
          <FieldGrid>
            <FormInput label="参考价格区间" value={form.priceRange} onChange={(e) => setValue('priceRange', e.target.value)} placeholder="如：200-350万" />
            <FormInput label="典型交付周期" value={form.deliveryCycle} onChange={(e) => setValue('deliveryCycle', e.target.value)} placeholder="如：90-120天" />
          </FieldGrid>
          </FormSection>

          <FormSection title="配套模板" hint="出方案时可直接取用（协议/图纸文件可在详情页上传管理）">
          <FieldGrid>
            <FormInput label="CAD 模板地址" value={form.cadTemplateUrl} onChange={(e) => setValue('cadTemplateUrl', e.target.value)} />
            <FormInput label="协议模板地址" value={form.agreementTemplateUrl} onChange={(e) => setValue('agreementTemplateUrl', e.target.value)} />
          </FieldGrid>
          </FormSection>
        </div>
      </Modal>

      <Modal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="确认删除"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
        confirmText="删除"
      >
        <p className="text-sm text-ink-soft">确定要删除该方案吗？删除后无法恢复。</p>
      </Modal>

      {/* 配置项 / 价格表删除确认：它们是方案报价的计算依据，删错会让算出来的价直接变样 */}
      <ConfirmDialog
        open={!!deletingConfigOption}
        onClose={() => setDeletingConfigOption(null)}
        onConfirm={() => deletingConfigOption && deleteConfigOptionMutation.mutate(deletingConfigOption.id)}
        loading={deleteConfigOptionMutation.isPending}
        title="确认删除配置项"
        message={<>确定删除配置项「{deletingConfigOption?.key}」吗？</>}
        detail="删除后无法恢复，引用该配置项的价格表将失去依据，方案报价结果会随之变化。"
      />

      <ConfirmDialog
        open={!!deletingPriceTable}
        onClose={() => setDeletingPriceTable(null)}
        onConfirm={() => deletingPriceTable && deletePriceTableMutation.mutate(deletingPriceTable.id)}
        loading={deletePriceTableMutation.isPending}
        title="确认删除价格表"
        message={
          <>确定删除价格表「{deletingPriceTable?.optionKey}: {deletingPriceTable?.optionValue}」吗？</>
        }
        detail="删除后无法恢复，这一项的加价与成本不再计入方案报价。"
      />

      {/* 目录节点：移动 / 重命名（批量改其下方案的 directory） */}
      <Modal
        open={!!nodeAction}
        onClose={() => setNodeAction(null)}
        title={nodeAction?.mode === 'rename' ? '重命名目录' : '移动目录'}
        onConfirm={confirmNodeAction}
        loading={moveDirMutation.isPending}
        confirmDisabled={!nodeActionValue.trim()}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {nodeAction?.mode === 'rename'
              ? `重命名「${nodeAction?.path}」；其下所有方案的目录会一并更新。`
              : `把「${nodeAction?.path}」移动到新的父目录下；其下所有方案的目录会一并更新。`}
          </p>
          <div>
            <span className="eo-label">
              {nodeAction?.mode === 'rename' ? '新名称' : '移动到（父目录路径，留空 = 顶层）'}
            </span>
            <input
              className="eo-input mt-1.5"
              value={nodeActionValue}
              onChange={(e) => setNodeActionValue(e.target.value)}
              placeholder={nodeAction?.mode === 'rename' ? '如 连续镀锌线' : '如 不锈钢/热轧厂'}
              list={nodeAction?.mode === 'move' ? 'sol-dir-paths' : undefined}
              aria-label="目录"
            />
            {nodeAction?.mode === 'move' && (
              <datalist id="sol-dir-paths">{allDirPaths.map((p) => <option key={p} value={p} />)}</datalist>
            )}
          </div>
        </div>
      </Modal>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="方案详情" width="w-[560px]">
        {detailQuery.isLoading ? (
          <PageLoader />
        ) : detailQuery.isError ? (
          <ErrorState message={detailQuery.error?.message || '加载失败'} onRetry={() => detailQuery.refetch()} />
        ) : (
          <div className="space-y-6">
            <DetailHeader
              title={detailQuery.data?.name}
              code={detailQuery.data?.solutionNo || `v${detailQuery.data?.version || 1}`}
              badge={<StatusBadge kind="library" status={detailQuery.data?.status} />}
              stats={[
                { label: '方案类型', value: solutionTypeLabel(detailQuery.data?.solutionType) },
                { label: '适用产品线', value: productName(detailQuery.data?.productId) },
                { label: '版本', value: `v${detailQuery.data?.version || 1}` },
              ]}
            />

            <DetailSection title="基本信息">
              <DescList
                items={[
                  { label: '目录', value: detailQuery.data?.directory },
                  { label: '方案摘要', value: detailQuery.data?.description, full: true },
                  { label: '适用场景', value: detailQuery.data?.scenario, full: true },
                  { label: '参考价格区间', value: detailQuery.data?.priceRange },
                  { label: '典型交付周期', value: detailQuery.data?.deliveryCycle },
                  { label: '关键词标签', value: (detailQuery.data?.tags || []).join('、') },
                ].filter((it) => it.value)}
              />
            </DetailSection>

            {parseSolutionParams(detailQuery.data?.keyParams).some((p) => (p.value ?? '') !== '') && (
              <DetailSection title="关键参数">
                <SolutionParamView value={detailQuery.data?.keyParams} />
              </DetailSection>
            )}

            {/* P2：技术协议 / 方案图纸 —— 复用资料中心，按分类分区 */}
            <DetailSection title="技术协议">
              {detailQuery.data?.id && (
                <SolutionAssetSection
                  solutionId={detailQuery.data.id}
                  category="技术协议"
                  title="协议文件"
                  hint="上传 Word/PDF 版技术协议，支持多版本"
                />
              )}
            </DetailSection>

            <DetailSection title="方案图纸">
              {detailQuery.data?.id && (
                <SolutionAssetSection
                  solutionId={detailQuery.data.id}
                  category="方案图纸"
                  title="图纸文件"
                  hint="上传 CAD/DWG/PDF 图纸，如总布置图、部件图"
                />
              )}
            </DetailSection>

            {(detailQuery.data?.cadTemplateUrl || detailQuery.data?.agreementTemplateUrl) && (
              <DetailSection title="配套模板">
                <DescList
                  items={[
                    { label: 'CAD 模板', value: detailQuery.data?.cadTemplateUrl, full: true },
                    { label: '协议模板', value: detailQuery.data?.agreementTemplateUrl, full: true },
                  ]}
                />
              </DetailSection>
            )}

            <div className="flex items-center gap-3">
              <Button onClick={handleCalculate} loading={calcMutation.isPending}>
                <Calculator size={16} className="mr-1" /> 计算价格
              </Button>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-ink">配置选项 ({detailQuery.data?.configOptions?.length || 0})</h4>
                <Button type="button" variant="secondary" onClick={openAddConfigOption} className="py-1 px-2 text-xs">
                  <PlusCircle size={14} className="mr-1" /> 添加
                </Button>
              </div>
              {(detailQuery.data?.configOptions || []).length === 0 ? (
                <p className="text-sm text-muted">暂无配置选项</p>
              ) : (
                <div className="space-y-2">
                  {(detailQuery.data?.configOptions || []).map((opt) => (
                    <div key={opt.id} className="flex items-center justify-between bg-subtle p-3 rounded-md text-sm">
                      <div className="min-w-0">
                        <div className="font-medium">{opt.key} {opt.label ? <span className="text-muted">({opt.label})</span> : null}</div>
                        <div className="text-xs text-muted truncate">可选值：{opt.choices || '[]'}</div>
                        {opt.constraintRules && (
                          <div className="text-xs text-warning-fg truncate mt-0.5" title={opt.constraintRules}>
                            依赖规则：{opt.constraintRules}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => openEditConfigOption(opt)} className="text-ink-soft hover:text-ink" title={"编辑配置项"}
                        aria-label="编辑配置项">
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => setDeletingConfigOption(opt)} className="text-danger-fg hover:text-danger-fg" title={"删除配置项"}
                        aria-label="删除配置项">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-ink">价格表 ({detailQuery.data?.priceTables?.length || 0})</h4>
                <Button type="button" variant="secondary" onClick={openAddPriceTable} className="py-1 px-2 text-xs">
                  <PlusCircle size={14} className="mr-1" /> 添加
                </Button>
              </div>
              {(detailQuery.data?.priceTables || []).length === 0 ? (
                <p className="text-sm text-muted">暂无价格表</p>
              ) : (
                <div className="space-y-2">
                  {(detailQuery.data?.priceTables || []).map((pt) => (
                    <div key={pt.id} className="flex items-center justify-between bg-subtle p-3 rounded-md text-sm">
                      <div className="min-w-0">
                        <div className="font-medium">{pt.optionKey}: {pt.optionValue}</div>
                        <div className="text-xs text-muted">
                          加价 ¥{pt.priceDelta} · 成本 ¥{pt.cost}
                          {pt.leadTime ? ` · ${pt.leadTime}` : ''}
                          {pt.supplyLevel ? ` · ${pt.supplyLevel}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => openEditPriceTable(pt)} className="text-ink-soft hover:text-ink" title={"编辑价格表"}
                        aria-label="编辑价格表">
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => setDeletingPriceTable(pt)} className="text-danger-fg hover:text-danger-fg" title={"删除价格表"}
                        aria-label="删除价格表">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        open={configOptionOpen}
        onClose={() => setConfigOptionOpen(false)}
        title={configOptionForm.id ? '编辑配置项' : '添加配置项'}
        onConfirm={handleConfigOptionSubmit}
        loading={saveConfigOptionMutation.isPending}
        confirmDisabled={!configOptionForm.key.trim()}
      >
        <div className="space-y-4">
          <FormInput label="选项 Key" value={configOptionForm.key} onChange={(e) => setConfigOptionForm({ ...configOptionForm, key: e.target.value })} required />
          <FormInput label="显示名称" value={configOptionForm.label} onChange={(e) => setConfigOptionForm({ ...configOptionForm, label: e.target.value })} />
          <FormInput label="排序" type="number" value={configOptionForm.sortOrder} onChange={(e) => setConfigOptionForm({ ...configOptionForm, sortOrder: Number(e.target.value) })} />
          <FormTextarea
            label="可选项 (JSON)"
            rows={4}
            value={configOptionForm.choices}
            onChange={(e) => setConfigOptionForm({ ...configOptionForm, choices: e.target.value })}
            helper='例如：["A","B"] 或 [{"value":"A","priceDelta":100}]'
          />
          <FormTextarea
            label="配置依赖规则 (JSON，选填)"
            rows={4}
            value={configOptionForm.constraintRules}
            onChange={(e) => setConfigOptionForm({ ...configOptionForm, constraintRules: e.target.value })}
            helper='配置项间的互斥/依赖，如 {"requires":[{"key":"辊数","value":"21"}],"excludes":[{"key":"张力控制","value":"电气"}]}'
          />
        </div>
      </Modal>

      <Modal
        open={priceTableOpen}
        onClose={() => setPriceTableOpen(false)}
        title={priceTableForm.id ? '编辑价格表' : '添加价格表'}
        onConfirm={handlePriceTableSubmit}
        loading={savePriceTableMutation.isPending}
        confirmDisabled={!priceTableForm.optionKey.trim()}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormInput label="选项 Key" value={priceTableForm.optionKey} onChange={(e) => setPriceTableForm({ ...priceTableForm, optionKey: e.target.value })} required />
            <FormInput label="选项值" value={priceTableForm.optionValue} onChange={(e) => setPriceTableForm({ ...priceTableForm, optionValue: e.target.value })} />
            <FormInput label="加价" type="number" value={priceTableForm.priceDelta} onChange={(e) => setPriceTableForm({ ...priceTableForm, priceDelta: Number(e.target.value) })} />
            <FormInput label="成本" type="number" value={priceTableForm.cost} onChange={(e) => setPriceTableForm({ ...priceTableForm, cost: Number(e.target.value) })} />
            <FormInput label="交期" value={priceTableForm.leadTime} onChange={(e) => setPriceTableForm({ ...priceTableForm, leadTime: e.target.value })} />
            <FormInput label="供应等级" value={priceTableForm.supplyLevel} onChange={(e) => setPriceTableForm({ ...priceTableForm, supplyLevel: e.target.value })} />
          </div>
        </div>
      </Modal>

      <Modal open={!!priceResult} onClose={() => setPriceResult(null)} title="价格计算结果">
        <div className="space-y-4">
          {/* 三个数横排：总价、成本、毛利率是看结果时唯一关心的，不该埋在一列文字里 */}
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="总价"
              value={priceResult?.totalPrice != null ? `¥${Number(priceResult.totalPrice).toLocaleString('zh-CN')}` : null}
              emphasis
            />
            <Stat
              label="成本"
              value={priceResult?.cost != null ? `¥${Number(priceResult.cost).toLocaleString('zh-CN')}` : null}
            />
            <Stat
              label="毛利率"
              value={priceResult?.margin != null ? `${priceResult.margin}%` : null}
            />
          </div>

          {/* 原始返回留作排查用，默认收起，不再霸占整个弹窗 */}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted hover:text-ink select-none">查看计算明细</summary>
            <pre className="bg-subtle p-3 rounded-md mt-2 overflow-auto max-h-64">{JSON.stringify(priceResult, null, 2)}</pre>
          </details>
          <div className="flex justify-end pt-2">
            <Button variant="secondary" onClick={() => setPriceResult(null)}>关闭</Button>
          </div>
        </div>
      </Modal>
    </div>
    </div>
  )
}
