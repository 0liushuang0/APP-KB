import { useEffect, useState } from 'react'
import DeleteImpact from '../components/DeleteImpact'
import { Link, useSearchParams, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, Eye, Pencil, Trash2, PlusCircle, MinusCircle, FolderKanban, Headset, Compass, Activity, CheckCircle2, PauseCircle, AlertTriangle, List, GanttChart } from 'lucide-react'
import FocusBar, { useFocus } from '../components/FocusBar'
import ProjectGantt from '../components/charts/ProjectGantt'
import { projectApi, userApi } from '../api/services'
import { useDebounce } from '../hooks/useDebounce'
import { useFormValidation, required } from '../hooks/useFormValidation'
import { usePagedQuery } from '../hooks/usePagedQuery'
import { useModuleStats } from '../hooks/useModuleStats'
import { usePageActions } from '../contexts/PageActionsContext'
import StatCards from '../components/StatCards'
import type { Project, ProjectStage, ProjectRisk } from '../types'
import { PROJECT_TYPE_OPTIONS, TASK_PRIORITY_OPTIONS, TASK_STATUS_OPTIONS } from '../types'
import Button from '../components/Button'
import Modal from '../components/Modal'
import AttachmentBadge from '../components/AttachmentBadge'
import ConfirmDialog from '../components/ConfirmDialog'
import Drawer from '../components/Drawer'
import FormInput from '../components/FormInput'
import FormSelect from '../components/FormSelect'
import FormTextarea from '../components/FormTextarea'
import DataTable from '../components/DataTable'
import BatchEditBar from '../components/BatchEditBar'
import StatusBadge from '../components/StatusBadge'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import PageHeader from '../components/PageHeader'
import RelatedChain from '../components/RelatedChain'
import SharedFieldNotice from '../components/SharedFieldNotice'
import { FormSection, FieldGrid, DetailHeader, DetailSection, DescList } from '../components/layout-kit'
import EntityFileUpload from '../components/EntityFileUpload'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'
import CustomerFilterSelect from '../components/CustomerFilterSelect'

const initialForm = {
  projectNo: '',
  name: '',
  customerId: '',
  projectType: '',
  status: 'planning',
  startDate: '',
  endDate: '',
  managerId: '',
  description: '',
  stages: [{ name: '', startDate: '', endDate: '', status: 'pending', description: '' }] as ProjectStage[],
  risks: [{ title: '', description: '', level: 'low', status: 'open', mitigation: '' }] as ProjectRisk[],
}

const statusOptions = [
  { value: 'planning', label: '规划中' },
  { value: 'ongoing', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'paused', label: '已暂停' },
]

const riskOptions = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

const dealStageOptions = [
  { value: 'requirement_registered', label: '需求登记' },
  { value: 'requirement_analyzed', label: '需求识别' },
  { value: 'solution_drafting', label: '方案编制' },
  { value: 'quotation_drafting', label: '报价编制' },
  { value: 'quotation_reviewed', label: '报价定稿' },
  { value: 'submitted', label: '已发送客户' },
  { value: 'won', label: '已成交' },
  { value: 'lost', label: '已结束' },
]

const handleError = (error: any) => {
  toast.error(error?.response?.data?.message || error?.message || '操作失败')
}

export default function Projects() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const highlightId = searchParams.get('highlight') || ''
  // 从合同列表「转项目」跳来：预填来源合同，客户/项目名称/编号由合同自动带出，阶段落在已签约
  const fromContractId = searchParams.get('fromContractId') || ''
  /** 立项草稿里各日期的来源说明（合同签约日 / 合同交货期 …） */
  const [draftSources, setDraftSources] = useState<{ startDate?: string; endDate?: string } | null>(null)
  /** 列表 / 甘特图 */
  const [view, setView] = useState<'list' | 'gantt'>('list')
  const { focus, setFocus } = useFocus()
  const seedContract = (location.state as any)?.contract
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  // 按项目状态过滤（后端列表接口已支持 status 参数）
  const [statusFilter, setStatusFilter] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  /** 商机阶段筛选：需求登记 → … → 已成交/已结束 */
  const [dealFilter, setDealFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
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
  const [editing, setEditing] = useState<Project | null>(null)
  const [selected, setSelected] = useState<Project | null>(null)
  /*
   * 流程阶段单独走接口、不随表单保存，所以它的选中值也要单独存一份。
   * 直接绑 editing.dealStage 的话，editing 是打开弹窗那一刻的快照，
   * 提交成功后不会更新，下拉框就会弹回改之前的值 —— 看起来像没生效。
   */
  const [dealStage, setDealStage] = useState('requirement_registered')
  const { values: form, errors, isValid, setValue, setValues, validateAll, reset } = useFormValidation({
    initialValues: initialForm,
    rules: {
      // 项目编号由后端继承合同编号自动生成（PRJ-007 ← CON-007），不再手填
      name: required('请输入项目名称'),
    },
  })

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
  } = usePagedQuery<Project>({
    key: ['projects'],
    filters: { keyword: debouncedSearch || undefined, status: statusFilter || undefined, customerId: customerFilter || undefined, dealStage: dealFilter || undefined, focus: focus || undefined },
    fetcher: (params) => projectApi.list(params) as any,
    initialPageSize: 15,
  })

  useRegisterPageAssistant({
    key: 'projects',
    label: '项目跟踪',
    sourceTypes: ['project', 'customer', 'contract', 'requirement'],
    questions: [
      '本页项目分别处于什么阶段？',
      '哪些项目风险等级偏高、需要关注？',
      '按计划完成时间看，哪些项目可能延期？',
      '这些项目分别是哪些客户的？',
      '挑一个项目，说明当前该推进什么',
    ],
    context: [
      `页面：项目跟踪（共 ${pagination?.total ?? listData.length} 个，当前第 ${pagination?.page ?? 1} 页）`,
      search ? `搜索关键词：${search}` : '',
      statusFilter ? `状态筛选：${statusFilter}` : '',
      '当前页项目清单：',
      ...listData
        .slice(0, 40)
        .map(
          (x: Project, i: number) =>
            `${i + 1}. ${(x as any).projectNo || ''} ${x.name || ''}｜客户 ${(x as any).customer?.name || (x as any).customerName || '—'}｜阶段 ${(x as any).dealStage || '—'}｜风险 ${(x as any).riskLevel || '—'}｜状态 ${x.status || '—'}`,
        ),
    ]
      .filter(Boolean)
      .join('\n'),
  })

  const detailQuery = useQuery({
    queryKey: ['project', selected?.id],
    queryFn: () => (selected?.id ? projectApi.get(selected.id) : null),
    enabled: !!selected?.id,
  })



  useEffect(() => {
    if (!highlightId || !listData.length) return
    const highlighted = listData.find((item: Project) => item.id === highlightId)
    if (highlighted) {
      setSelected(highlighted)
      setDrawerOpen(true)
    }
  }, [highlightId, listData])

  // 带 ?fromContractId= 进来：自动打开新建弹窗并预填来源合同；客户/编号/阶段由后端从合同继承
  useEffect(() => {
    if (!fromContractId || modalOpen || editing) return
    setEditing(null)
    setOriginalProjectName('')
    setDealStage('contract_signed')
    const projName = seedContract?.projectName || seedContract?.title || ''
    setValues({
      projectNo: '',
      name: projName,
      customerId: seedContract?.customerId || '',
      projectType: '',
      status: 'planning',
      startDate: '',
      endDate: '',
      managerId: '',
      description: '',
      stages: [{ name: '', startDate: '', endDate: '', status: 'pending', description: '' }],
      risks: [{ title: '', description: '', level: 'low', status: 'open', mitigation: '' }],
    })
    setModalOpen(true)
     
    // 开工=签约日、完工=交货期、类型按需求类型、阶段按系统设置里的标准模板切好
    projectApi.draftFromContract(fromContractId).then((d: any) => {
      setValues((prev) => ({
        ...prev,
        name: prev.name || d.name || '',
        customerId: prev.customerId || d.customerId || '',
        projectType: prev.projectType || d.projectType || '',
        startDate: prev.startDate || d.startDate || '',
        endDate: prev.endDate || d.endDate || '',
        stages: d.stages?.length ? d.stages : prev.stages,
      }))
      setDraftSources(d.sources || null)
    }).catch(() => {})
  }, [fromContractId])


  // 客户 195 条、服务端每页只回 20 —— 必须走搜索，不能一次拉全量塞下拉


  const saveMutation = useMutation({
    mutationFn: (dto: any) => {
      if (editing) return projectApi.update(editing.id, dto)
      return projectApi.create(dto)
    },
    onSuccess: () => {
      // 项目名称是四个模块共用的一份，改完要让它们一起重新取数
      for (const k of ['projects', 'requirements', 'proposals', 'quotations']) {
        queryClient.invalidateQueries({ queryKey: [k] })
      }
      closeModal()
      refetch()
    },
    onError: handleError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => projectApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDeleteId(null)
      refetch()
    },
    onError: handleError,
  })

  const stageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) => projectApi.updateStage(id, stage),
    onError: (err) => {
      // 失败要退回原值，否则下拉框显示的和库里存的对不上
      setDealStage((editing as any)?.dealStage || 'requirement_registered')
      handleError(err)
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project', selected?.id] })
      toast.success('流程阶段已更新')
      // 知识飞轮：刚标记成交时引导把成交方案沉淀成标准模板，供后续匹配复用
      if (variables.stage === 'won' && (editing as any)?.dealStage !== 'won' && editing?.id) {
        toast.info('成交方案可沉淀为标准模板，供后续方案匹配复用', {
          action: { label: '去沉淀', onClick: () => navigate(`/solutions?fromProjectId=${editing.id}`) },
          duration: 8000,
        })
      }
    },
  })

  const openEdit = (row: Project) => {
    setEditing(row)
    setOriginalProjectName((row as any).projectName || row.name || '')
    setDealStage((row as any).dealStage || 'requirement_registered')
    setValues({
      projectNo: row.projectNo || '',
      name: (row as any).projectName || row.name || '',
      customerId: row.customerId || '',
      projectType: (row as any).projectType || '',
      status: row.status || 'planning',
      startDate: row.startDate ? row.startDate.slice(0, 10) : '',
      endDate: row.endDate ? row.endDate.slice(0, 10) : '',
      managerId: row.managerId || '',
      description: row.description || '',
      stages: row.stages?.length ? row.stages : [{ name: '', startDate: '', endDate: '', status: 'pending', description: '' }],
      risks: row.risks?.length ? row.risks : [{ title: '', description: '', level: 'low', status: 'open', mitigation: '' }],
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    reset()
  }

  const openDetail = (row: Project) => {
    setSelected(row)
    setDrawerOpen(true)
  }

  const addStage = () => {
    setValues((prev) => ({
      ...prev,
      stages: [...prev.stages, { name: '', startDate: '', endDate: '', status: 'pending', description: '' }],
    }))
  }

  const updateStage = (idx: number, field: keyof ProjectStage, value: string) => {
    setValues((prev) => {
      const stages = [...prev.stages]
      stages[idx] = { ...stages[idx], [field]: value }
      return { ...prev, stages }
    })
  }

  const removeStage = (idx: number) => {
    setValues((prev) => ({ ...prev, stages: prev.stages.filter((_, i) => i !== idx) }))
  }

  const addRisk = () => {
    setValues((prev) => ({
      ...prev,
      risks: [...prev.risks, { title: '', description: '', level: 'low', status: 'open', mitigation: '' }],
    }))
  }

  const updateRisk = (idx: number, field: keyof ProjectRisk, value: string) => {
    setValues((prev) => {
      const risks = [...prev.risks]
      risks[idx] = { ...risks[idx], [field]: value }
      return { ...prev, risks }
    })
  }

  const removeRisk = (idx: number) => {
    setValues((prev) => ({ ...prev, risks: prev.risks.filter((_, i) => i !== idx) }))
  }

  const handleSubmit = () => {
    if (!validateAll()) return
    const dto: any = { ...form }
    dto.stages = dto.stages.filter((s: any) => s.name?.trim())
    dto.risks = dto.risks.filter((r: any) => r.title?.trim())
    /*
     * 日期没填就别发空串：后端 @IsDateString 会把 '' 拦成 400
     * 「日期格式不正确」（不填日期新建项目直接失败）。
     * 新建不发；编辑发 null 表示清空 —— 与客户需求的处理一致。
     * 阶段里的起止日期同理。
     */
    const fixDate = (v: any) => (v ? v : editing ? null : undefined)
    dto.startDate = fixDate(dto.startDate)
    dto.endDate = fixDate(dto.endDate)
    for (const s of dto.stages || []) {
      s.startDate = fixDate(s.startDate)
      s.endDate = fixDate(s.endDate)
    }
    if (editing) {
      // 只在用户真改过时才写回共享的项目名称（projectName 仅 UpdateProjectDto 允许）
      if (form.name !== originalProjectName) dto.projectName = form.name
    } else {
      // 新建：CreateProjectDto 白名单不含 status/projectName，
      // 带上会被 forbidNonWhitelisted 拒绝（这也是原「新建项目」失败的原因）。
      delete dto.status
      delete dto.projectName
      // 从合同立项：带上 contractId，后端据此继承编号/客户并回填整条上游链
      if (fromContractId) dto.contractId = fromContractId
    }
    saveMutation.mutate(dto)
  }

  const setPageActions = usePageActions()
  useEffect(() => {
    setPageActions(
      <>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            placeholder="搜索编号/名称"
            onChange={(e) => setSearch(e.target.value)}
            className="eo-input !w-60 !pl-8 !py-1 !text-sm"
          />
        </div>
        {/* 状态筛选收到顶栏，与搜索同行展示 */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="eo-input !w-28 !py-1 !text-xs"
          aria-label="按状态筛选"
        >
          <option value="">全部状态</option>
          <option value="planning">规划中</option>
          <option value="ongoing">进行中</option>
          <option value="completed">已完成</option>
          <option value="paused">已暂停</option>
        </select>
        {/* 商机阶段：项目跟踪页特色维度，看单子卡在哪一步 */}
        <select
          value={dealFilter}
          onChange={(e) => setDealFilter(e.target.value)}
          className="eo-input !w-32 !py-1 !text-xs"
          aria-label="按商机阶段筛选"
        >
          <option value="">全部商机阶段</option>
          {dealStageOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <CustomerFilterSelect value={customerFilter} onChange={setCustomerFilter} />
        {statusFilter && (
          <button onClick={() => setStatusFilter('')} className="text-caption text-muted hover:text-ink transition-colors">
            清除
          </button>
        )}
        {/* 不再提供空白「新建」——项目统一由合同列表的「转项目」派生（立项以签约为前提） */}
        {/* 批量操作收到顶栏：选中后才出现，琥珀修改/红色删除一眼可见 */}
        <BatchEditBar
          selectedKeys={selectedKeys}
          onClear={() => setSelectedKeys([])}
          moduleName="项目"
          queryKey={['projects']}
          updateFn={(id, dto) => projectApi.update(id, dto)}
          deleteFn={(id) => projectApi.remove(id)}
          fields={[
            { key: 'status', label: '状态', options: [
              { value: 'pending', label: '待审核' }, { value: 'approved', label: '已审核' },
            ] },
            { key: 'dealStage', label: '流程阶段', options: [
              { value: 'requirement_registered', label: '需求登记' },
              { value: 'requirement_analyzed', label: '需求识别' },
              { value: 'solution_drafting', label: '方案编制' },
              { value: 'quotation_drafting', label: '报价编制' },
              { value: 'quotation_reviewed', label: '报价审核' },
              { value: 'submitted', label: '已提交客户' },
              { value: 'contract_signed', label: '已签合同' },
              { value: 'won', label: '已成交' },
              { value: 'lost', label: '已流失' },
            ] },
          ]}
        />
      </>
    )
    return () => setPageActions(null)
     
  }, [statusFilter, customerFilter, dealFilter, selectedKeys])

  const { stats, isLoading: statsLoading } = useModuleStats()
  const pj = stats?.projects
  const projectCards = [
    { label: '项目总数', value: pj?.total ?? 0, icon: FolderKanban, onClick: () => setFocus(''), active: !focus },
    { label: '预警/关注', value: (pj as any)?.atRisk ?? pj?.highRisk ?? 0, icon: AlertTriangle, alert: true, title: '逾期、阶段逾期、高风险或临近完工进度不足（每日自动重算）', onClick: () => setFocus('risk'), active: focus === 'risk' },
    { label: '规划中', value: pj?.planning ?? 0, icon: Compass },
    { label: '进行中', value: pj?.ongoing ?? 0, icon: Activity },
    { label: '已完成', value: pj?.completed ?? 0, icon: CheckCircle2 },
    { label: '已暂停', value: pj?.paused ?? 0, icon: PauseCircle },
  ]
  // 甘特图要看全部项目（不受分页限制），按当前筛选取最多 200 个
  const ganttQuery = useQuery({
    queryKey: ['projects-gantt', statusFilter, customerFilter, dealFilter, focus],
    queryFn: () => projectApi.list({ pageSize: 200, status: statusFilter || undefined, customerId: customerFilter || undefined, dealStage: dealFilter || undefined, focus: focus || undefined }),
    enabled: view === 'gantt',
  })
  const ganttRows = ((ganttQuery.data as any)?.list ?? (Array.isArray(ganttQuery.data) ? ganttQuery.data : [])).map((p: any) => ({
    id: p.id,
    label: p.projectName || p.name,
    sub: p.customerShortName,
    start: p.startDate ? String(p.startDate).slice(0, 10) : null,
    end: (p.endDate || p.deliveryDate) ? String(p.endDate || p.deliveryDate).slice(0, 10) : null,
    progress: p.progress,
    health: p.health,
  }))

  return (
    <div>
      <PageHeader title="项目" titleEm="管理" />

      {/* 统计卡片：与业务概览顶部同一套组件，各模块高度与配色一致 */}
      <StatCards className="mb-4" loading={statsLoading} skeletonCount={6} items={projectCards} />
      <FocusBar focus={focus} labels={{ risk: '预警/关注的项目（每天自动按计划完工日、阶段、风险重算）' }} onClear={() => setFocus('')} count={pagination?.total} />
      <div className="flex justify-end mb-2">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
          <button type="button" onClick={() => setView('list')} className={`px-2.5 py-1 flex items-center gap-1 ${view === 'list' ? 'bg-accent-50 text-accent-700' : 'text-muted hover:text-ink'}`}>
            <List size={13} /> 列表
          </button>
          <button type="button" onClick={() => setView('gantt')} className={`px-2.5 py-1 flex items-center gap-1 border-l border-border ${view === 'gantt' ? 'bg-accent-50 text-accent-700' : 'text-muted hover:text-ink'}`}>
            <GanttChart size={13} /> 交期甘特
          </button>
        </div>
      </div>
      {view === 'gantt' && (
        <div className="eo-card p-4 mb-4">
          {ganttQuery.isLoading ? <PageLoader /> : <ProjectGantt rows={ganttRows} onPick={(id) => navigate(`/projects?highlight=${id}`)} />}
        </div>
      )}

      {isLoading && !listData.length && <PageLoader />}
      {isError && <ErrorState message={error?.message || '加载失败'} onRetry={refetch} />}
      {!isLoading && !isError && (
        <DataTable
          loading={isLoading}
          data={listData}
          columns={[
            { key: 'projectNo', title: '项目编号', sortable: true },
            {
              key: 'customerShortName',
              title: '客户',
              render: (row: any) => row.customerShortName || <span className="text-warning-fg text-xs">未关联</span>,
            },
            {
              key: 'name',
              title: '项目名称',
              render: (row: any) => row.projectName || row.name || '-',
            },
            { key: 'projectType', title: '类型', render: (row: any) => row.projectType || '—' },
            {
              key: 'progress',
              title: '进度',
              sortable: true,
              render: (row: any) => (
                <div className="flex items-center gap-1.5">
                  <div className="w-16 h-1.5 bg-canvas rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${row.progress >= 100 ? 'bg-success-fg' : row.progress > 0 ? 'bg-accent-500' : 'bg-border'}`}
                      style={{ width: `${row.progress || 0}%` }}
                    />
                  </div>
                  <span className="text-caption text-muted">{row.progress || 0}%</span>
                </div>
              ),
            },
            {
              key: 'health',
              title: '健康度',
              render: (row: any) => {
                // 空值不再当「健康」显示：每日重算前的新项目显示「待评估」
                const h = row.health || ''
                const colors: Record<string, string> = { green: 'bg-success-bg text-success-fg', yellow: 'bg-warning-bg text-warning-fg', red: 'bg-danger-bg text-danger-fg', '': 'bg-neutral-bg text-neutral-fg' }
                const labels: Record<string, string> = { green: '健康', yellow: '关注', red: '预警', '': '待评估' }
                const end = row.endDate ? String(row.endDate).slice(0, 10) : ''
                const overdue = end && end < new Date().toISOString().slice(0, 10) && Number(row.progress || 0) < 100
                return (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${colors[h] || colors['']}`} title={overdue ? `计划完工 ${end} 已过` : undefined}>
                    {labels[h] ?? '待评估'}{overdue ? ' · 逾期' : ''}
                  </span>
                )
              },
            },
            { key: 'status', title: '状态', sortable: true, render: (row) => <StatusBadge kind="project" status={row.status} /> },
            {
              key: 'deliveryDate',
              title: '交货期',
              // 从来源合同实时同步（合同→报价→项目），单一数据源不漂移；
              // 临期 30 天琥珀、已过红色（未完成项目才提醒）
              render: (row: any) => {
                if (!row.deliveryDate) return <span className="text-muted">—</span>
                const d = String(row.deliveryDate).slice(0, 10)
                const today = new Date().toISOString().slice(0, 10)
                const in30 = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)
                const open = row.status !== 'completed'
                const cls = open && d < today ? 'text-danger-fg font-medium' : open && d <= in30 ? 'text-warning-fg' : ''
                return (
                  <span className={cls} title={open && d < today ? '交货期已过' : open && d <= in30 ? '交货期 30 天内' : ''} >
                    {d}
                  </span>
                )
              },
            },
            {
              key: 'startDate',
              title: '周期',
              render: (row) =>
                row.startDate || row.endDate
                  ? `${row.startDate?.slice(0, 10) || '—'} ~ ${row.endDate?.slice(0, 10) || '—'}`
                  : '-',
            },
          ]}
          rowKey={(row) => row.id}
          onRowDoubleClick={(row) => openDetail(row)}
          pagination={pagination}
          widthStorageKey="projects"
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
              <button onClick={() => openEdit(row)} className="text-ink-soft hover:text-ink" title={"编辑"}
              aria-label="编辑">
                <Pencil size={16} />
              </button>
              {/* 业务链闭环：项目 → 售后工单（预填项目/客户，工单可再转备件需求回流） */}
              <button
                onClick={() => navigate(`/after-sales?fromProjectId=${row.id}`, { state: { project: row } })}
                className="text-ink-soft hover:text-ink"
                aria-label="转售后工单"
                title="转售后工单"
              >
                <Headset size={16} />
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
        title={editing ? '编辑项目' : '新建项目'}
        onConfirm={handleSubmit}
        loading={saveMutation.isPending}
        confirmDisabled={!isValid}
        size="xl"
      >
        <div className="space-y-6">
          <SharedFieldNotice origin="project" id={editing?.id} />

          <FormSection title="基本信息" icon={FolderKanban}>
            <FieldGrid>
              <FormInput label="项目编码" value={editing?.projectNo || ''} readOnly placeholder="保存后自动生成（继承合同编号）" />
              <FormInput
                label="项目名称"
                value={form.name}
                onChange={(e) => setValue('name', e.target.value)}
                error={errors.name}
                required
                helper="与关联需求共用一份，在这里改会同步到需求及其下的方案、报价"
              />
              {/* 客户顺着关联需求带出，只读 */}
              <FormInput
                label="客户名称"
                value={editing ? ((editing as any).customerShortName || (editing as any).customerName || '') : ''}
                readOnly
                placeholder="由关联需求带出"
                helper="客户取自关联需求，如需变更请到客户需求页修改"
              />
              <FormSelect label="状态" options={statusOptions} value={form.status} onChange={(e) => setValue('status', e.target.value)} />
              <FormSelect label="项目类型" options={PROJECT_TYPE_OPTIONS} value={form.projectType || ''} onChange={(e) => setValue('projectType', e.target.value)} />
              {/*
                流程阶段单独走 PATCH /projects/:id/stage —— 那个接口会额外写一条
                时间线事件，塞进普通表单一起保存就会绕过它，项目就失去了阶段变更记录。
                所以这里选完立即提交，不等整个表单保存。
              */}
              <div>
                <label className="block eo-label mb-1.5">流程阶段</label>
                <select
                  value={dealStage}
                  disabled={!editing || stageMutation.isPending}
                  onChange={(e) => {
                    const next = e.target.value
                    setDealStage(next)
                    if (editing) stageMutation.mutate({ id: editing.id, stage: next })
                  }}
                  className="eo-input"
                >
                  {dealStageOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted">
                  {editing ? '选择后立即生效，并记入项目时间线' : '项目创建后可调整'}
                </p>
              </div>
            </FieldGrid>
          </FormSection>

          <FormSection title="计划与说明">
            <FieldGrid>
              <FormInput label="开始日期" type="date" value={form.startDate} onChange={(e) => setValue('startDate', e.target.value)} helper={!editing && draftSources?.startDate ? `取自${draftSources.startDate}` : undefined} />
              <FormInput label="结束日期" type="date" value={form.endDate} onChange={(e) => setValue('endDate', e.target.value)} helper={!editing && draftSources?.endDate ? `取自${draftSources.endDate}` : undefined} />
              <div className="md:col-span-2">
                <FormTextarea label="描述" value={form.description} onChange={(e) => setValue('description', e.target.value)} rows={3} />
              </div>
            </FieldGrid>
          </FormSection>

          <FormSection
            title="项目阶段"
            action={
              <Button type="button" variant="secondary" onClick={addStage} className="py-1 px-2 text-xs">
                <PlusCircle size={14} className="mr-1" /> 添加阶段
              </Button>
            }
          >
            <div className="space-y-2">
              {form.stages.map((stage, idx) => (
                /* 12 栅格刚好排满：名称3 + 说明2 + 起2 + 止2 + 状态2 + 删除1 */
                <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-subtle p-2 rounded-md">
                  <input
                    placeholder="阶段名称"
                    value={stage.name}
                    onChange={(e) => updateStage(idx, 'name', e.target.value)}
                    className="col-span-3 px-2 py-1.5 border border-border rounded text-sm"
                  />
                  <input
                    placeholder="说明"
                    value={stage.description}
                    onChange={(e) => updateStage(idx, 'description', e.target.value)}
                    className="col-span-2 px-2 py-1.5 border border-border rounded text-sm"
                  />
                  <input
                    type="date"
                    value={stage.startDate}
                    onChange={(e) => updateStage(idx, 'startDate', e.target.value)}
                    className="col-span-2 px-2 py-1.5 border border-border rounded text-sm"
                  />
                  <input
                    type="date"
                    value={stage.endDate}
                    onChange={(e) => updateStage(idx, 'endDate', e.target.value)}
                    className="col-span-2 px-2 py-1.5 border border-border rounded text-sm"
                  />
                  <select
                    value={stage.status}
                    onChange={(e) => updateStage(idx, 'status', e.target.value)}
                    className="col-span-2 px-2 py-1.5 pr-7 border border-border rounded text-sm bg-surface"
                  >
                    <option value="pending">未开始</option>
                    <option value="ongoing">进行中</option>
                    <option value="done">已完成</option>
                  </select>
                  <button onClick={() => removeStage(idx)} className="col-span-1 text-danger-fg" title={"删除阶段"}
                  aria-label="删除阶段">
                    <MinusCircle size={18} />
                  </button>
                </div>
              ))}
            </div>
          </FormSection>

          <FormSection
            title="风险项"
            action={
              <Button type="button" variant="secondary" onClick={addRisk} className="py-1 px-2 text-xs">
                <PlusCircle size={14} className="mr-1" /> 添加风险
              </Button>
            }
          >
            <div className="space-y-2">
              {form.risks.map((risk, idx) => (
                /* 12 栅格：标题3 + 描述3 + 应对3 + 等级2 + 删除1 */
                <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-subtle p-2 rounded-md">
                  <input
                    placeholder="风险标题"
                    value={risk.title}
                    onChange={(e) => updateRisk(idx, 'title', e.target.value)}
                    className="col-span-3 px-2 py-1.5 border border-border rounded text-sm"
                  />
                  <input
                    placeholder="描述"
                    value={risk.description}
                    onChange={(e) => updateRisk(idx, 'description', e.target.value)}
                    className="col-span-3 px-2 py-1.5 border border-border rounded text-sm"
                  />
                  <input
                    placeholder="应对措施"
                    value={risk.mitigation}
                    onChange={(e) => updateRisk(idx, 'mitigation', e.target.value)}
                    className="col-span-3 px-2 py-1.5 border border-border rounded text-sm"
                  />
                  <select
                    value={risk.level}
                    onChange={(e) => updateRisk(idx, 'level', e.target.value)}
                    className="col-span-2 px-2 py-1.5 pr-7 border border-border rounded text-sm bg-surface"
                  >
                    {riskOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <button onClick={() => removeRisk(idx)} className="col-span-1 text-danger-fg" title={"删除风险"}
                  aria-label="删除风险">
                    <MinusCircle size={18} />
                  </button>
                </div>
              ))}
            </div>
          </FormSection>

          <FormSection title="项目资料" hint="按当前流程阶段自动归类，标记为输入/输出文件，同步进客户资料">
            <EntityFileUpload
              entityType="project"
              entityId={editing?.id}
              entityNo={editing?.projectNo}
              customerId={editing?.customerId || undefined}
              category="项目资料"
              stage={(editing as any)?.dealStage || 'requirement_registered'}
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
        size="sm"
      >
        <p className="text-sm text-ink-soft">确定要删除该项目吗？</p>
        <DeleteImpact type="project" id={deleteId} />
      </Modal>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="项目详情" width="w-[560px]">
        {detailQuery.isLoading ? (
          <PageLoader />
        ) : detailQuery.isError ? (
          <ErrorState message={detailQuery.error?.message || '加载失败'} onRetry={() => detailQuery.refetch()} />
        ) : (
          <>
          <div className="space-y-6">
            {/* 同一业务线上的其它单据，点编号直接跳过去 */}
            <RelatedChain origin="project" id={selected?.id} currentId={selected?.id} />

            <DetailHeader
              title={(selected as any)?.projectName || detailQuery.data?.name}
              code={detailQuery.data?.projectNo}
              badge={<StatusBadge kind="project" status={detailQuery.data?.status} />}
              stats={[
                { label: '客户', value: (selected as any)?.customerShortName },
                {
                  label: '流程阶段',
                  value:
                    dealStageOptions.find((o) => o.value === detailQuery.data?.dealStage)?.label ||
                    '需求登记',
                },
              ]}
            />

            {selected?.id && <Link to={`/projects/${selected.id}/report`} className="inline-block text-sm text-accent-600">查看结项报告 →</Link>}

            <DetailSection title="基本信息">
              <DescList
                items={[
                  {
                    // 详情页只读展示；要改阶段请走编辑弹窗，
                    // 那条路径会记入项目时间线，在这里直接改会绕过留痕的初衷
                    label: '流程阶段',
                    value:
                      dealStageOptions.find((o) => o.value === detailQuery.data?.dealStage)?.label ||
                      '需求登记',
                  },
                  {
                    label: '周期',
                    value:
                      detailQuery.data?.startDate || detailQuery.data?.endDate
                        ? `${detailQuery.data?.startDate?.slice(0, 10) || '—'} ~ ${detailQuery.data?.endDate?.slice(0, 10) || '—'}`
                        : null,
                  },
                  { label: '负责人', value: detailQuery.data?.managerId },
                  { label: '描述', value: detailQuery.data?.description, full: true },
                ]}
              />
            </DetailSection>
            <div>
              <h4 className="text-sm font-semibold text-ink mb-2">阶段</h4>
              {(detailQuery.data?.stages || []).length === 0 ? (
                <p className="text-sm text-muted">暂无阶段</p>
              ) : (
                <div className="bg-subtle rounded-md p-4 text-sm space-y-2">
                  {(detailQuery.data?.stages || []).map((p, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span>{p.name}</span>
                      <span className="text-muted">{p.startDate?.slice(0, 10)} ~ {p.endDate?.slice(0, 10)} · {statusOptions.find((o) => o.value === p.status)?.label || p.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h4 className="text-sm font-semibold text-ink mb-2">风险</h4>
              {(detailQuery.data?.risks || []).length === 0 ? (
                <p className="text-sm text-muted">暂无风险</p>
              ) : (
                <div className="bg-subtle rounded-md p-4 text-sm space-y-2">
                  {(detailQuery.data?.risks || []).map((r, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span>{r.title}</span>
                      <span className={`${r.level === 'high' ? 'text-danger-fg' : r.level === 'medium' ? 'text-warning-fg' : 'text-success-fg'}`}>
                        {riskOptions.find((o) => o.value === r.level)?.label || r.level}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 成员管理：谁能参与、什么角色 */}
          <ProjectMembersSection projectId={selected?.id} />

          {/* 任务管理 */}
          <ProjectTasksSection projectId={selected?.id} />
          </>
        )}
      </Drawer>
    </div>
  )
}

/** 项目任务管理子组件 */
function ProjectTasksSection({ projectId }: { projectId?: string }) {
  const queryClient = useQueryClient()
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['project-tasks', projectId],
    queryFn: () => (projectId ? projectApi.getTasks(projectId) : []),
    enabled: !!projectId,
  })
  // 负责人从账号里选（服务端校验 + 可通知）；无权限拉用户列表时退回文本输入
  const { data: users = [] } = useQuery({
    queryKey: ['users-for-assign'],
    queryFn: () => userApi.list(),
    retry: false,
    staleTime: 5 * 60_000,
  })
  const [adding, setAdding] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', assignedUserId: '', priority: 'medium', status: 'pending', progress: 0 })
  // 待确认删除的任务：删除图标就在进度条旁边，点错一次任务连同进度一起没了
  const [deletingTask, setDeletingTask] = useState<any | null>(null)

  const addMutation = useMutation({
    mutationFn: () => projectApi.createTask(projectId!, {
      ...newTask,
      assignedUserId: newTask.assignedUserId || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-tasks', projectId] })
      setAdding(false)
      setNewTask({ title: '', assignedUserId: '', priority: 'medium', status: 'pending', progress: 0 })
    },
  })
  const updateMutation = useMutation({
    mutationFn: ({ taskId, dto }: { taskId: string; dto: any }) => projectApi.updateTask(projectId!, taskId, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-tasks', projectId] }),
  })
  const removeMutation = useMutation({
    mutationFn: (taskId: string) => projectApi.removeTask(projectId!, taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-tasks', projectId] })
      setDeletingTask(null)
    },
  })

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-ink">任务 ({tasks.length})</h4>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-xs text-accent-600 hover:text-accent-700 flex items-center gap-0.5">
            <PlusCircle size={12} /> 添加任务
          </button>
        )}
      </div>
      {isLoading ? <p className="text-sm text-muted">加载中…</p> : (
        <div className="space-y-1.5">
          {adding && (
            <div className="bg-canvas p-2.5 rounded-md space-y-1.5">
              <input placeholder="任务名称" value={newTask.title} onChange={(e) => setNewTask(p => ({ ...p, title: e.target.value }))} className="eo-input !py-1 !text-sm" />
              <div className="flex gap-1.5">
                {users.length > 0 ? (
                  <select value={newTask.assignedUserId} onChange={(e) => setNewTask(p => ({ ...p, assignedUserId: e.target.value }))} className="eo-input flex-1 !py-1 !text-sm">
                    <option value="">未指派负责人</option>
                    {users.map((u: any) => <option key={u.id} value={u.id}>{u.nickname || u.username}</option>)}
                  </select>
                ) : (
                  <input placeholder="负责人（文本）" value={newTask.assignedUserId} onChange={(e) => setNewTask(p => ({ ...p, assignedUserId: e.target.value }))} className="eo-input flex-1 !py-1 !text-sm" />
                )}
                <select value={newTask.priority} onChange={(e) => setNewTask(p => ({ ...p, priority: e.target.value }))} className="eo-input !py-1 !text-sm w-20">
                  {TASK_PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <button onClick={() => addMutation.mutate()} disabled={!newTask.title.trim()} className="px-2 py-1 text-xs bg-accent-500 text-white rounded disabled:opacity-40">添加</button>
                <button onClick={() => setAdding(false)} className="px-2 py-1 text-xs text-muted">取消</button>
              </div>
            </div>
          )}
          {tasks.length === 0 && !adding && <p className="text-sm text-muted">暂无任务</p>}
          {tasks.map((t: any) => (
            <div key={t.id} className="flex items-center gap-2 bg-subtle p-2 rounded-md">
              <select
                value={t.status}
                onChange={(e) => updateMutation.mutate({ taskId: t.id, dto: { status: e.target.value } })}
                className="text-caption border border-border rounded px-1 py-0.5 bg-surface shrink-0"
              >
                {TASK_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span className={`text-sm flex-1 truncate ${t.status === 'done' ? 'line-through text-muted' : 'text-ink'}`}>{t.title}</span>
              {users.length > 0 ? (
                // 行内改派：选中的账号会触发服务端校验与站内通知
                <select
                  value={t.assignedUserId || ''}
                  onChange={(e) => updateMutation.mutate({ taskId: t.id, dto: { assignedUserId: e.target.value || null } })}
                  className="text-caption border border-border rounded px-1 py-0.5 bg-surface shrink-0 max-w-24"
                  title="改派负责人"
                >
                  <option value="">未指派</option>
                  {users.map((u: any) => <option key={u.id} value={u.id}>{u.nickname || u.username}</option>)}
                </select>
              ) : (t.assignedTo && <span className="text-caption text-muted shrink-0">{t.assignedTo}</span>)}
              <div className="flex items-center gap-1 shrink-0">
                <div className="w-12 h-1 bg-canvas rounded-full overflow-hidden">
                  <div className="h-full bg-accent-500 rounded-full" style={{ width: `${t.progress || 0}%` }} />
                </div>
                <span className="text-caption text-muted w-7">{t.progress || 0}%</span>
              </div>
              <button onClick={() => setDeletingTask(t)} title="删除任务" className="text-muted hover:text-danger-fg shrink-0">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deletingTask}
        onClose={() => setDeletingTask(null)}
        onConfirm={() => deletingTask && removeMutation.mutate(deletingTask.id)}
        loading={removeMutation.isPending}
        title="确认删除任务"
        message={<>确定删除任务「{deletingTask?.title}」吗？</>}
        detail="删除后无法恢复，该任务的负责人与进度记录一并清除。"
      />
    </div>
  )
}

/** 项目成员管理：谁能参与、什么角色（manager/member/viewer） */
const MEMBER_ROLE_OPTIONS = [
  { value: 'manager', label: '管理' },
  { value: 'member', label: '成员' },
  { value: 'viewer', label: '只读' },
]

function ProjectMembersSection({ projectId }: { projectId?: string }) {
  const queryClient = useQueryClient()
  const { data: members = [] } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => (projectId ? projectApi.getMembers(projectId) : []),
    enabled: !!projectId,
  })
  const { data: users = [] } = useQuery({
    queryKey: ['users-for-assign'],
    queryFn: () => userApi.list(),
    retry: false,
    staleTime: 5 * 60_000,
  })
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ userId: '', role: 'member' })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
  const addMutation = useMutation({
    mutationFn: () => projectApi.addMember(projectId!, draft),
    onSuccess: () => { invalidate(); setAdding(false); setDraft({ userId: '', role: 'member' }) },
  })
  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      projectApi.updateMemberRole(projectId!, userId, role),
    onSuccess: invalidate,
  })
  const removeMutation = useMutation({
    mutationFn: (userId: string) => projectApi.removeMember(projectId!, userId),
    onSuccess: invalidate,
  })

  // 拉不到用户列表（如团队模式普通成员无用户管理权限）时隐藏整个区块——
  // 成员管理本就是项目经理/管理员的事，不给他们一个空下拉
  if (users.length === 0) return null

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-ink">项目成员 ({members.length})</h4>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-xs text-accent-600 hover:text-accent-700 flex items-center gap-0.5">
            <PlusCircle size={12} /> 添加成员
          </button>
        )}
      </div>
      {adding && (
        <div className="bg-canvas p-2.5 rounded-md flex gap-1.5 mb-2">
          <select value={draft.userId} onChange={(e) => setDraft(p => ({ ...p, userId: e.target.value }))} className="eo-input flex-1 !py-1 !text-sm">
            <option value="">选择账号</option>
            {users
              .filter((u: any) => !members.some((m: any) => m.userId === u.id))
              .map((u: any) => <option key={u.id} value={u.id}>{u.nickname || u.username}</option>)}
          </select>
          <select value={draft.role} onChange={(e) => setDraft(p => ({ ...p, role: e.target.value }))} className="eo-input !py-1 !text-sm w-20">
            {MEMBER_ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={() => addMutation.mutate()} disabled={!draft.userId} className="px-2 py-1 text-xs bg-accent-500 text-white rounded disabled:opacity-40">添加</button>
          <button onClick={() => setAdding(false)} className="px-2 py-1 text-xs text-muted">取消</button>
        </div>
      )}
      {members.length === 0 && !adding ? (
        <p className="text-caption text-muted">尚未指定成员——添加后，成员无需项目可见权限即可参与该项目并编辑任务。</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {members.map((m: any) => (
            <span key={m.id} className="inline-flex items-center gap-1 bg-subtle rounded-full pl-2 pr-1 py-0.5 text-caption">
              <span className="text-ink">{m.nickname}</span>
              <select
                value={m.role}
                onChange={(e) => roleMutation.mutate({ userId: m.userId, role: e.target.value })}
                className="border-none bg-transparent text-caption text-muted cursor-pointer p-0"
                title="调整成员角色"
              >
                {MEMBER_ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button onClick={() => removeMutation.mutate(m.userId)} title="移出项目" className="text-muted hover:text-danger-fg">
                <Trash2 size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
