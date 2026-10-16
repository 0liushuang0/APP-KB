import { useEffect, useState } from 'react'
import DeleteImpact from '../components/DeleteImpact'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, Plus, Eye, Pencil, Trash2, Download, ClipboardList, Layers, Hourglass, DollarSign, FileText, AlertTriangle, CalendarClock, Sparkles } from 'lucide-react'
import FocusBar, { useFocus } from '../components/FocusBar'
import { requirementApi, customerApi, paramTemplateApi } from '../api/services'
import { useDebounce } from '../hooks/useDebounce'
import { toList } from '../utils/apiList'
import { useFormValidation, required } from '../hooks/useFormValidation'
import { usePagedQuery } from '../hooks/usePagedQuery'
import { useModuleStats } from '../hooks/useModuleStats'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'
import { usePageActions } from '../contexts/PageActionsContext'
import IdentificationPreviewModal from '../components/IdentificationPreviewModal'
import AttachmentBadge from '../components/AttachmentBadge'
import StatCards from '../components/StatCards'
import ImportButton from '../components/ImportButton'
import ExportButton from '../components/ExportButton'
import type { Requirement } from '../types'
import { REQUIREMENT_TYPE_OPTIONS, REQUIREMENT_SOURCE_OPTIONS, REQUIREMENT_PRIORITY_OPTIONS, REQUIREMENT_STATUS_OPTIONS, requirementStatusLabel } from '../types'
import Button from '../components/Button'
import Modal from '../components/Modal'
import FormInput from '../components/FormInput'
import FormSelect from '../components/FormSelect'
import EntityPicker from '../components/EntityPicker'
import EntityFileUpload from '../components/EntityFileUpload'
import { FormSection, FieldGrid } from '../components/layout-kit'
import FormTextarea from '../components/FormTextarea'
import DataTable from '../components/DataTable'
import BatchEditBar from '../components/BatchEditBar'
import StatusBadge from '../components/StatusBadge'
import CustomerFilterSelect from '../components/CustomerFilterSelect'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import PageHeader from '../components/PageHeader'

/**
 * 落地阶段：由 方案→报价→合同 派生链路自动推导（后端 attachLandStage），
 * 需求登记后"推进到哪一步、有没有落地"不用人工翻四张表串联。
 * 分档互斥：已登记 → 方案阶段 → 报价阶段 → 已签约；成交/失单取需求自身状态。
 */
const LAND_STAGE_OPTIONS = [
  { value: 'registered', label: '已登记' },
  { value: 'proposal', label: '方案阶段' },
  { value: 'quotation', label: '报价阶段' },
  { value: 'contract', label: '已签约' },
  { value: 'won', label: '已成交' },
  { value: 'lost', label: '已失单' },
] as const

const LAND_STAGE_META: Record<string, { label: string; cls: string }> = {
  registered: { label: '已登记', cls: 'text-muted bg-canvas border-border' },
  proposal: { label: '方案阶段', cls: 'text-info-fg bg-info-bg border-info-line' },
  quotation: { label: '报价阶段', cls: 'text-warning-fg bg-warning-bg border-warning-line' },
  contract: { label: '已签约', cls: 'text-accent-600 bg-accent-50 border-accent-200' },
  won: { label: '已成交', cls: 'text-success-fg bg-success-bg border-success-line' },
  lost: { label: '已失单', cls: 'text-danger-fg bg-danger-bg border-danger-line' },
}

const initialForm = {
  title: '',
  customerId: '',
  requirementType: '',
  category: '',
  /** 需求时间：客户发出需求、我方收到的时间（可补录，区别于系统创建时间） */
  requirementDate: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  priority: 'medium',
  status: '',
  description: '',
  templateCategory: '',
  // 商机管理（销售过程）：填了之后漏斗按金额说话
  expectedAmount: '',
  expectedDealDate: '',
  winProbability: '',
  nextFollowUpDate: '',
  lossReason: '',
}

const priorityOptions = REQUIREMENT_PRIORITY_OPTIONS

const sourceLabel = (v?: string) => REQUIREMENT_SOURCE_OPTIONS.find((o) => o.value === v)?.label || v || '-'
const priorityLabel = (v?: string) => priorityOptions.find((o) => o.value === v)?.label || v || '-'
const typeLabel = (v?: string) => REQUIREMENT_TYPE_OPTIONS.find((o) => o.value === v)?.label || v || '-'

const handleError = (error: any) => {
  toast.error(error?.response?.data?.message || error?.message || '操作失败')
}

export default function Requirements() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // 带 ?highlight= 跳来：需求详情走独立路由，直接转过去
  const highlightId = searchParams.get('highlight') || ''
  useEffect(() => {
    if (highlightId) navigate(`/requirements/${highlightId}`, { replace: true })
     
  }, [highlightId])
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  // 需求即商机：按商机阶段（状态）过滤，后端列表接口已支持 status 参数。
  // 状态写入 URL：跳详情再返回筛选不丢，还能把筛好的视图直接分享/收藏。
  const [statusFilter, setStatusFilterState] = useState(searchParams.get('status') || '')
  const setStatusFilter = (v: string) => {
    setStatusFilterState(v)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (v) next.set('status', v)
        else next.delete('status')
        return next
      },
      { replace: true },
    )
  }
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  /** 客户筛选（'none' = 未关联客户）；落地阶段筛选（landStage） */
  const [customerFilter, setCustomerFilter] = useState('')
  const [landFilter, setLandFilter] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  /** 导出预览弹窗：装当前要导出的需求 id */
  const [exportId, setExportId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Requirement | null>(null)
  const { values: form, errors, isValid, setValue, setValues, validateAll, reset } = useFormValidation({
    initialValues: initialForm,
    rules: {
      title: required('请输入项目名称'),
      customerId: required('请选择关联客户'),
    },
  })

  const setPageActions = usePageActions()
  const { focus, setFocus, owner } = useFocus()

  const {
    list: listData,
    pagination,
    isLoading,
    isError,
    error,
    onSort,
    sortBy,
    sortOrder,
    refetch,
  } = usePagedQuery<Requirement>({
    key: ['requirements'],
    filters: {
      keyword: debouncedSearch || undefined,
      status: statusFilter || undefined,
      customerId: customerFilter || undefined,
      landStage: landFilter || undefined,
      focus: focus || undefined,
      owner: owner || undefined,
    },
    fetcher: (params) => requirementApi.list(params) as any,
    initialPageSize: 15,
  })

  // 同类产品历史报价区间：填预计金额时作参考（不自动填）
  const { data: amountRef } = useQuery({
    queryKey: ['req-amount-ref', form.templateCategory],
    queryFn: () => requirementApi.amountReference(form.templateCategory),
    enabled: modalOpen && !!form.templateCategory,
    staleTime: 300_000,
  })

  const { data: templates } = useQuery({
    queryKey: ['param-templates-select'],
    queryFn: () => paramTemplateApi.list(),
  })

  /** 客户候选走服务端搜索。
   *
   * 原来是 `customerApi.list()` 一次拉全量再塞进 <select>，服务端分页上线后
   * 这个调用只回第一页 20 条、而且返回的是 {list,total} 不是数组，
   * 前端 Array.isArray 判定失败直接得到空数组 —— 表现就是"关联客户选不了"。
   */
  const searchCustomers = async (keyword: string) => {
    const res = await customerApi.list({ keyword: keyword || undefined, pageSize: 50 })
    return toList<any>(res).map((c) => ({
      value: c.id,
      label: c.name,
      hint: [c.industry, c.region].filter(Boolean).join(' · ') || undefined,
    }))
  }

  const resolveCustomer = async (id: string) => {
    const c = await customerApi.get(id)
    return c ? { value: c.id, label: c.name } : null
  }


  const saveMutation = useMutation({
    mutationFn: (dto: any) => {
      if (editing) return requirementApi.update(editing.id, dto)
      return requirementApi.create(dto)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requirements'] })
      closeModal()
      refetch()
    },
    onError: handleError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => requirementApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requirements'] })
      setDeleteId(null)
      refetch()
    },
    onError: handleError,
  })

  // 删除预检：弹窗打开时才查关联客户/资料/下游，避免无谓请求。
  // 这是"需求阶段还在、客户需求档案没了"的根因防护——删前先告诉用户连带的资料。
  const { data: removePreview, isLoading: previewLoading } = useQuery({
    queryKey: ['requirement-remove-preview', deleteId],
    queryFn: () => requirementApi.removePreview(deleteId!),
    enabled: !!deleteId,
    staleTime: 0,
  })

  const openCreate = () => {
    setEditing(null)
    reset()
    setModalOpen(true)
  }

  const openEdit = (row: Requirement) => {
    setEditing(row)
    setValues({
      title: row.title || '',
      customerId: row.customerId || '',
      requirementType: (row as any).requirementType || '',
      category: row.category || '',
      requirementDate: (row as any).requirementDate ? String((row as any).requirementDate).slice(0, 10) : '',
      contactName: (row as any).contactName || '',
      contactPhone: (row as any).contactPhone || '',
      contactEmail: (row as any).contactEmail || '',
      priority: row.priority || 'medium',
      status: (row as any).status || '',
      description: row.description || '',
      templateCategory: (row as any).templateCategory || '',
      expectedAmount: (row as any).expectedAmount != null ? String((row as any).expectedAmount) : '',
      expectedDealDate: (row as any).expectedDealDate ? String((row as any).expectedDealDate).slice(0, 10) : '',
      winProbability: (row as any).winProbability != null ? String((row as any).winProbability) : '',
      nextFollowUpDate: (row as any).nextFollowUpDate ? String((row as any).nextFollowUpDate).slice(0, 10) : '',
      lossReason: (row as any).lossReason || '',
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    reset()
  }

  // 详情走独立路由而不是抽屉 —— 结构化参数表有 40+ 字段，520px 放不下
  const openDetail = (row: Requirement) => navigate(`/requirements/${row.id}`)

  const handleSubmit = () => {
    if (!validateAll()) return
    // 商机字段：空串转 undefined（后端校验数字/日期），数值字段显式转 Number
    // status 只在编辑时提交：新建的初始状态由服务端按审批开关决定，
    // CreateRequirementDto 没有 status，带上会被 forbidNonWhitelisted 拒成「状态不是可提交的字段」
    // 需求时间：没填就不发（新建）／发 null 表示清空（编辑），空串会让后端日期校验报错
    const { expectedAmount, winProbability, expectedDealDate, nextFollowUpDate, lossReason, status, requirementDate, ...rest } = form
    saveMutation.mutate({
      ...(editing ? { status } : {}),
      ...rest,
      requirementDate: requirementDate || (editing ? null : undefined),
      expectedAmount: expectedAmount === '' ? undefined : Number(expectedAmount),
      winProbability: winProbability === '' ? undefined : Number(winProbability),
      expectedDealDate: expectedDealDate || undefined,
      nextFollowUpDate: nextFollowUpDate || undefined,
      lossReason: lossReason || undefined,
    })
  }

  const templatesArray = toList<any>(templates)

  /** 当前选定客户的联系人：联系人字段的选择联动数据源（datalist + 自动带出） */
  const { data: customerDetail } = useQuery({
    queryKey: ['customer-contacts-for-req', form.customerId],
    queryFn: () => customerApi.get(form.customerId!),
    enabled: modalOpen && !!form.customerId,
  })
  const customerContacts: any[] = (customerDetail as any)?.contacts || []

  useEffect(() => {
    setPageActions(
      <>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            placeholder="搜索客户、项目名称"
            onChange={(e) => setSearch(e.target.value)}
            className="eo-input !w-60 !pl-8 !py-1 !text-sm"
          />
        </div>
        {/* 商机状态筛选与导入/导出统一收到顶栏，与搜索、新建同行展示 */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="eo-input !w-28 !py-1 !text-xs"
          aria-label="按状态筛选"
        >
          <option value="">全部状态</option>
          {REQUIREMENT_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {/* 落地阶段：由 方案→报价→合同 派生链路自动推导，不用人工维护 */}
        <select
          value={landFilter}
          onChange={(e) => setLandFilter(e.target.value)}
          className="eo-input !w-32 !py-1 !text-xs"
          aria-label="按落地阶段筛选"
          title="按需求推进到哪一步筛选（由方案/报价/合同自动推导）"
        >
          <option value="">全部落地阶段</option>
          {LAND_STAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <CustomerFilterSelect value={customerFilter} onChange={setCustomerFilter} />
        {statusFilter && (
          <button onClick={() => setStatusFilter('')} className="text-caption text-muted hover:text-ink transition-colors">
            清除
          </button>
        )}
        <ImportButton type="requirement" queryKey="requirements" size="sm" className="!py-1 !text-xs" />
        <ExportButton type="requirement" keyword={debouncedSearch || undefined} status={statusFilter || undefined} />
        <Button onClick={openCreate} size="sm" className="!py-1 !text-sm">
          <Plus size={13} className="mr-0.5" /> 新建
        </Button>
        {/* 批量操作收到顶栏：选中后才出现，琥珀修改/红色删除一眼可见 */}
        <BatchEditBar
          selectedKeys={selectedKeys}
          onClear={() => setSelectedKeys([])}
          moduleName="需求"
          queryKey={['requirements']}
          updateFn={(id, dto) => requirementApi.update(id, dto)}
          deleteFn={(id) => requirementApi.remove(id)}
          fields={[
            { key: 'requirementType', label: '需求类型', options: REQUIREMENT_TYPE_OPTIONS },
            { key: 'category', label: '需求来源', options: REQUIREMENT_SOURCE_OPTIONS },
            { key: 'priority', label: '优先级', options: REQUIREMENT_PRIORITY_OPTIONS },
          ]}
        />
      </>
    )
    return () => setPageActions(null)
     
  }, [statusFilter, landFilter, customerFilter, debouncedSearch, selectedKeys])
  const templateOptions = templatesArray.map((t) => ({ value: t.category, label: t.category?.includes('/') ? t.category.split('/').join(' / ') : t.category }))

  useRegisterPageAssistant({
    key: 'requirements',
    label: '客户需求',
    sourceTypes: ['requirement', 'customer', 'solution', 'proposal'],
    questions: [
      '本页需求里，哪些还缺关键参数？',
      '这些需求分别对应哪类产品？',
      '哪几条需求优先级最高、该先处理？',
      '挑一条需求，列出还需要跟客户确认的事项',
      '本页需求中有哪些可以复用历史方案？',
    ],
    context: [
      `页面：客户需求（共 ${pagination?.total ?? listData.length} 条，当前第 ${pagination?.page ?? 1} 页）`,
      search ? `搜索关键词：${search}` : '',
      '当前页需求清单：',
      ...listData
        .slice(0, 40)
        .map(
          (x: Requirement, i: number) =>
            `${i + 1}. ${(x as any).requirementNo || ''} ${x.title || ''}｜客户 ${(x as any).customer?.name || (x as any).customerName || '—'}｜类型 ${(x as any).requirementType || '—'}｜优先级 ${(x as any).priority || '—'}｜状态 ${x.status || '—'}｜落地阶段 ${LAND_STAGE_META[(x as any).landStage]?.label || '—'}`,
        ),
    ]
      .filter(Boolean)
      .join('\n'),
  })

  const { stats, isLoading: statsLoading } = useModuleStats()
  const r = stats?.requirements
  // 统计卡即筛选：点一下列表就只剩那几条（与工作台「我的今天」同一口径）
  const requirementCards = [
    { label: '需求总数', value: r?.total ?? 0, icon: ClipboardList, onClick: () => setFocus(''), active: !focus },
    { label: '跟进超期', value: r?.followupOverdue ?? 0, icon: AlertTriangle, alert: true, onClick: () => setFocus('followup-overdue'), active: focus === 'followup-overdue' },
    { label: '7 天内跟进', value: r?.followupDue ?? 0, icon: CalendarClock, onClick: () => setFocus('followup'), active: focus === 'followup' },
    { label: '参数待确认', value: r?.review ?? 0, icon: Sparkles, title: 'AI 已从资料里自动识别出参数，等你核对', onClick: () => setFocus('review'), active: focus === 'review' },
    { label: '待完善', value: r?.incomplete ?? 0, icon: Hourglass, title: '还没识别参数，或识别后仍缺关键参数', onClick: () => setFocus('incomplete'), active: focus === 'incomplete' },
    { label: '已报价', value: r?.quoted ?? 0, icon: DollarSign },
    { label: '本月新增', value: r?.newThisMonth ?? 0, icon: Plus },
  ]
  const FOCUS_LABELS: Record<string, string> = {
    'followup-overdue': '跟进日期已过的需求（最早的在前）',
    followup: '7 天内要跟进的需求',
    review: 'AI 已识别参数、等你确认的需求',
    incomplete: '还缺参数的需求',
  }

  return (
    <div>
      <PageHeader title="需求" titleEm="管理" />

      {/* 统计卡片：与业务概览顶部同一套组件，各模块高度与配色一致 */}
      <StatCards className="mb-4" loading={statsLoading} skeletonCount={7} items={requirementCards} />
      <FocusBar focus={focus} labels={FOCUS_LABELS} onClear={() => setFocus('')} count={pagination?.total} />

      {isLoading && !listData.length && <PageLoader />}
      {isError && <ErrorState message={error?.message || '加载失败'} onRetry={refetch} />}
      {!isLoading && !isError && (
        <DataTable
          loading={isLoading}
          data={listData}
          columns={[
            { key: 'requirementNo', title: '需求编码', sortable: true },
            {
              key: 'requirementDate',
              title: '需求时间',
              sortable: true,
              render: (row: any) =>
                (row as any).requirementDate
                  ? String((row as any).requirementDate).slice(0, 10)
                  : <span className="text-muted">—</span>,
            },
            {
              key: 'customerShortName',
              title: '客户名称',
              render: (row: any) =>
                row.customerShortName || (
                  // customerId 指向了已不存在的客户，历史数据里不少，
                  // 显出来才有人去重新选
                  <span className="text-warning-fg text-xs">未关联</span>
                ),
            },
            { key: 'title', title: '项目名称', sortable: true },
            { key: 'requirementType', title: '需求类型', render: (row: any) => typeLabel(row.requirementType) },
            { key: 'category', title: '需求来源', render: (row) => sourceLabel(row.category) },
            {
              key: 'templateCategory',
              title: '产品类型',
              render: (row: any) =>
                row.templateCategory ? (
                  row.templateCategory
                ) : (
                  <span className="text-warning-fg text-xs">未指定</span>
                ),
            },
            {
              key: 'priority',
              title: '优先级',
              sortable: true,
              render: (row) => {
                const hint = (row as any).priorityHint
                const set = (row as any).priority
                // 与建议不一致时给提示：系统按金额/客户等级推的档，供人确认（减少凭感觉排优先级）
                const mismatch = hint && set && hint !== set
                return (
                  <span className="inline-flex items-center gap-1">
                    {priorityLabel(row.priority)}
                    {hint && (
                      <span
                        className={`text-[10px] px-1 py-0.5 rounded border ${
                          hint === 'high'
                            ? 'text-danger-fg border-danger-line bg-danger-bg'
                            : hint === 'medium'
                              ? 'text-warning-fg border-warning-line bg-warning-bg'
                              : 'text-muted border-border'
                        }`}
                        title={`系统建议：${hint === 'high' ? '高' : hint === 'medium' ? '中' : '低'}（按期望金额与客户等级推算）${mismatch ? '，与当前设置不一致，建议复核' : ''}`}
                      >
                        {mismatch ? `建议${hint === 'high' ? '高' : hint === 'medium' ? '中' : '低'}` : '✓'}
                      </span>
                    )}
                  </span>
                )
              },
            },
            {
              key: 'nextFollowUpDate',
              title: '下次跟进',
              sortable: true,
              render: (row: any) => {
                if (!row.nextFollowUpDate) return <span className="text-muted">—</span>
                const d = String(row.nextFollowUpDate).slice(0, 10)
                const today = new Date().toISOString().slice(0, 10)
                const closed = ['won', 'lost', 'closed'].includes(row.status)
                const overdue = !closed && d < today
                return (
                  <span className={`tabular-nums ${overdue ? 'text-danger-fg font-medium' : d === today ? 'text-warning-fg' : 'text-ink-soft'}`} title={overdue ? '跟进日期已过' : undefined}>
                    {d === today ? '今天' : d.slice(5)}{overdue ? ' 超期' : ''}
                  </span>
                )
              },
            },
            { key: 'status', title: '状态', sortable: true, render: (row) => <StatusBadge status={row.status} label={requirementStatusLabel(row.status)} /> },
            {
              key: 'landStage',
              title: '落地阶段',
              render: (row) => {
                const meta = LAND_STAGE_META[(row as any).landStage]
                if (!meta) return <span className="text-muted">—</span>
                return (
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded border whitespace-nowrap ${meta.cls}`}
                    title="由方案→报价→合同链路自动推导，无需人工维护"
                  >
                    {meta.label}
                  </span>
                )
              },
            },
            { key: 'createdAt', title: '创建时间', sortable: true, render: (row) => new Date(row.createdAt).toLocaleDateString() },
          ]}
          rowKey={(row) => row.id}
          onRowDoubleClick={(row) => openDetail(row)}
          pagination={pagination}
          widthStorageKey="requirements"
              onSort={onSort}
          sortKey={sortBy}
          sortDirection={sortOrder === 'ASC' ? 'asc' : sortOrder === 'DESC' ? 'desc' : null}
          actions={(row) => (
            <div className="flex items-center gap-2">
              <AttachmentBadge counts={(row as any).attachmentCounts} onClick={() => openEdit(row)} />
              <button onClick={() => openDetail(row)} className="text-accent-600 hover:text-accent-700" title={"查看"}
              aria-label="查看">
                <Eye size={16} />
              </button>
              {/* 派生下一步：生成方案（客户、项目名称、编号由需求自动带出） */}
              <button
                onClick={() => navigate(`/proposals?requirementId=${row.id}`)}
                className="text-ink-soft hover:text-accent-600"
                aria-label="生成方案"
                title="由该需求生成方案"
              >
                <Layers size={16} />
              </button>
              <button onClick={() => openEdit(row)} className="text-ink-soft hover:text-ink" title={"编辑"}
              aria-label="编辑">
                <Pencil size={16} />
              </button>
              {/* 需求识别文件：先预览确认/改值，弹窗底部可导出 PDF/Word */}
              <button
                onClick={() => setExportId(row.id)}
                className="text-ink-soft hover:text-accent-600"
                title="预览需求识别文件"
                aria-label="预览识别文件"
              >
                <FileText size={16} />
              </button>
              <button onClick={() => setDeleteId(row.id)} className="text-danger-fg hover:text-danger-fg" title={"删除"}
              aria-label="删除">
                <Trash2 size={16} />
              </button>
            </div>
          )}
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
        />
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? '编辑需求' : '新建需求'}
        onConfirm={handleSubmit}
        loading={saveMutation.isPending}
        confirmDisabled={!isValid}
        size="lg"
      >
        <div className="space-y-6">
          <FormSection title="基本信息" icon={ClipboardList}>
          <FieldGrid>
            <FormInput
              label="需求编码"
              value={editing?.requirementNo || ''}
              readOnly
              placeholder="保存后自动生成"
            />
            <FormSelect
              label="需求类型"
              options={REQUIREMENT_TYPE_OPTIONS}
              value={form.requirementType}
              onChange={(e) => setValue('requirementType', e.target.value)}
            />
            <div className="md:col-span-2">
              <FormInput label="项目名称" value={form.title} onChange={(e) => setValue('title', e.target.value)} error={errors.title} required helper="四个模块共用一份，改这里会同步到方案、报价、项目" />
            </div>
            <EntityPicker
              label="关联客户"
              queryKey="customers"
              value={form.customerId}
              onChange={(id) => setValue('customerId', id)}
              search={searchCustomers}
              resolve={resolveCustomer}
              placeholder="输入客户名称搜索…"
              error={errors.customerId}
              required
            />
            <FormSelect
              label="需求来源"
              options={REQUIREMENT_SOURCE_OPTIONS}
              value={form.category}
              onChange={(e) => setValue('category', e.target.value)}
            />
            <FormInput
              label="需求时间"
              type="date"
              value={form.requirementDate}
              onChange={(e) => setValue('requirementDate', e.target.value)}
              helper="客户发出需求、我方收到的时间，可补录"
            />
            <FormSelect label="优先级" options={REQUIREMENT_PRIORITY_OPTIONS} value={form.priority} onChange={(e) => setValue('priority', e.target.value)} />
            {/*
             * 产品类型改搜索式选择：模板分类几十个，原生下拉翻找费劲。
             * 选项来自参数模板列表（本地过滤即可），清空 = 未指定（AI 自动识别）。
             */}
            <div>
              <EntityPicker
                label="产品类型"
                queryKey="requirement-template-category"
                value={form.templateCategory}
                onChange={(v) => setValue('templateCategory', v)}
                search={async (kw) => {
                  const q = (kw || '').trim().toLowerCase()
                  return templateOptions.filter(
                    (o) => !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
                  )
                }}
                resolve={async (v) => {
                  const hit = templateOptions.find((o) => o.value === v)
                  return hit || (v ? { value: v, label: v } : null)
                }}
                placeholder="搜索产品类型（如：矫直 / 剪切 / 联轴器…），留空则 AI 自动识别"
                helper="选择后自动加载对应参数模板"
              />
            </div>
            {/* 新建不显示：初始状态由服务端按审批开关决定，这里选了也不生效 */}
            {editing && (
              <FormSelect
                label="状态"
                options={[{ value: '', label: '— 不指定 —' }, ...REQUIREMENT_STATUS_OPTIONS]}
                value={form.status}
                onChange={(e) => setValue('status', e.target.value)}
                helper="需求即商机：已报价/已成交/已失单计入漏斗统计"
              />
            )}
            {editing && (
              <FormInput
                label="创建时间"
                value={editing.createdAt ? new Date(editing.createdAt).toLocaleString('zh-CN') : ''}
                readOnly
              />
            )}
          </FieldGrid>
          </FormSection>

          <FormSection title="联系人信息">
          <FieldGrid>
            {/* 联系人与客户中心联动：选定客户后可从其联系人里选（自动带出电话邮箱），
                新填的联系人保存时会自动沉淀到客户中心该客户名下 */}
            <FormInput
              label="联系人"
              list="req-contact-options"
              value={form.contactName}
              onChange={(e) => {
                const name = e.target.value
                setValue('contactName', name)
                // 姓名与客户中心联系人精确匹配 → 自动带出电话/邮箱（不覆盖已填值）
                const hit = customerContacts.find((c) => c.name === name.trim())
                if (hit) {
                  if (!form.contactPhone && hit.phone) setValue('contactPhone', hit.phone)
                  if (!form.contactEmail && hit.email) setValue('contactEmail', hit.email)
                }
              }}
              placeholder="需求提出人姓名"
              helper={form.customerId ? '输入时可选该客户的已有联系人；新联系人保存后自动同步到客户中心' : '先选择关联客户，可选其已有联系人'}
            />
            <FormInput label="联系电话" value={form.contactPhone} onChange={(e) => setValue('contactPhone', e.target.value)} />
            <FormInput label="邮箱" value={form.contactEmail} onChange={(e) => setValue('contactEmail', e.target.value)} />
          </FieldGrid>
          <datalist id="req-contact-options">
            {customerContacts.map((c) => (
              <option key={c.id || c.name} value={c.name}>{[c.department, c.title, c.phone].filter(Boolean).join(' · ')}</option>
            ))}
          </datalist>
          </FormSection>

          <FormSection title="需求描述">
          <FormTextarea label="" value={form.description} onChange={(e) => setValue('description', e.target.value)} rows={5} placeholder="记录客户原始需求，AI 将从中提取结构化参数…" />
          </FormSection>

          {/* 商机管理：填了之后工作台漏斗按金额聚合，销售过程有预判有跟进 */}
          <FormSection title="商机信息" hint="选填。预计金额与概率驱动漏斗金额视图，跟进日期用于提醒">
          <FieldGrid>
            <FormInput
              label="预计成交金额"
              type="number"
              min="0"
              value={form.expectedAmount}
              onChange={(e) => setValue('expectedAmount', e.target.value)}
              placeholder={amountRef?.median ? `同类参考 ${Math.round(amountRef.median).toLocaleString('zh-CN')}` : '如 250000'}
              helper={amountRef?.count ? `同类产品历史报价 ${amountRef.count} 单：${Math.round(amountRef.min || 0).toLocaleString('zh-CN')} ~ ${Math.round(amountRef.max || 0).toLocaleString('zh-CN')} 元（仅供参考）` : undefined}
            />
            <FormInput label="预计成交日期" type="date" value={form.expectedDealDate} onChange={(e) => setValue('expectedDealDate', e.target.value)} />
            <FormInput label="赢单概率 (%)" type="number" min="0" max="100" value={form.winProbability} onChange={(e) => setValue('winProbability', e.target.value)} placeholder="0-100" />
            <FormInput label="下次跟进日期" type="date" value={form.nextFollowUpDate} onChange={(e) => setValue('nextFollowUpDate', e.target.value)} helper={!editing && !form.nextFollowUpDate ? '不填则默认 7 天后，到期出现在工作台「我的今天」' : undefined} />
            <FormInput label="输单原因" value={form.lossReason} onChange={(e) => setValue('lossReason', e.target.value)} placeholder="失单时填写，沉淀经验" />
          </FieldGrid>
          </FormSection>

          {/* 客户常分几次给资料，这里累加保留，并同步进资料中心 */}
          <FormSection title="需求资料" icon={Download} hint="标记为输入文件(客户提交)或输出文件(我方提交)，同步进客户资料">
            <EntityFileUpload
              entityType="requirement"
              entityId={editing?.id}
              entityNo={editing?.requirementNo}
              customerId={form.customerId}
              category="需求资料"
            />
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
        {previewLoading ? (
          <p className="text-sm text-muted">正在检查关联项…</p>
        ) : removePreview?.hasImpact ? (
          <div className="space-y-2">
            <p className="text-sm text-ink-soft">删除该需求将连带影响以下内容：</p>
            <ul className="text-sm text-ink-soft space-y-1 pl-1">
              {removePreview.customerName && (
                <li>· 关联客户：<span className="text-ink font-medium">{removePreview.customerName}</span></li>
              )}
              {removePreview.linkedDocsCount > 0 && (
                <li>· 客户资料 <b className="text-danger-fg">{removePreview.linkedDocsCount}</b> 份将被删除（含"需求阶段"档案）</li>
              )}
              {removePreview.attachmentsCount > 0 && (
                <li>· 需求附件 <b className="text-danger-fg">{removePreview.attachmentsCount}</b> 个将被删除</li>
              )}
              {removePreview.proposalsCount > 0 && (
                <li>· <b className="text-warning-fg">{removePreview.proposalsCount}</b> 个方案将解除关联</li>
              )}
              {removePreview.projectsCount > 0 && (
                <li>· <b className="text-warning-fg">{removePreview.projectsCount}</b> 个项目将解除关联</li>
              )}
            </ul>
            <p className="text-xs text-muted">方案/项目为解除关联（保留数据，还原需求时自动接回）；只挂在本需求上的资料进入资料回收站。</p>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">确定要删除该需求吗？该需求无关联客户资料与下游。</p>
        )}
        <DeleteImpact type="requirement" id={deleteId} refs={false} />
      </Modal>

      {/* 导出预览：按文档版式预览、改值后再导出 PDF/Word */}
      <IdentificationPreviewModal
        open={!!exportId}
        onClose={() => setExportId(null)}
        requirementId={exportId}
      />

    </div>
  )
}
