import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus,
  Eye,
  Pencil,
  Trash2,
  PlusCircle,
  MinusCircle,
  Truck,
  Scale,
  Package,
  Globe,
  AlertTriangle,
  Search,
  MapPin,
  Award,
  BadgeCheck,
  ListTree,
  CheckSquare,
  PencilLine,
  Download,
  X,
} from 'lucide-react'
import { supplierApi, supplierProductApi, materialApi } from '../api/services'
import { useDebounce } from '../hooks/useDebounce'
import { usePagedQuery } from '../hooks/usePagedQuery'
import { useFormValidation, required } from '../hooks/useFormValidation'
import { useModuleStats } from '../hooks/useModuleStats'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'
import { usePageActions } from '../contexts/PageActionsContext'
import StatCards from '../components/StatCards'
import NavPager from '../components/NavPager'
import {
  type Supplier,
  type SupplierCapability,
  type SupplierProduct,
  SUPPLIER_ORIGIN_OPTIONS,
  SUPPLIER_TIER_OPTIONS,
  COOPERATION_LEVEL_OPTIONS,
  SUPPLIER_RATING_OPTIONS,
  PRICE_SOURCE_OPTIONS,
} from '../types'
import Button from '../components/Button'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import Drawer from '../components/Drawer'
import EntityPicker from '../components/EntityPicker'
import FormInput from '../components/FormInput'
import FormSelect from '../components/FormSelect'
import FormTextarea from '../components/FormTextarea'
import DataTable from '../components/DataTable'
import PageHeader from '../components/PageHeader'
import { useSupplierCategories } from '../hooks/useSupplierCategories'
import { FormSection, FieldGrid } from '../components/layout-kit'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import EmptyState from '../components/EmptyState'
import StatusBadge from '../components/StatusBadge'
import KeyValueList from '../components/KeyValueList'
import Tabs from '../components/Tabs'
import FilterPanel, { type FilterGroupDef, type FilterValues } from '../components/FilterPanel'
import { useNavPageSize, clampNavPage } from '../hooks/useNavPageSize'

const initialForm = {
  name: '',
  code: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  origin: '',
  country: '',
  tier: '',
  productCategories: [] as string[],
  qualification: '',
  cooperationLevel: 'candidate',
  paymentTerms: '',
  rating: 'b',
  description: '',
  capabilities: [{ capability: '', category: '', description: '' }] as SupplierCapability[],
}

const handleError = (error: any) => {
  toast.error(error?.response?.data?.message || error?.message || '操作失败')
}

const fmtMoney = (v?: number | null, currency = 'CNY') => {
  if (v == null) return '-'
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '¥'
  return `${symbol}${Number(v).toLocaleString('zh-CN')}`
}

const priceRange = (min?: number | null, max?: number | null) => {
  if (min == null && max == null) return '-'
  if (min != null && max != null && min !== max) return `${fmtMoney(min)} ~ ${fmtMoney(max)}`
  return fmtMoney(min ?? max)
}

export default function Suppliers() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get('highlight')

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [filters, setFilters] = useState<FilterValues>({})
  const [modalOpen, setModalOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detailTab, setDetailTab] = useState('basic')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [selected, setSelected] = useState<Supplier | null>(null)
  const [productModalOpen, setProductModalOpen] = useState(false)

  const { values: form, errors, isValid, setValue, setValues, validateAll, reset } = useFormValidation({
    initialValues: initialForm,
    rules: { name: required('请输入供应商名称') },
  })

  const params = useMemo(() => {
    const cats = (filters.category as string[]) || []
    return {
      keyword: debouncedSearch || undefined,
      origin: (filters.origin as string) || undefined,
      tier: (filters.tier as string) || undefined,
      cooperationLevel: (filters.cooperationLevel as string) || undefined,
      rating: (filters.rating as string) || undefined,
      category: cats.length ? cats.join(',') : undefined,
    }
  }, [debouncedSearch, filters])

  /**
   * 按当前筛选导出供应商分类表（CSV，带 UTF-8 BOM，Excel 双击直开）。
   * 用途：筛"拉弯矫直机"等设备类别后一键导一张表，直接作为附件挂到
   * 项目/需求/工作任务或线下归档。
   */
  const exportCategorySheet = async () => {
    try {
      const PAGE = 200
      const first: any = await supplierApi.list({ ...params, pageSize: PAGE })
      const total = Number(first?.total ?? 0)
      let rows: any[] = Array.isArray(first) ? first : first?.list ?? []
      for (let p = 2; p <= Math.min(Math.ceil(total / PAGE) || 1, 10); p++) {
        const next: any = await supplierApi.list({ ...params, pageSize: PAGE, page: p })
        rows = rows.concat(Array.isArray(next) ? next : next?.list ?? [])
      }
      if (!rows.length) {
        toast.warning('当前筛选没有供应商可导出')
        return
      }
      const ORIGIN = { domestic: '国内', overseas: '国外' } as Record<string, string>
      const esc = (v: unknown) => {
        const s = v == null ? '' : String(v)
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      const header = ['供应商名称', '编码', '主营品类', '联系人', '电话', '邮箱', '来源', '品牌层级', '合作等级', '评级', '地址']
      const lines = rows.map((s: any) =>
        [
          s.name,
          s.code,
          (Array.isArray(s.productCategories) ? s.productCategories : String(s.productCategories || '').split(',').filter(Boolean)).join('、'),
          s.contactName,
          s.phone,
          s.email,
          ORIGIN[s.origin] || s.origin || '',
          s.tier || '',
          s.cooperationLevel || '',
          s.rating ? String(s.rating).toUpperCase() : '',
          s.address,
        ].map(esc).join(','),
      )
      const csv = '\uFEFF' + [header.join(','), ...lines].join('\r\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const cats = (filters.category as string[]) || []
      a.download = `供应商分类表${cats.length ? '_' + cats.join('-') : ''}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
      toast.success(`已导出 ${rows.length} 家供应商${cats.length ? `（${cats.join('、')}）` : ''}`)
    } catch (e: any) {
      toast.error(e?.message || '导出失败')
    }
  }

  const {
    list: listData,
    pagination,
    isLoading,
    isError,
    error,
    refetch,
  } = usePagedQuery<Supplier>({
    key: ['suppliers'],
    filters: params,
    fetcher: (p) => supplierApi.list(p) as any,
    initialPageSize: 15,
  })

  const detailQuery = useQuery({
    queryKey: ['supplier', selected?.id],
    queryFn: () => (selected?.id ? supplierApi.get(selected.id) : null),
    enabled: !!selected?.id,
  })


  const {
    options: catOptions,
    addCategory,
    removeCategory,
    resetCategories,
    isDefault: catIsDefault,
  } = useSupplierCategories()
  const [newCat, setNewCat] = useState('')

  // 批量修改
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkFields, setBulkFields] = useState({ cooperationLevel: '', origin: '' })
  const [bulkCats, setBulkCats] = useState<string[]>([])
  const [bulkCatMode, setBulkCatMode] = useState<'append' | 'replace'>('append')
  // 批量删除：确认弹窗 + 逐条删除进度
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState<{ done: number; total: number } | null>(null)

  const filterGroups: FilterGroupDef[] = [
    { key: 'origin', label: '来源', columns: 2, type: 'radio', options: SUPPLIER_ORIGIN_OPTIONS },
    { key: 'tier', label: '品牌层级', columns: 2, type: 'radio', options: SUPPLIER_TIER_OPTIONS },
    { key: 'category', label: '产品类别', columns: 2, type: 'checkbox', options: catOptions },
    { key: 'cooperationLevel', label: '合作等级', columns: 2, type: 'radio', options: COOPERATION_LEVEL_OPTIONS },
    { key: 'rating', label: '评级', columns: 2, type: 'radio', options: SUPPLIER_RATING_OPTIONS },
  ]

  const activeCount = Object.values(filters).filter((v) => (Array.isArray(v) ? v.length > 0 : !!v)).length

  // 左侧筛选分组翻页：每页条数随屏高自适应，窗口拉高多显示几组，底部不留白
  const navPageSize = useNavPageSize({ rowHeight: 90, min: 3 })
  const [navPage, setNavPage] = useState(1)
  const navTotalPages = Math.max(1, Math.ceil(filterGroups.length / navPageSize))
  const safeFilterPage = clampNavPage(navPage, navTotalPages)
  const pagedFilterGroups = filterGroups.slice(
    (safeFilterPage - 1) * navPageSize,
    safeFilterPage * navPageSize,
  )

  useRegisterPageAssistant({
    key: 'suppliers',
    label: '供应比价',
    sourceTypes: ['supplier', 'product'],
    questions: [
      '本页供应商里，哪些是一线品牌？',
      '这些供应商分别主营什么品类？',
      '国内和国外供应商各有哪些？',
      '按当前筛选，推荐几家优先询价的供应商',
      '本页哪些供应商还只是备选、需要考察？',
    ],
    context: [
      `页面：供应比价（共 ${pagination?.total ?? listData.length} 家，当前第 ${pagination?.page ?? 1} 页）`,
      activeCount ? `已应用 ${activeCount} 个筛选条件` : '',
      '当前页供应商清单：',
      ...listData
        .slice(0, 40)
        .map(
          (x: Supplier, i: number) =>
            `${i + 1}. ${x.name}｜来源 ${x.origin === 'domestic' ? '国内' : x.origin === 'overseas' ? '国外' : '—'}${x.country ? `/${x.country}` : ''}｜层级 ${x.tier || '—'}｜合作等级 ${x.cooperationLevel || '—'}｜品类 ${(x.productCategories || []).join('、') || '—'}`,
        ),
    ]
      .filter(Boolean)
      .join('\n'),
  })

  // 供应商列表是分页的，总数只能由后端算（前端手里只有当前这一页）
  const { stats, isLoading: statsLoading } = useModuleStats()
  const sp = stats?.suppliers
  const supplierCards = [
    { label: '供应商总数', value: sp?.total ?? 0, icon: Truck },
    { label: '国内', value: sp?.domestic ?? 0, icon: MapPin },
    { label: '国外', value: sp?.overseas ?? 0, icon: Globe },
    { label: '一线品牌', value: sp?.tier1 ?? 0, icon: Award },
    { label: '合格供应商', value: sp?.qualified ?? 0, icon: BadgeCheck },
    { label: '产品类别', value: sp?.categories ?? 0, icon: ListTree },
  ]

  const saveMutation = useMutation({
    mutationFn: (dto: any) => (editing ? supplierApi.update(editing.id, dto) : supplierApi.create(dto)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      setModalOpen(false)
      setEditing(null)
      reset()
      toast.success(editing ? '已保存' : '供应商已创建')
    },
    onError: handleError,
  })

  const setPageActions = usePageActions()
  useEffect(() => {
    setPageActions(
      <>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            placeholder="搜索供应商…"
            
            onChange={(e) => setSearch(e.target.value)}
            className="eo-input !w-60 !pl-8 !py-1 !text-sm"
          />
        </div>
        <Button variant="secondary" size="sm" className="!py-1 !text-sm" onClick={() => navigate('/suppliers?tab=materials')}>
          <Scale size={13} className="mr-0.5" /> 比价
        </Button>
        {/* 按当前筛选导出分类表：筛好设备类别后一键成表，可直接作为附件上传归档 */}
        <Button variant="secondary" size="sm" className="!py-1 !text-sm" onClick={exportCategorySheet} title="按当前筛选导出供应商分类表（CSV，Excel 可直接打开）">
          <Download size={13} className="mr-0.5" /> 导出分类表
        </Button>
        <Button size="sm" className="!py-1 !text-sm" onClick={() => { setEditing(null); reset(); setModalOpen(true) }}>
          <Plus size={13} className="mr-0.5" /> 新增
        </Button>
        {/* 批量操作收到顶栏：勾选后才出现，琥珀修改/红色删除一眼可见（与客户业务各页一致） */}
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-lg border border-accent-200 bg-accent-50 pl-2 pr-1 py-1">
            <span className="flex items-center gap-1 text-label font-medium text-accent-600 whitespace-nowrap">
              <CheckSquare size={13} />
              已选 {selectedIds.length} 家
            </span>
            <button onClick={() => setSelectedIds([])} title="取消批量选择" className="p-1 rounded text-muted hover:text-ink hover:bg-canvas transition-colors">
              <X size={13} />
            </button>
            <button
              onClick={() => setBulkOpen(true)}
              className="flex items-center gap-1 rounded-md bg-warning-fg text-white text-label font-medium px-2 py-1 hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <PencilLine size={13} />
              批量修改
            </button>
            <button
              onClick={() => setBulkDeleteOpen(true)}
              className="flex items-center gap-1 rounded-md bg-danger-fg text-white text-label font-medium px-2 py-1 hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <Trash2 size={13} />
              批量删除
            </button>
          </div>
        )}
      </>
    )
    return () => setPageActions(null)
    // params 必须进依赖：导出按钮按"当前筛选"成表，闭包捕获旧筛选会导出错误结果
  }, [selectedIds, params])

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const rows = listData.filter((r: any) => selectedIds.includes(r.id))
      for (const row of rows) {
        const dto: any = {}
        if (bulkFields.cooperationLevel) dto.cooperationLevel = bulkFields.cooperationLevel
        if (bulkFields.origin) dto.origin = bulkFields.origin
        if (bulkCats.length) {
          const old: string[] = Array.isArray(row.productCategories)
            ? row.productCategories
            : String(row.productCategories || '').split(',').filter(Boolean)
          dto.productCategories =
            bulkCatMode === 'replace' ? bulkCats : [...new Set([...old, ...bulkCats])]
        }
        if (Object.keys(dto).length) await supplierApi.update(row.id, dto)
      }
    },
    onSuccess: () => {
      toast.success(`已修改 ${selectedIds.length} 家供应商`)
      setBulkOpen(false)
      setSelectedIds([])
      setBulkFields({ cooperationLevel: '', origin: '' })
      setBulkCats([])
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      refetch()
    },
    onError: handleError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => supplierApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      setDeleteId(null)
      toast.success('已删除')
    },
    onError: handleError,
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      // 逐条删除，带进度：中途失败也告知成/败各多少，不再"一条失败全部白干"式提示
      const failed: string[] = []
      let done = 0
      setBulkDeleteProgress({ done: 0, total: selectedIds.length })
      for (const id of selectedIds) {
        try {
          await supplierApi.remove(id)
        } catch {
          failed.push(id)
        }
        done++
        setBulkDeleteProgress({ done, total: selectedIds.length })
      }
      return { failed }
    },
    onSuccess: ({ failed }) => {
      const ok = selectedIds.length - failed.length
      if (failed.length === 0) {
        toast.success(`已删除 ${ok} 家供应商`)
      } else {
        toast.error(`批量删除完成：成功 ${ok} 家，失败 ${failed.length} 家，请检查失败记录后重试`)
      }
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      setBulkDeleteOpen(false)
      setBulkDeleteProgress(null)
      setSelectedIds([])
      refetch()
    },
    onError: (e: any) => {
      setBulkDeleteProgress(null)
      handleError(e)
    },
  })

  /**
   * 名称归一：去掉空格、括号、连字符并转小写。
   * 「Parker」「PARKER」「派 克」在业务上是一家，字面上却各不相同。
   */
  const normName = (v: string) => v.toLowerCase().replace(/[\s()（）·.、_-]/g, '')

  /** 与已有供应商重名的候选（排除自己） */
  const dupNames = (() => {
    const v = normName(form.name || '')
    if (v.length < 2) return []
    return listData
      .filter((s: any) => s.id !== editing?.id && normName(s.name || '') === v)
      .map((s: any) => s.name)
      .slice(0, 3)
  })()

  const openEdit = (row: Supplier) => {
    setEditing(row)
    setValues({
      name: row.name || '',
      code: row.code || '',
      contactName: row.contactName || '',
      phone: row.phone || '',
      email: row.email || '',
      address: row.address || '',
      origin: row.origin || '',
      country: row.country || '',
      tier: row.tier || '',
      productCategories: row.productCategories || [],
      qualification: (row.qualification || []).join('、'),
      cooperationLevel: row.cooperationLevel || 'candidate',
      paymentTerms: row.paymentTerms || '',
      rating: row.rating || 'b',
      description: row.description || '',
      capabilities: row.capabilities?.length
        ? row.capabilities
        : [{ capability: '', category: '', description: '' }],
    })
    setModalOpen(true)
  }

  const handleSubmit = () => {
    if (!validateAll()) return
    saveMutation.mutate({
      ...form,
      origin: form.origin || undefined,
      tier: form.tier || undefined,
      qualification: form.qualification
        ? form.qualification.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
        : [],
      capabilities: form.capabilities.filter((it) => it.capability?.trim()),
    })
  }

  return (
    <div>
      <PageHeader title="供应商" titleEm="管理" />

      {/* 统计卡片：与业务概览/客户中心同一套组件 */}
      <StatCards className="mb-4" loading={statsLoading} skeletonCount={6} items={supplierCards} />

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="lg:w-[230px] flex-shrink-0 space-y-3">
          {/*
            原来这里有一张只放「全部 N」的卡片。去掉了 ——
            清空筛选用下面 FilterPanel 自带的重置（onReset），功能不丢，
            还省下一整张卡片的高度留给筛选项。
          */}
          <FilterPanel
            groups={pagedFilterGroups}
            values={filters}
            onChange={(key, value) => setFilters((f) => ({ ...f, [key]: value }))}
            onReset={() => setFilters({})}
            activeCount={activeCount}
          />
          {/* 筛选分组翻页：分组多时逐页浏览，每页条数随屏高自适应 */}
          {navTotalPages > 1 && (
            <div className="eo-card p-3">
              <NavPager page={safeFilterPage} totalPages={navTotalPages} onChange={setNavPage} label="筛选组" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {isLoading && <PageLoader />}
          {isError && <ErrorState message={(error as any)?.message || '加载失败'} onRetry={refetch} />}
          {!isLoading && !isError && (
            <>
            <DataTable
              data={listData}
              rowKey={(row) => row.id}
              selectedKeys={selectedIds}
              onSelectionChange={setSelectedIds}
              onRowDoubleClick={(row) => { setSelected(row); setDetailTab('basic'); setDrawerOpen(true) }}
              rowClassName={(row: Supplier) => (row.id === highlightId ? 'bg-accent-50' : '')}
              emptyState={
                <EmptyState
                  icon={Truck}
                  title="没有符合条件的供应商"
                  description={activeCount ? '试试放宽筛选条件' : '录入供应商后，报价时就能一键比价'}
                  action={
                    <Button onClick={() => { setEditing(null); reset(); setModalOpen(true) }}>
                      <Plus size={15} className="mr-1" /> 新增供应商
                    </Button>
                  }
                />
              }
              columns={[
                {
                  key: 'name',
                  title: '供应商',
                  render: (row: Supplier) => (
                    <div className="min-w-0">
                      <div className="text-ink truncate">{row.name}</div>
                      {row.code && <div className="font-mono text-caption text-muted">{row.code}</div>}
                    </div>
                  ),
                },
                {
                  key: 'origin',
                  title: '来源',
                  render: (row: Supplier) =>
                    row.origin ? (
                      <span className="inline-flex items-center gap-1 text-label">
                        <Globe size={12} className="text-muted" />
                        {SUPPLIER_ORIGIN_OPTIONS.find((o) => o.value === row.origin)?.label}
                        {row.country && <span className="text-muted">/{row.country}</span>}
                      </span>
                    ) : (
                      <span className="text-muted">-</span>
                    ),
                },
                {
                  key: 'tier',
                  title: '层级',
                  render: (row: Supplier) =>
                    row.tier ? (
                      <span
                        className={`font-mono text-caption px-1.5 py-0.5 rounded ${
                          row.tier === 'tier1'
                            ? 'bg-success-bg text-success-fg'
                            : row.tier === 'tier2'
                              ? 'bg-info-bg text-info-fg'
                              : 'bg-neutral-bg text-neutral-fg'
                        }`}
                      >
                        {SUPPLIER_TIER_OPTIONS.find((o) => o.value === row.tier)?.label}
                      </span>
                    ) : (
                      <span className="text-muted">-</span>
                    ),
                },
                {
                  key: 'productCategories',
                  title: '主营品类',
                  render: (row: Supplier) => {
                    const cats = row.productCategories || []
                    if (!cats.length) return <span className="text-muted">-</span>
                    return (
                      <div className="flex flex-wrap gap-1">
                        {cats.slice(0, 3).map((c) => (
                          <span key={c} className="text-caption px-1.5 py-0.5 rounded bg-canvas text-ink-soft">
                            {c}
                          </span>
                        ))}
                        {cats.length > 3 && <span className="text-caption text-muted">+{cats.length - 3}</span>}
                      </div>
                    )
                  },
                },
                {
                  key: 'productCount',
                  title: '产品数',
                  render: (row: Supplier) => <span className="eo-num text-label">{row.productCount ?? 0}</span>,
                },
                {
                  key: 'priceMin',
                  title: '价格区间',
                  render: (row: Supplier) => (
                    <span className="eo-num text-label">{priceRange(row.priceMin, row.priceMax)}</span>
                  ),
                },
                {
                  key: 'avgDeliveryDays',
                  title: '平均交期',
                  render: (row: Supplier) => (
                    <span className="eo-num text-label">
                      {row.avgDeliveryDays != null ? `${row.avgDeliveryDays} 天` : '-'}
                    </span>
                  ),
                },
                {
                  key: 'cooperationLevel',
                  title: '合作等级',
                  render: (row: Supplier) => <StatusBadge status={row.cooperationLevel} />,
                },
              ]}
              pagination={pagination}
              actions={(row: Supplier) => (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setSelected(row); setDetailTab('basic'); setDrawerOpen(true) }}
                    className="text-accent-600 hover:text-accent-700"
                    title={"查看"}
                    aria-label="查看"
                  >
                    <Eye size={16} />
                  </button>
                  <button onClick={() => openEdit(row)} className="text-ink-soft hover:text-ink" title={"编辑"}
                  aria-label="编辑">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => setDeleteId(row.id)} className="text-danger-fg hover:opacity-70" title={"删除"}
                  aria-label="删除">
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            />
            </>
          )}
        </div>
      </div>

      {/* 新建 / 编辑 */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); reset() }}
        title={editing ? '编辑供应商' : '新增供应商'}
        onConfirm={handleSubmit}
        loading={saveMutation.isPending}
        confirmDisabled={!isValid}
        size="lg"
      >
        <div className="space-y-6">
          <FormSection title="基本信息" icon={Truck}>
          <FieldGrid>
            <div>
              <FormInput label="供应商名称" value={form.name} onChange={(e) => setValue('name', e.target.value)} error={errors.name} required />
              {/*
                重名提醒。
                供应商是从多份外购件清单里陆续录进来的，「派克」「PARKER」
                「派克汉尼汾」很容易各建一条，之后比价时同一家被当成三家各算一遍。
                这里边打边查，命中就提示，但不拦着保存 —— 确实存在同名不同主体的情况。
              */}
              {dupNames.length > 0 && (
                <div className="mt-1.5 flex gap-1.5 text-xs text-warning-fg bg-warning-bg border border-warning-line rounded-md px-2 py-1.5">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <span>
                    已存在相近名称：{dupNames.join('、')}。
                    确认不是同一家再保存，否则比价时会重复计算。
                  </span>
                </div>
              )}
            </div>
            <FormInput label="供应商编码" value={form.code} onChange={(e) => setValue('code', e.target.value)} />
            <FormSelect
              label="来源"
              options={[{ value: '', label: '未分类' }, ...SUPPLIER_ORIGIN_OPTIONS]}
              value={form.origin}
              onChange={(e) => setValue('origin', e.target.value)}
            />
            <FormInput label="国家/地区" value={form.country} onChange={(e) => setValue('country', e.target.value)} />
            <FormSelect
              label="品牌层级"
              options={[{ value: '', label: '未分级' }, ...SUPPLIER_TIER_OPTIONS]}
              value={form.tier}
              onChange={(e) => setValue('tier', e.target.value)}
            />
            <FormSelect
              label="合作等级"
              options={COOPERATION_LEVEL_OPTIONS}
              value={form.cooperationLevel}
              onChange={(e) => setValue('cooperationLevel', e.target.value)}
            />
          </FieldGrid>
          </FormSection>

          <FormSection title="联系与商务">
          <FieldGrid>
            <FormInput label="联系人" value={form.contactName} onChange={(e) => setValue('contactName', e.target.value)} />
            <FormInput label="电话" value={form.phone} onChange={(e) => setValue('phone', e.target.value)} />
            <FormInput label="邮箱" value={form.email} onChange={(e) => setValue('email', e.target.value)} />
            <FormSelect label="评级" options={SUPPLIER_RATING_OPTIONS} value={form.rating} onChange={(e) => setValue('rating', e.target.value)} />
            <FormInput label="付款方式" value={form.paymentTerms} onChange={(e) => setValue('paymentTerms', e.target.value)} placeholder="如：月结 30 天 / 预付 30%" />
            <FormInput label="资质" value={form.qualification} onChange={(e) => setValue('qualification', e.target.value)} placeholder="ISO9001、CE，用顿号分隔" />
            {/*
              平均交期是**算出来的**，不是供应商的字段 ——
              它取自「产品目录」里各条配套件交期的平均值。
              在这里做成输入框只会填了不算数、还和明细对不上，
              所以只读展示，并指明该去哪儿改。
            */}
            <FormInput
              label="平均交期"
              value={
                editing && (editing as any).avgDeliveryDays != null
                  ? `${(editing as any).avgDeliveryDays} 天`
                  : ''
              }
              readOnly
              placeholder={editing ? '产品目录中尚未填写交期' : '保存后可维护'}
              helper="由产品目录各条交期平均得出。要改交期请在供应商详情的「产品目录」页签里改"
            />
          </FieldGrid>
          </FormSection>

          <FormSection title="主营品类" hint="比价时按品类筛选供应商">
          <div>
            <span className="sr-only">主营品类</span>
            <div className="flex flex-wrap gap-1.5">
              {catOptions.map((c: { value: string; label: string }) => {
                const on = form.productCategories.includes(c.value)
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={(e) => {
                      // Shift+点击删除这个品类本身，普通点击只是勾选/取消
                      if (e.shiftKey) {
                        removeCategory(c.value)
                        return
                      }
                      setValues((prev) => ({
                        ...prev,
                        productCategories: on
                          ? prev.productCategories.filter((x) => x !== c.value)
                          : [...prev.productCategories, c.value],
                      }))
                    }}
                    title="点击选择；Shift+点击删除该品类" 
                    className={`px-2.5 py-1 rounded-md text-label transition-colors ${
                      on ? 'bg-accent-500 text-white' : 'bg-canvas text-ink-soft hover:bg-accent-50'
                    }`}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>

            {/*
              品类可增删。
              原来这 12 个值写死在代码里，外购件清单导进来后有 126 家落在「其他」——
              焊接、涂装、检测仪器这些常见大类根本没有对应项。
            */}
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
              <input
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCategory(newCat)
                    setNewCat('')
                  }
                }}
                placeholder="新增品类，如 焊接、涂装"
                className="eo-input !py-1 !text-sm flex-1 min-w-0"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="!py-1 shrink-0"
                onClick={() => { addCategory(newCat); setNewCat('') }}
              >
                <PlusCircle size={13} className="mr-1" /> 添加
              </Button>
              {!catIsDefault && (
                <button
                  type="button"
                  onClick={resetCategories}
                  className="text-caption text-muted hover:text-accent-600 shrink-0"
                >
                  恢复默认
                </button>
              )}
            </div>
            <p className="mt-1.5 text-xs text-muted">
              删除品类：按住 Shift 点击上方标签。已挂该品类的供应商标签保持不变。
            </p>
          </div>
          <FieldGrid>
            <FormInput label="地址" value={form.address} onChange={(e) => setValue('address', e.target.value)} />
            <div className="md:col-span-2">
              <FormTextarea label="能力描述" value={form.description} onChange={(e) => setValue('description', e.target.value)} rows={3} />
            </div>
          </FieldGrid>
          </FormSection>

          <FormSection title="能力明细" hint="决定比价时能否匹配上">
          <div>
            <div className="flex items-center justify-end mb-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setValues((prev) => ({
                    ...prev,
                    capabilities: [...prev.capabilities, { capability: '', category: '', description: '' }],
                  }))
                }
              >
                <PlusCircle size={13} className="mr-1" /> 添加
              </Button>
            </div>
            <div className="space-y-2">
              {form.capabilities.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-subtle p-2 rounded-md">
                  <input
                    placeholder="能力名称"
                    value={item.capability}
                    onChange={(e) =>
                      setValues((prev) => {
                        const arr = [...prev.capabilities]
                        arr[idx] = { ...arr[idx], capability: e.target.value }
                        return { ...prev, capabilities: arr }
                      })
                    }
                    className="col-span-4 px-2 py-1 border border-border rounded text-sm"
                  />
                  <input
                    placeholder="分类"
                    value={item.category}
                    onChange={(e) =>
                      setValues((prev) => {
                        const arr = [...prev.capabilities]
                        arr[idx] = { ...arr[idx], category: e.target.value }
                        return { ...prev, capabilities: arr }
                      })
                    }
                    className="col-span-3 px-2 py-1 border border-border rounded text-sm"
                  />
                  <input
                    placeholder="说明"
                    value={item.description}
                    onChange={(e) =>
                      setValues((prev) => {
                        const arr = [...prev.capabilities]
                        arr[idx] = { ...arr[idx], description: e.target.value }
                        return { ...prev, capabilities: arr }
                      })
                    }
                    className="col-span-4 px-2 py-1 border border-border rounded text-sm"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setValues((prev) => ({
                        ...prev,
                        capabilities: prev.capabilities.filter((_, i) => i !== idx),
                      }))
                    }
                    className="col-span-1 text-danger-fg hover:opacity-70"
                    title={"删除能力"}
                    aria-label="删除能力"
                  >
                    <MinusCircle size={17} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          </FormSection>
        </div>
      </Modal>

      {/*
        批量修改。
        外购件清单一次导进来两百多家，逐条点开改合作等级、补品类根本干不完。
        只改「勾了的字段」——留空的项一律不动，避免把没打算改的字段清空。
      */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={`批量修改（已选 ${selectedIds.length} 家）`}
        onConfirm={() => bulkMutation.mutate()}
        loading={bulkMutation.isPending}
        confirmDisabled={!bulkFields.cooperationLevel && !bulkFields.origin && !bulkCats.length}
        size="md"
      >
        <div className="space-y-4">
          <FormSelect
            label="合作等级"
            options={[{ value: '', label: '不修改' }, ...COOPERATION_LEVEL_OPTIONS]}
            value={bulkFields.cooperationLevel}
            onChange={(e) => setBulkFields((f) => ({ ...f, cooperationLevel: e.target.value }))}
          />
          <FormSelect
            label="来源"
            options={[{ value: '', label: '不修改' }, ...SUPPLIER_ORIGIN_OPTIONS]}
            value={bulkFields.origin}
            onChange={(e) => setBulkFields((f) => ({ ...f, origin: e.target.value }))}
          />

          <div>
            <span className="block eo-label mb-1.5">主营品类</span>
            <div className="flex flex-wrap gap-1.5">
              {catOptions.map((c: { value: string; label: string }) => {
                const on = bulkCats.includes(c.value)
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() =>
                      setBulkCats((prev) =>
                        on ? prev.filter((x) => x !== c.value) : [...prev, c.value],
                      )
                    }
                    className={`px-2.5 py-1 rounded-md text-label transition-colors ${
                      on ? 'bg-accent-500 text-white' : 'bg-canvas text-ink-soft hover:bg-accent-50'
                    }`}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-3 mt-2">
              <label className="flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer">
                <input
                  type="radio"
                  checked={bulkCatMode === 'append'}
                  onChange={() => setBulkCatMode('append')}
                  className="w-3.5 h-3.5 accent-accent-500"
                />
                追加（保留原有品类）
              </label>
              <label className="flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer">
                <input
                  type="radio"
                  checked={bulkCatMode === 'replace'}
                  onChange={() => setBulkCatMode('replace')}
                  className="w-3.5 h-3.5 accent-accent-500"
                />
                替换（覆盖原有品类）
              </label>
            </div>
            <p className="mt-1 text-xs text-muted">
              不选品类则不改动品类。「替换」会清掉这些供应商原本的品类，请确认后再用。
            </p>
          </div>

          <div className="bg-warning-bg border border-warning-line rounded-md p-2.5 text-xs text-warning-fg">
            将修改 {selectedIds.length} 家供应商，操作不可撤销。留空的字段保持原样。
          </div>
        </div>
      </Modal>

      {/* 批量删除确认：逐条删，带进度与成/败汇总 */}
      <Modal
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title={`批量删除 ${selectedIds.length} 家供应商`}
        onConfirm={() => bulkDeleteMutation.mutate()}
        loading={bulkDeleteMutation.isPending}
        confirmText="确认删除"
        confirmVariant="danger"
        size="md"
      >
        <p className="text-sm text-muted mb-4">
          确定要删除选中的 {selectedIds.length} 家供应商吗？其产品目录和历史报价也会一并删除，此操作不可撤销。
        </p>
        {bulkDeleteProgress && (
          <div>
            <div className="flex items-center justify-between text-caption text-muted mb-1">
              <span>正在删除…</span>
              <span>{bulkDeleteProgress.done} / {bulkDeleteProgress.total}</span>
            </div>
            <div className="h-1.5 bg-canvas rounded-full overflow-hidden">
              <div
                className="h-full bg-danger-fg transition-all"
                style={{ width: `${(bulkDeleteProgress.done / bulkDeleteProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="确认删除"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
        confirmText="删除"
      >
        <p className="text-sm text-ink-soft">确定要删除该供应商吗？其产品目录和历史报价也会一并删除。</p>
      </Modal>

      {/* 详情 */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="供应商详情" width="w-[720px]">
        {detailQuery.isLoading ? (
          <PageLoader />
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-accent-50 rounded-lg">
                <Truck size={22} className="text-accent-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[16px] font-semibold text-ink truncate">{detailQuery.data?.name}</h3>
                <p className="font-mono text-label text-muted">{detailQuery.data?.code || '未编码'}</p>
              </div>
              <div className="ml-auto">
                <StatusBadge status={detailQuery.data?.cooperationLevel} />
              </div>
            </div>

            <Tabs
              tabs={[
                { value: 'basic', label: '基本信息' },
                { value: 'products', label: '产品目录', count: detailQuery.data?.products?.length },
                { value: 'capabilities', label: '能力明细', count: detailQuery.data?.capabilities?.length },
              ]}
              value={detailTab}
              onChange={setDetailTab}
            />

            {detailTab === 'basic' && (
              <KeyValueList
                items={[
                  { label: '来源', value: SUPPLIER_ORIGIN_OPTIONS.find((o) => o.value === detailQuery.data?.origin)?.label },
                  { label: '国家/地区', value: detailQuery.data?.country },
                  { label: '品牌层级', value: SUPPLIER_TIER_OPTIONS.find((o) => o.value === detailQuery.data?.tier)?.label },
                  { label: '评级', value: SUPPLIER_RATING_OPTIONS.find((o) => o.value === detailQuery.data?.rating)?.label },
                  { label: '联系人', value: detailQuery.data?.contactName },
                  { label: '电话', value: detailQuery.data?.phone, mono: true },
                  { label: '邮箱', value: detailQuery.data?.email },
                  { label: '付款方式', value: detailQuery.data?.paymentTerms },
                  { label: '主营品类', value: (detailQuery.data?.productCategories || []).join('、'), full: true },
                  { label: '资质', value: (detailQuery.data?.qualification || []).join('、'), full: true },
                  {
                    label: '准时交付率',
                    value: detailQuery.data?.onTimeRate != null ? `${detailQuery.data.onTimeRate}%` : undefined,
                    mono: true,
                  },
                  {
                    label: '来料合格率',
                    value: detailQuery.data?.qualifiedRate != null ? `${detailQuery.data.qualifiedRate}%` : undefined,
                    mono: true,
                  },
                  { label: '地址', value: detailQuery.data?.address, full: true },
                  { label: '能力描述', value: detailQuery.data?.description, full: true },
                ]}
              />
            )}

            {detailTab === 'products' && (
              <ProductCatalog
                supplierId={selected?.id || ''}
                products={detailQuery.data?.products || []}
                onChanged={() => {
                  detailQuery.refetch()
                  queryClient.invalidateQueries({ queryKey: ['suppliers'] })
                }}
                open={productModalOpen}
                setOpen={setProductModalOpen}
              />
            )}

            {detailTab === 'capabilities' &&
              ((detailQuery.data?.capabilities || []).length === 0 ? (
                <p className="text-sm text-muted py-6 text-center">暂无能力明细</p>
              ) : (
                <div className="space-y-2">
                  {(detailQuery.data?.capabilities || []).map((it, idx) => (
                    <div key={idx} className="bg-subtle rounded-md px-3 py-2">
                      <div className="text-body-sm font-medium text-ink">
                        {it.capability}
                        {it.category && <span className="text-muted font-normal"> · {it.category}</span>}
                      </div>
                      {it.description && <div className="text-label text-muted mt-0.5">{it.description}</div>}
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}
      </Drawer>
    </div>
  )
}

/** 供应商详情里的产品目录 tab */
function ProductCatalog({
  supplierId,
  products,
  onChanged,
  open,
  setOpen,
}: {
  supplierId: string
  products: SupplierProduct[]
  onChanged: () => void
  open: boolean
  setOpen: (v: boolean) => void
}) {
  const [editing, setEditing] = useState<SupplierProduct | null>(null)
  const [form, setForm] = useState<Partial<SupplierProduct>>({})
  // 待确认删除的产品：删除图标紧挨编辑图标，误点会把这条历史报价一起带走
  const [deleting, setDeleting] = useState<SupplierProduct | null>(null)
  // 配套件的品类要和供应商用同一套，否则筛选时对不上
  const { options: catOptions } = useSupplierCategories()

  // 物料关联：按名称搜索物料主档，选中后写入 form.materialId
  const searchMaterials = async (keyword: string) => {
    const res = await materialApi.list({ keyword: keyword || undefined })
    return (Array.isArray(res) ? res : []).map((m: any) => ({
      value: m.id,
      label: `${m.name}（${m.materialCode}）`,
      hint: m.category || undefined,
    }))
  }
  const resolveMaterial = async (id: string) => {
    const m = await materialApi.get(id)
    return m ? { value: m.id, label: `${m.name}（${m.materialCode}）` } : null
  }

  const save = useMutation({
    mutationFn: () =>
      editing ? supplierProductApi.update(editing.id, form) : supplierApi.createProduct(supplierId, form),
    onSuccess: () => {
      toast.success(editing ? '已保存' : '已添加')
      setOpen(false)
      setEditing(null)
      setForm({})
      onChanged()
    },
    onError: handleError,
  })

  const del = useMutation({
    mutationFn: (id: string) => supplierProductApi.remove(id),
    onSuccess: () => {
      toast.success('已删除')
      setDeleting(null)
      onChanged()
    },
    onError: handleError,
  })

  const openNew = () => {
    setEditing(null)
    setForm({ currency: 'CNY', priceSource: 'estimate', unit: '件' })
    setOpen(true)
  }
  const openEdit = (p: SupplierProduct) => {
    setEditing(p)
    /*
     * 只取可编辑字段。
     *
     * 原来是 { ...p } 整条灌进来，保存时把 id / status / createdAt / updatedAt
     * 一起发回后端 —— DTO 里没有这些字段，forbidNonWhitelisted 直接拒绝，
     * 报一串「property id should not exist」。
     * 这些字段本来也不该由前端决定。
     */
    const { id: _i, supplierId: _s, status: _st, createdAt: _c, updatedAt: _u, ...editable } = p as any
    setForm(editable)
    setOpen(true)
  }

  const staleWarning =
    form.priceDate && new Date(form.priceDate) < new Date(Date.now() - 180 * 864e5)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-body-sm font-semibold text-ink">产品目录</span>
        <Button variant="secondary" size="sm" onClick={openNew}>
          <PlusCircle size={13} className="mr-1" /> 添加产品
        </Button>
      </div>

      {products.length === 0 ? (
        <EmptyState bare icon={Package} title="暂无产品" description="录入产品与价格后，报价时才能比价" />
      ) : (
        <div className="eo-scroll-x">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-border bg-subtle">
                <th className="eo-th text-left py-2 px-2">产品 / 型号</th>
                <th className="eo-th text-left py-2 px-2">品牌</th>
                <th className="eo-th text-right py-2 px-2">价格区间</th>
                <th className="eo-th text-right py-2 px-2">交期</th>
                <th className="eo-th text-right py-2 px-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-divider last:border-0">
                  <td className="py-2 px-2">
                    <div className="text-ink">{p.productName}</div>
                    <div className="font-mono text-caption text-muted">{p.model || '-'}</div>
                  </td>
                  <td className="py-2 px-2 text-ink-soft">{p.brand || '-'}</td>
                  <td className="py-2 px-2 text-right eo-num">
                    {priceRange(p.priceMin, p.priceMax)}
                    {p.priceDate && (
                      <div className="text-caption text-muted">
                        {new Date(p.priceDate).toLocaleDateString('zh-CN')}
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right eo-num">
                    {p.deliveryDays != null ? `${p.deliveryDays}天` : '-'}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => openEdit(p)} className="text-ink-soft hover:text-ink" title={"编辑"}
                      aria-label="编辑">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => setDeleting(p)} className="text-danger-fg hover:opacity-70" title={"删除"}
                      aria-label="删除">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        loading={del.isPending}
        message={
          <>确定删除供应产品「{deleting?.productName}{deleting?.model ? ` ${deleting.model}` : ''}」吗？</>
        }
        detail="删除后无法恢复，这条产品的价格与交期记录在比价时也不再出现。"
      />

      <Modal
        open={open}
        onClose={() => {
          setOpen(false)
          setEditing(null)
        }}
        title={editing ? '编辑供应产品' : '添加供应产品'}
        onConfirm={() => save.mutate()}
        loading={save.isPending}
        confirmDisabled={!form.productName}
        size="lg"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput
            label="产品名称"
            value={form.productName || ''}
            onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))}
            required
          />
          <FormSelect
            label="品类"
            options={[{ value: '', label: '未分类' }, ...catOptions]}
            value={form.category || ''}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          />
          <EntityPicker
            label="关联物料（同规格比价用）"
            queryKey="materials-picker"
            value={form.materialId || ''}
            onChange={(id: string) => setForm((f) => ({ ...f, materialId: id }))}
            search={searchMaterials}
            resolve={resolveMaterial}
            placeholder="搜索物料名称…"
            helper="挂到物料后可在物料管理页做同规格跨厂家比价"
          />
          <FormInput
            label="品牌"
            value={form.brand || ''}
            onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
            placeholder="如 Rexroth / 华德"
          />
          <FormInput label="型号" value={form.model || ''} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
          <FormInput
            label="最低价"
            type="number"
            value={form.priceMin ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, priceMin: e.target.value === '' ? null : Number(e.target.value) }))}
          />
          <FormInput
            label="最高价"
            type="number"
            value={form.priceMax ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, priceMax: e.target.value === '' ? null : Number(e.target.value) }))}
          />
          <FormSelect
            label="币种"
            options={[
              { value: 'CNY', label: '人民币 CNY' },
              { value: 'USD', label: '美元 USD' },
              { value: 'EUR', label: '欧元 EUR' },
            ]}
            value={form.currency || 'CNY'}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as any }))}
          />
          <FormSelect
            label="价格来源"
            options={PRICE_SOURCE_OPTIONS}
            value={form.priceSource || 'estimate'}
            onChange={(e) => setForm((f) => ({ ...f, priceSource: e.target.value as any }))}
          />
          <FormInput
            label="价格采集日期"
            type="date"
            value={form.priceDate ? String(form.priceDate).slice(0, 10) : ''}
            onChange={(e) => setForm((f) => ({ ...f, priceDate: e.target.value }))}
          />
          <FormInput
            label="交货周期（天）"
            type="number"
            value={form.deliveryDays ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, deliveryDays: e.target.value === '' ? null : Number(e.target.value) }))}
          />
          <FormInput
            label="最小起订量"
            type="number"
            value={form.moq ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, moq: e.target.value === '' ? null : Number(e.target.value) }))}
          />
          <FormInput label="单位" value={form.unit || ''} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} />
          <div className="md:col-span-2">
            <FormTextarea
              label="规格"
              value={form.specification || ''}
              onChange={(e) => setForm((f) => ({ ...f, specification: e.target.value }))}
              rows={2}
            />
          </div>
          <label className="md:col-span-2 flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={!!form.isSubstitutable}
              onChange={(e) => setForm((f) => ({ ...f, isSubstitutable: e.target.checked }))}
              className="w-4 h-4 rounded accent-accent-500"
            />
            可作为进口件的国产替代
          </label>
          {staleWarning && (
            <p className="md:col-span-2 flex items-center gap-1.5 text-label text-warning-fg bg-warning-bg rounded-md px-3 py-2">
              <AlertTriangle size={13} /> 该价格采集已超过 180 天，报价前建议重新询价
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}

