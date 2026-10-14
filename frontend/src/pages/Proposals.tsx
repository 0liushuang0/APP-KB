import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, Plus, Sparkles, Eye, Pencil, Trash2, FileDown, Lightbulb, Package, FileText, DollarSign, ClipboardList, CheckCircle, Circle, ArrowRight, FileUp } from 'lucide-react'
import { proposalApi, customerApi, requirementApi, solutionApi, proposalDocApi } from '../api/services'
import { useDebounce } from '../hooks/useDebounce'
import { usePagedQuery } from '../hooks/usePagedQuery'
import { useFormValidation, required } from '../hooks/useFormValidation'
import { useModuleStats } from '../hooks/useModuleStats'
import { usePageActions } from '../contexts/PageActionsContext'
import StatCards from '../components/StatCards'
import type { Proposal } from '../types'
import Button from '../components/Button'
import Modal from '../components/Modal'
import AttachmentBadge from '../components/AttachmentBadge'
import Drawer from '../components/Drawer'
import FormInput from '../components/FormInput'
import FormSelect from '../components/FormSelect'
import EntityPicker from '../components/EntityPicker'
import EntityFileUpload from '../components/EntityFileUpload'
import SharedFieldNotice from '../components/SharedFieldNotice'
import { toList } from '../utils/apiList'
import FormTextarea from '../components/FormTextarea'
import DataTable from '../components/DataTable'
import BatchEditBar from '../components/BatchEditBar'
import StatusBadge from '../components/StatusBadge'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import PageHeader from '../components/PageHeader'
import RelatedChain from '../components/RelatedChain'
import { FormSection, FieldGrid, DetailHeader, DetailSection, DescList } from '../components/layout-kit'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'

const initialForm = {
  proposalNo: '',
  title: '',
  customerId: '',
  productDescription: '',
  proposalType: 'technical',
  content: '',
  requirements: '',
}

const initialAiForm = {
  customerId: '',
  title: '',
  productDescription: '',
  requirements: '',
}

/**
 * 方案类型。
 *
 * 前三项是原有的，后两项（equipment / parts）才是库里实际在用的取值 ——
 * 缺了它们，列表的类型列只会显示英文原文。
 */
const typeOptions = [
  { value: 'equipment', label: '整机设备' },
  { value: 'parts', label: '零部件' },
  { value: 'technical', label: '技术方案' },
  { value: 'business', label: '商务方案' },
  // 原叫「解决方案」：模块已更名「解决方案」，类型再叫同名就嵌套了 —— 技术含量与商务内容
  // 兼备、不偏一边的方案叫「综合方案」。value 不动，存量数据不受影响。
  { value: 'solution', label: '综合方案' },
]

const handleError = (error: any) => {
  toast.error(error?.response?.data?.message || error?.message || '操作失败')
}

function RecSection({ icon, title, items }: { icon: React.ReactNode; title: string; items?: { sourceId: string; content: string; score: number }[] }) {
  if (!items || items.length === 0) return null
  return (
    <div className="eo-card p-4">
      <h4 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
        {icon} {title} <span className="text-muted font-normal">({items.length})</span>
      </h4>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="flex items-start gap-3 bg-subtle p-3 rounded-md text-sm">
            <div className="flex-shrink-0 mt-0.5">
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${it.score > 0.8 ? 'bg-success-bg text-success-fg' : it.score > 0.6 ? 'bg-warning-bg text-warning-fg' : 'bg-border text-ink-soft'}`}>
                {(it.score * 100).toFixed(0)}%
              </span>
            </div>
            <div className="text-ink-soft text-xs leading-relaxed flex-1 min-w-0">
              <div className="font-mono text-caption text-muted mb-0.5">{it.sourceId}</div>
              <div className="truncate">{it.content}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Proposals() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  // 按方案状态过滤（后端列表接口已支持 status 参数）
  const [statusFilter, setStatusFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [aiOpen, setAiOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  /*
   * 打开弹窗时的项目名称原值。
   *
   * 项目名称是四个模块共用的一份，谁保存谁写回。但如果每次保存都无条件写回，
   * 拿的就是这个弹窗**加载时**的值 —— 别的页面刚改过的新名字会被这个旧值盖掉，
   * 表现就是"改完又回退了"。所以只在用户真的动过这个字段时才写回。
   */
  const [originalProjectName, setOriginalProjectName] = useState('')
  // 来源需求（派生新建时用于预填项目名称、只读展示客户）
  const [derivedRequirement, setDerivedRequirement] = useState<any>(null)
  const [editing, setEditing] = useState<Proposal | null>(null)
  const [selected, setSelected] = useState<Proposal | null>(null)
  const { values: form, errors, isValid, setValue, setValues, validateAll, reset } = useFormValidation({
    initialValues: initialForm,
    rules: {
      // 方案编号由后端继承需求编号自动生成（PROP-007 ← REQ-007），不再手填
      title: required('请输入项目名称'),
    },
  })
  const [aiForm, setAiForm] = useState(initialAiForm)
  const [tab, setTab] = useState<'list' | 'recommend'>('list')
  const [selectedRequirement, setSelectedRequirement] = useState('')
  const [recommendResult, setRecommendResult] = useState<any>(null)
  const [workflowStep, setWorkflowStep] = useState(1)
  const [requirementDetail, setRequirementDetail] = useState<any>(null)
  const [selectedSolutionId, setSelectedSolutionId] = useState('')
  const [draftProposal, setDraftProposal] = useState('')
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [searchParams] = useSearchParams()

  // 从需求详情页「新建方案」跳过来时，只显示该需求下的方案并预填来源需求
  const fromRequirementId = searchParams.get('requirementId') || ''
  const highlightId = searchParams.get('highlight') || ''

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
  } = usePagedQuery<Proposal>({
    key: ['proposals'],
    filters: {
      keyword: debouncedSearch || undefined,
      requirementId: fromRequirementId || undefined,
      status: statusFilter || undefined,
    },
    fetcher: (p) => proposalApi.list(p) as any,
    initialPageSize: 15,
  })

  useRegisterPageAssistant({
    key: 'proposals',
    label: '解决方案',
    sourceTypes: ['proposal', 'requirement', 'solution', 'customer', 'product'],
    questions: [
      '本页方案分别对应哪些客户和需求？',
      '哪些方案还停在草稿、需要推进？',
      '挑一份方案，总结它的技术要点',
      '这些方案里有哪些可以复用的模块？',
      '按当前列表，方案覆盖了哪些设备类型？',
    ],
    context: [
      `页面：解决方案（共 ${pagination?.total ?? listData.length} 份，当前第 ${pagination?.page ?? 1} 页）`,
      search ? `搜索关键词：${search}` : '',
      statusFilter ? `状态筛选：${statusFilter}` : '',
      '当前页方案清单：',
      ...listData
        .slice(0, 40)
        .map(
          (x: Proposal, i: number) =>
            `${i + 1}. ${(x as any).proposalNo || ''} ${x.title || ''}｜客户 ${(x as any).customer?.name || (x as any).customerName || '—'}｜版本 ${(x as any).version || '—'}｜状态 ${x.status || '—'}`,
        ),
    ]
      .filter(Boolean)
      .join('\n'),
  })

  const detailQuery = useQuery({
    queryKey: ['proposal', selected?.id],
    queryFn: () => (selected?.id ? proposalApi.get(selected.id) : null),
    enabled: !!selected?.id,
  })

  // 客户 195 条、服务端每页只回 20 —— 必须走搜索，不能一次拉全量塞下拉

  /**
   * 需求候选：显示「需求编号 · 客户简称 · 项目名称」。
   *
   * 原来是原生 select 一次性铺开全部需求，既不能搜、也只拿得到第一页；
   * 而选方案要参照的正是客户和项目，光有编号认不出来是哪一单。
   */
  const searchRequirements = async (keyword: string) => {
    const res = await requirementApi.list({ keyword: keyword || undefined, pageSize: 50 })
    return toList<any>(res).map((r) => ({
      value: r.id,
      label: `${r.requirementNo} · ${r.customerShortName || '未关联客户'}`,
      hint: r.title,
    }))
  }

  const resolveRequirement = async (id: string) => {
    const r: any = await requirementApi.get(id)
    return r
      ? { value: r.id, label: `${r.requirementNo} · ${r.customerShortName || '未关联客户'}`, hint: r.title }
      : null
  }

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

  const { data: solutions } = useQuery({
    queryKey: ['solutions-select'],
    queryFn: () => solutionApi.list(),
    enabled: tab === 'recommend',
  })


  useEffect(() => {
    if (!highlightId || !listData.length) return
    const highlighted = listData.find((item: Proposal) => item.id === highlightId)
    if (highlighted) {
      setSelected(highlighted)
      setDrawerOpen(true)
    }
  }, [highlightId, listData])

  const saveMutation = useMutation({
    mutationFn: (dto: any) => {
      if (editing) return proposalApi.update(editing.id, dto)
      return proposalApi.create(dto)
    },
    onSuccess: () => {
      // 项目名称/客户是四个模块共用的一份，改完要让它们一起重新取数，
      // 否则用户切过去看到的还是旧值，会以为没保存成功
      for (const k of ['proposals', 'requirements', 'quotations', 'projects']) {
        queryClient.invalidateQueries({ queryKey: [k] })
      }
      closeModal()
      refetch()
    },
    onError: handleError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => proposalApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] })
      setDeleteId(null)
      refetch()
    },
    onError: handleError,
  })

  const generateMutation = useMutation({
    mutationFn: (dto: any) => proposalApi.generate(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] })
      setAiOpen(false)
      setAiForm(initialAiForm)
      refetch()
    },
    onError: handleError,
  })

  const recommendMutation = useMutation({
    mutationFn: (requirementId: string) => proposalApi.recommend(requirementId),
    onSuccess: (data) => {
      setRecommendResult(data)
    },
    onError: handleError,
  })

  const exportProposal = (id: string) => {
    window.open(proposalApi.export(id), '_blank')
  }

  const handleSelectRequirement = async (reqId: string) => {
    setSelectedRequirement(reqId)
    setRequirementDetail(null)
    setRecommendResult(null)
    setSelectedSolutionId('')
    setDraftProposal('')
    setWorkflowStep(1)
    if (reqId) {
      setLoadingDetail(true)
      try {
        const detail = await requirementApi.get(reqId)
        setRequirementDetail(detail)
      } catch { /* ignore */ }
      setLoadingDetail(false)
    }
  }

  const handleMatchSolutions = () => {
    if (!selectedRequirement) return
    recommendMutation.mutate(selectedRequirement, {
      onSuccess: () => setWorkflowStep(2),
    })
  }

  const handleGenerateProposal = () => {
    if (!recommendResult?.draftProposal && !selectedSolutionId) return
    setDraftProposal(recommendResult?.draftProposal || '')
    setWorkflowStep(3)
  }

  const handleSaveProposal = () => {
    if (!draftProposal) return
    const req = recommendResult?.requirement || requirementDetail
    saveMutation.mutate({
      // 编号交给后端继承需求编号（原先写死 PROP-${Date.now()} 会生成与库里不一致的编号）
      title: req?.title ? `${req.title} - 技术方案` : '智能推荐技术方案',
      customerId: req?.customerId || '',
      requirementId: selectedRequirement,
      content: draftProposal,
      proposalType: 'technical',
      aiGenerated: true,
    })
  }

  const resetWorkflow = () => {
    setSelectedRequirement('')
    setRequirementDetail(null)
    setRecommendResult(null)
    setSelectedSolutionId('')
    setDraftProposal('')
    setWorkflowStep(1)
  }

  // 带着 ?requirementId= 进来时自动打开新建弹窗，并从需求预填项目名称/客户，省掉手填
  useEffect(() => {
    if (fromRequirementId && !modalOpen && !editing) {
      reset()
      setModalOpen(true)
      requirementApi.get(fromRequirementId).then((r: any) => {
        setValues((prev) => ({ ...prev, title: r.title || '' }))
        // 项目名称与需求一致，视为未改动 —— 保存时不触发无谓的写回
        setOriginalProjectName(r.title || '')
        setDerivedRequirement(r)
      }).catch(() => {})
    }
    // 只在初次带参进入时触发
     
  }, [fromRequirementId])

  const openEdit = (row: Proposal) => {
    setEditing(row)
    setOriginalProjectName((row as any).projectName || row.title || '')
    setValues({
      proposalNo: row.proposalNo || '',
      // 项目名称来自关联需求；方案自己的 title 已废弃并清空，
      // 直接读它会让必填校验永远不通过，确定按钮一直是灰的
      title: (row as any).projectName || row.title || '',
      customerId: row.customerId || '',
      productDescription: row.productDescription || '',
      proposalType: row.proposalType || 'technical',
      content: row.content || '',
      requirements: row.requirements || '',
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    setDerivedRequirement(null)
    reset()
  }

  const openDetail = (row: Proposal) => {
    setSelected(row)
    setDrawerOpen(true)
  }

  /**
   * 从 Word 导入正文。
   *
   * 走后端 /proposals/:id/extract —— 解析在 AI 服务本机完成（python-docx），
   * 原文件不出内网。回填后仍可手工修改再保存。
   */
  const [extracting, setExtracting] = useState(false)
  const handleExtract = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !editing) return
    setExtracting(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const updated: any = await proposalDocApi.extractFromDoc(editing.id, fd)
      setValues((prev) => ({
        ...prev,
        content: updated.content || prev.content,
        productDescription: updated.productDescription || prev.productDescription,
        requirements: updated.requirements || prev.requirements,
      }))
      toast.success('已导入并解析')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || '解析失败')
    } finally {
      setExtracting(false)
      e.target.value = ''
    }
  }

  const handleSubmit = () => {
    if (!validateAll()) return
    // 编号被清空 = 要求重新生成（后端按规则继承需求尾号），删除前先确认一次
    if (editing && (form.proposalNo || '').trim() === '' && editing.proposalNo) {
      const ok = window.confirm('已清空方案编码，保存后将按规则重新生成编号。确认继续？')
      if (!ok) return
    }
    saveMutation.mutate({
      ...form,
      // 只在用户真改过时才写回，否则会用打开弹窗时的旧值盖掉别处的新值
      projectName: form.title !== originalProjectName ? form.title : undefined,
      // 建立需求 → 方案的链路
      requirementId: fromRequirementId || (editing as any)?.requirementId || undefined,
    })
  }


  const setPageActions = usePageActions()
  useEffect(() => {
    setPageActions(
      <>
        {tab === 'list' && (
          <>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                placeholder="搜索编号/标题"
                onChange={(e) => setSearch(e.target.value)}
                className="eo-input !w-60 !pl-8 !py-1 !text-sm"
              />
            </div>
            {/* 状态筛选收到顶栏，与搜索、视图切换同行展示 */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="eo-input !w-28 !py-1 !text-xs"
              aria-label="按状态筛选"
            >
              <option value="">全部状态</option>
              <option value="draft">草稿</option>
              <option value="pending">待审核</option>
              <option value="approved">已审核</option>
              <option value="rejected">已驳回</option>
            </select>
            {statusFilter && (
              <button onClick={() => setStatusFilter('')} className="text-caption text-muted hover:text-ink transition-colors">
                清除
              </button>
            )}
            {/* 批量操作收到顶栏：选中后才出现，琥珀修改/红色删除一眼可见 */}
            <BatchEditBar
              selectedKeys={selectedKeys}
              onClear={() => setSelectedKeys([])}
              moduleName="方案"
              queryKey={['proposals']}
              updateFn={(id, dto) => proposalApi.update(id, dto)}
              deleteFn={(id) => proposalApi.remove(id)}
              fields={[
                { key: 'proposalType', label: '方案类型', options: typeOptions },
                { key: 'status', label: '状态', options: [
                  { value: 'draft', label: '草稿' }, { value: 'pending', label: '待审核' },
                  { value: 'approved', label: '已审核' }, { value: 'rejected', label: '已驳回' },
                ] },
              ]}
            />
          </>
        )}
        <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-0.5">
          <button
            onClick={() => setTab('list')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${tab === 'list' ? 'bg-accent-500 text-white' : 'text-muted hover:text-ink'}`}
          >
            方案列表
          </button>
          <button
            onClick={() => setTab('recommend')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${tab === 'recommend' ? 'bg-accent-500 text-white' : 'text-muted hover:text-ink'}`}
          >
            <Lightbulb size={12} /> 智能推荐
          </button>
        </div>
        {tab === 'list' && (
          <Button variant="secondary" size="sm" onClick={() => setAiOpen(true)} className="!py-1 !text-sm">
            <Sparkles size={13} className="mr-0.5" /> AI生成
          </Button>
        )}
      </>
    )
    return () => setPageActions(null)
     
  }, [tab, statusFilter, selectedKeys])

  const { stats, isLoading: statsLoading } = useModuleStats()
  const p = stats?.proposals
  const proposalCards = [
    { label: '方案总数', value: p?.total ?? 0, icon: FileText },
    { label: '待审批', value: p?.pending ?? 0, icon: ClipboardList },
    { label: '已通过', value: p?.approved ?? 0, icon: CheckCircle },
    { label: '已驳回', value: p?.rejected ?? 0, icon: Circle },
    { label: '本月新增', value: p?.newThisMonth ?? 0, icon: Plus },
  ]

  return (
    <div>
      <PageHeader title="方案" titleEm="管理" />

      {/* 统计卡片：与业务概览顶部同一套组件，各模块高度与配色一致 */}
      <StatCards className="mb-4" loading={statsLoading} skeletonCount={5} items={proposalCards} />

      {tab === 'list' && (
        <>
          {isLoading && !listData.length && <PageLoader />}
          {isError && <ErrorState message={error?.message || '加载失败'} onRetry={refetch} />}
          {!isLoading && !isError && (
            <DataTable
              loading={isLoading}
              data={listData}
              columns={[
                { key: 'proposalNo', title: '方案编码', sortable: true },
                {
                  key: 'customerShortName',
                  title: '客户名称',
                  render: (row: any) =>
                    row.customerShortName || <span className="text-warning-fg text-xs">未关联</span>,
                },
                {
                  key: 'projectName',
                  title: '项目名称',
                  // 项目名称由关联需求提供，方案不再自己存标题
                  render: (row: any) =>
                    row.projectName || <span className="text-warning-fg text-xs">未关联需求</span>,
                },
                {
                  key: 'proposalType',
                  title: '类型',
                  render: (row) => typeOptions.find((o) => o.value === row.proposalType)?.label || row.proposalType || '-',
                },
                { key: 'version', title: '版本', render: (row) => row.version || 'v1' },
                { key: 'status', title: '状态', sortable: true, render: (row) => <StatusBadge status={row.status} /> },
                { key: 'createdAt', title: '创建时间', sortable: true, render: (row) => new Date(row.createdAt).toLocaleDateString() },
              ]}
              rowKey={(row) => row.id}
              onRowDoubleClick={(row) => openDetail(row)}
              pagination={pagination}
              widthStorageKey="proposals"
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
                  {/* 派生下一步：生成报价（客户、项目名称、编号由方案自动带出） */}
                  <button
                    onClick={() => navigate(`/quotations?fromProposalId=${row.id}`)}
                    className="text-ink-soft hover:text-accent-600"
                    aria-label="生成报价"
                    title="由该方案生成报价"
                  >
                    <DollarSign size={16} />
                  </button>
                  <button onClick={() => exportProposal(row.id)} className="text-ink-soft hover:text-ink" title={"导出"}
                  aria-label="导出">
                    <FileDown size={16} />
                  </button>
                  <button onClick={() => openEdit(row)} className="text-ink-soft hover:text-ink" title={"编辑"}
                  aria-label="编辑">
                    <Pencil size={16} />
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
        </>
      )}

      {tab === 'recommend' && (
        <div className="space-y-4">
          {/* Stepper */}
          <div className="flex items-center gap-2 bg-surface border border-border rounded-lg p-3">
            {[
              { n: 1, label: '选择需求', desc: '查看结构化识别结果' },
              { n: 2, label: '匹配方案', desc: '从标准方案库智能匹配' },
              { n: 3, label: '生成方案', desc: 'AI 融合生成技术方案' },
            ].map((s, i) => (
              <div key={s.n} className="flex items-center gap-2 flex-1">
                <div className={`flex items-center gap-2 ${workflowStep >= s.n ? 'text-accent-600' : 'text-muted'}`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    workflowStep > s.n ? 'bg-success-fg text-white' : workflowStep === s.n ? 'bg-accent-500 text-white' : 'bg-canvas text-muted border border-border'
                  }`}>
                    {workflowStep > s.n ? <CheckCircle size={15} /> : s.n}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-tight">{s.label}</div>
                    <div className="text-caption text-muted leading-tight">{s.desc}</div>
                  </div>
                </div>
                {i < 2 && <div className={`h-px flex-1 ${workflowStep > s.n ? 'bg-accent-300' : 'bg-border'}`} />}
              </div>
            ))}
          </div>

          {/* Step 1: Select Requirement + Structured Spec */}
          {workflowStep === 1 && (
            <div className="space-y-4">
              <div className="eo-card p-4">
                <label className="eo-label block mb-2">选择客户需求</label>
                <EntityPicker
                  queryKey="requirements-picker"
                  value={selectedRequirement}
                  onChange={(id) => handleSelectRequirement(id)}
                  search={searchRequirements}
                  resolve={resolveRequirement}
                  placeholder="按需求编号、客户或项目名称搜索…"
                />
              </div>

              {loadingDetail && <PageLoader />}

              {requirementDetail && (
                <div className="eo-card p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <ClipboardList size={16} className="text-accent-500" />
                    <h4 className="text-sm font-semibold text-ink">{requirementDetail.title}</h4>
                    {requirementDetail.priority === 'high' && <span className="text-xs text-danger-fg">高优先级</span>}
                  </div>
                  {requirementDetail.description && (
                    <p className="text-xs text-muted leading-relaxed">{requirementDetail.description}</p>
                  )}

                  {/* Structured Spec */}
                  {requirementDetail.structuredSpec && requirementDetail.structuredSpec !== '{}' ? (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="eo-label">结构化识别结果</span>
                        <span className={`text-caption px-2 py-0.5 rounded-full ${
                          requirementDetail.specStatus === 'analyzed' ? 'bg-success-fg/10 text-success-fg' : 'bg-warning-fg/10 text-warning-fg'
                        }`}>
                          {requirementDetail.specStatus === 'analyzed' ? '✓ 已识别' : '待识别'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {Object.entries(JSON.parse(requirementDetail.structuredSpec || '{}')).slice(0, 9).map(([key, val]: [string, any]) => (
                          <div key={key} className="bg-canvas rounded-md px-3 py-2">
                            <div className="text-caption text-muted">{key}</div>
                            <div className="text-xs font-medium text-ink">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-canvas rounded-md p-4 text-center">
                      <p className="text-xs text-muted mb-2">该需求尚未进行结构化识别</p>
                      <a href={`/requirements/${requirementDetail.id}`} className="text-xs text-accent-600 hover:underline">
                        → 前往需求详情页进行 AI 结构化分析
                      </a>
                    </div>
                  )}

                  <Button onClick={handleMatchSolutions} loading={recommendMutation.isPending} disabled={!selectedRequirement} className="w-full">
                    <Sparkles size={16} className="mr-2" /> 匹配标准方案
                  </Button>
                </div>
              )}

              {!selectedRequirement && !loadingDetail && (
                <div className="eo-card p-12 flex flex-col items-center justify-center text-muted">
                  <ClipboardList size={48} className="mb-4 text-border" />
                  <p className="text-sm">请选择一条客户需求开始</p>
                  <p className="text-xs mt-1">系统将展示结构化识别结果并匹配标准方案</p>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Match Standard Solutions */}
          {workflowStep === 2 && (
            <div className="space-y-4">
              {recommendResult?.analysis && (
                <div className="eo-card p-4">
                  <div className="eo-label mb-2">AI 需求分析</div>
                  <div className="text-xs text-ink-soft bg-accent-50/50 border border-accent-200/40 p-3 rounded-md whitespace-pre-wrap">
                    {recommendResult.analysis}
                  </div>
                </div>
              )}

              {/* Standard Solutions Library */}
              <div className="eo-card p-4">
                <h4 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
                  <Lightbulb size={16} className="text-accent-500" /> 标准方案库 ({(Array.isArray(solutions) ? solutions : []).length})
                </h4>
                <div className="space-y-2">
                  {(Array.isArray(solutions) ? solutions : []).map((sol: any) => (
                    <button
                      key={sol.id}
                      onClick={() => setSelectedSolutionId(sol.id)}
                      className={`w-full text-left flex items-center gap-3 p-3 rounded-md border transition-colors ${
                        selectedSolutionId === sol.id ? 'border-accent-500 bg-accent-50/50' : 'border-border hover:bg-canvas'
                      }`}
                    >
                      {selectedSolutionId === sol.id ? <CheckCircle size={16} className="text-accent-500 flex-shrink-0" /> : <Circle size={16} className="text-muted flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-ink truncate">{sol.name}</div>
                        <div className="text-xs text-muted truncate">{sol.description || '—'}</div>
                      </div>
                      {sol.category && <span className="text-caption text-muted bg-canvas px-2 py-0.5 rounded-full flex-shrink-0">{sol.category}</span>}
                    </button>
                  ))}
                </div>
              </div>

              {/* AI Recommended Products */}
              {recommendResult && (
                <>
                  <RecSection icon={<Package size={16} />} title="匹配产品" items={recommendResult.recommendations?.products} />
                  <RecSection icon={<FileText size={16} />} title="CAD 图纸 / 技术协议" items={recommendResult.recommendations?.productAttachments} />
                  <RecSection icon={<DollarSign size={16} />} title="推荐报价" items={recommendResult.recommendations?.quotations} />
                </>
              )}

              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setWorkflowStep(1)}>上一步</Button>
                <Button onClick={handleGenerateProposal} className="flex-1">
                  生成技术方案 <ArrowRight size={15} className="ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Generate Proposal */}
          {workflowStep === 3 && (
            <div className="space-y-4">
              <div className="eo-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-ink flex items-center gap-2">
                    <ClipboardList size={16} className="text-accent-500" /> 技术方案草稿
                  </h4>
                  <span className="text-caption text-muted">AI 生成 · 可编辑</span>
                </div>
                <textarea
                  value={draftProposal}
                  onChange={(e) => setDraftProposal(e.target.value)}
                  className="eo-input w-full font-mono text-xs"
                  rows={20}
                  placeholder="技术方案内容..."
                />
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setWorkflowStep(2)}>上一步</Button>
                <Button onClick={handleSaveProposal} loading={saveMutation.isPending} className="flex-1">
                  <Plus size={15} className="mr-1" /> 保存为技术方案
                </Button>
              </div>
            </div>
          )}

          {/* Reset button */}
          {workflowStep > 1 && (
            <button onClick={resetWorkflow} className="text-xs text-muted hover:text-ink mx-auto block">
              ← 重新开始
            </button>
          )}
        </div>
      )}

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
          <SharedFieldNotice origin="proposal" id={editing?.id} />

          <FormSection title="基本信息" icon={FileText}>
            <FieldGrid>
              <FormInput
                label="方案编号"
                value={editing ? form.proposalNo : ''}
                onChange={(e) => setValue('proposalNo', e.target.value)}
                readOnly={!editing}
                placeholder="保存后自动生成（继承需求编号）"
                helper={editing ? '可修改（不能与其他方案重复）；清空保存则按规则重新生成' : undefined}
              />
              {editing && (
                <FormInput
                  label="创建时间"
                  value={editing.createdAt ? new Date(editing.createdAt).toLocaleString('zh-CN') : ''}
                  readOnly
                />
              )}
              <FormSelect label="方案类型" options={typeOptions} value={form.proposalType} onChange={(e) => setValue('proposalType', e.target.value)} />
          <FormInput
            label="项目名称"
            value={form.title}
            onChange={(e) => setValue('title', e.target.value)}
            error={errors.title}
            required
            disabled={!editing}
            helper={editing ? '与关联需求共用一份，此处修改会同步过去' : '取自关联需求，如需修改请到需求页'}
          />
          {/* 客户跟随关联需求，不再单独选 —— 否则会出现项目名称与客户对不上的记录 */}
          <FormInput
            label="客户名称"
            value={
              editing
                ? ((editing as any).customerShortName || (editing as any).customerName || '')
                : (derivedRequirement?.customer?.name || derivedRequirement?.customerShortName || derivedRequirement?.customerName || '')
            }
            readOnly
            placeholder="由关联需求带出"
            helper="客户取自关联需求，如需变更请到客户需求页修改"
          />
            </FieldGrid>
          </FormSection>

          <FormSection title="方案内容" icon={ClipboardList}>
            <div className="space-y-3.5">
              <FormTextarea label="产品描述" value={form.productDescription} onChange={(e) => setValue('productDescription', e.target.value)} rows={3} />
              <FormTextarea label="技术要求" value={form.requirements} onChange={(e) => setValue('requirements', e.target.value)} rows={3} />
              {/*
                方案正文既可以直接写，也可以传一份写好的 Word 让系统抽出来。
                售前实际是在 Word 里成稿的（有模板、要发客户），
                逼着在这里重录一遍纯属重复劳动。
              */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="eo-label">方案正文</label>
                  <label className="text-xs text-accent-600 hover:text-accent-700 cursor-pointer inline-flex items-center gap-1">
                    <FileUp size={13} />
                    {extracting ? '解析中…' : '从 Word 导入'}
                    <input
                      type="file"
                      accept=".docx,.doc,.pdf"
                      className="hidden"
                      disabled={!editing || extracting}
                      onChange={handleExtract}
                    />
                  </label>
                </div>
                <FormTextarea label="" value={form.content} onChange={(e) => setValue('content', e.target.value)} rows={10} />
                <p className="mt-1 text-xs text-muted">
                  {editing
                    ? '导入后会自动填充正文，并尝试摘取产品描述与技术要求。文件在本机解析，不会上传外网。'
                    : '方案保存后才能导入文件'}
                </p>
              </div>
            </div>
          </FormSection>

          <FormSection title="方案资料" hint="标记为输入文件(客户提交)或输出文件(我方提交)，同步进客户资料">
            <EntityFileUpload
              entityType="proposal"
              entityId={editing?.id}
              entityNo={editing?.proposalNo}
              customerId={(editing as any)?.customerId || undefined}
              category="方案资料"
            />
          </FormSection>
        </div>
      </Modal>

      <Modal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        title="AI 生成方案"
        onConfirm={() => generateMutation.mutate(aiForm)}
        loading={generateMutation.isPending}
        // 没有客户和技术要求时，生成结果没有任何可参考的上下文，直接禁用提交
        confirmDisabled={!aiForm.customerId || !aiForm.requirements.trim()}
        confirmText="生成"
        size="lg"
      >
        <div className="space-y-4">
          <EntityPicker
            label="客户"
            queryKey="customers"
            value={aiForm.customerId}
            onChange={(id) => setAiForm({ ...aiForm, customerId: id })}
            search={searchCustomers}
            resolve={resolveCustomer}
            placeholder="输入客户名称搜索…"
            required
          />
          <FormInput label="方案标题" value={aiForm.title} onChange={(e) => setAiForm({ ...aiForm, title: e.target.value })} />
          <FormTextarea label="产品描述" value={aiForm.productDescription} onChange={(e) => setAiForm({ ...aiForm, productDescription: e.target.value })} />
          <FormTextarea label="技术要求" value={aiForm.requirements} onChange={(e) => setAiForm({ ...aiForm, requirements: e.target.value })} rows={4} required />
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

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="方案详情" width="w-[600px]">
        {detailQuery.isLoading ? (
          <PageLoader />
        ) : detailQuery.isError ? (
          <ErrorState message={detailQuery.error?.message || '加载失败'} onRetry={() => detailQuery.refetch()} />
        ) : (
          <div className="space-y-6">
            {/* 同一业务线上的其它单据，点编号直接跳过去 */}
            <RelatedChain origin="proposal" id={selected?.id} currentId={selected?.id} />

            <DetailHeader
              title={(selected as any)?.projectName}
              code={detailQuery.data?.proposalNo}
              badge={<StatusBadge status={detailQuery.data?.status} />}
              stats={[
                { label: '客户', value: (selected as any)?.customerShortName },
                {
                  label: '类型',
                  value:
                    typeOptions.find((o) => o.value === detailQuery.data?.proposalType)?.label ||
                    detailQuery.data?.proposalType,
                },
                { label: '版本', value: `v${detailQuery.data?.version || 1}` },
              ]}
            />

            <DetailSection title="产品与技术要求">
              <DescList
                items={[
                  { label: '产品描述', value: (detailQuery.data as any)?.productDescription, full: true },
                  { label: '技术要求', value: (detailQuery.data as any)?.requirements, full: true },
                ]}
              />
            </DetailSection>

            <div>
              <h4 className="text-sm font-semibold text-ink mb-2">方案内容</h4>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap bg-subtle p-4 rounded-md">
                {detailQuery.data?.content || '无'}
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => detailQuery.data?.id && exportProposal(detailQuery.data.id)} className="flex-1">
                <FileDown size={16} className="mr-2" /> 导出 Word
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}

