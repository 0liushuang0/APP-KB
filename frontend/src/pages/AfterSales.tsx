import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Eye, Pencil, Trash2, Headset, Wrench, RefreshCw, BookPlus, Star, Activity, CheckCircle2, Timer, ShieldAlert } from 'lucide-react'
import { afterSalesApi, customerApi } from '../api/services'
import { toList } from '../utils/apiList'
import { usePageActions } from '../contexts/PageActionsContext'
import { usePagedQuery } from '../hooks/usePagedQuery'
import { useDebounce } from '../hooks/useDebounce'
import { useFormValidation, required } from '../hooks/useFormValidation'
import Button from '../components/Button'
import Modal from '../components/Modal'
import Drawer from '../components/Drawer'
import DataTable from '../components/DataTable'
import BatchEditBar from '../components/BatchEditBar'
import StatusBadge from '../components/StatusBadge'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import { FormSection, FieldGrid, DetailHeader, DetailSection, DescList } from '../components/layout-kit'
import EntityFileUpload from '../components/EntityFileUpload'
import EntityPicker from '../components/EntityPicker'
import StatCards from '../components/StatCards'
import FormInput from '../components/FormInput'
import FormTextarea from '../components/FormTextarea'
import FormSelect from '../components/FormSelect'
import type { AfterSalesTicket } from '../types'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'

const TYPE_LABELS: Record<string, string> = {
  fault: '故障报修', maintenance: '定期保养', spare_part: '备件需求', visit: '客户回访',
}
const PRIORITY_OPTIONS = [
  { value: 'urgent', label: '紧急' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

export default function AfterSales() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  // 从项目列表「转售后工单」跳来：预填来源项目与客户
  const fromProjectId = searchParams.get('fromProjectId') || ''
  // 从客户 360 等入口带 ?highlight= 跳来：直接打开对应工单详情
  const highlightId = searchParams.get('highlight') || ''
  const seedProject = (location.state as any)?.project
  const queryClient = useQueryClient()
  const setPageActions = usePageActions()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [statusFilter, setStatusFilter] = useState<string>('')

  const [modalOpen, setModalOpen] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [editing, setEditing] = useState<AfterSalesTicket | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState<AfterSalesTicket | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { list, isLoading, isError, error, refetch, onSort, sortBy, sortOrder, pagination } = usePagedQuery<AfterSalesTicket>({
    key: ['after-sales', statusFilter],
    filters: { keyword: debouncedSearch || undefined, status: statusFilter || undefined },
    fetcher: (params) => afterSalesApi.list(params) as any,
  })

  const statsQuery = useQuery({ queryKey: ['after-sales-stats'], queryFn: () => afterSalesApi.stats() })

  useRegisterPageAssistant({
    key: 'after-sales',
    label: '售后管理',
    sourceTypes: ['ticket', 'customer', 'product', 'contract'],
    questions: [
      '本页工单里哪些还没处理完？',
      '这些工单集中在哪些产品型号上？',
      '有没有反复出现的同类故障？',
      '按优先级看，哪几单该先处理？',
      '挑一单，说明处理方案是什么',
    ],
    context: [
      `页面：售后管理（当前页 ${list.length} 单）`,
      search ? `搜索关键词：${search}` : '',
      statusFilter ? `状态筛选：${statusFilter}` : '',
      '当前页工单清单：',
      ...list
        .slice(0, 40)
        .map(
          (x: AfterSalesTicket, i: number) =>
            `${i + 1}. ${(x as any).ticketNo || ''} ${x.title || ''}｜客户 ${(x as any).customer?.name || (x as any).customerName || '—'}｜型号 ${(x as any).productModel || '—'}｜类型 ${(x as any).type || '—'}｜优先级 ${(x as any).priority || '—'}｜状态 ${x.status || '—'}`,
        ),
    ]
      .filter(Boolean)
      .join('\n'),
  })

  const detailQuery = useQuery({
    queryKey: ['after-sales', selected?.id],
    queryFn: () => (selected?.id ? afterSalesApi.get(selected.id) : null),
    enabled: !!selected?.id,
  })

  useEffect(() => {
    setPageActions(
      <>
        {/* 非受控：受控 value 在 IME 组字时会被回写、打断拼音输入（出现"zhhicheeng"式乱码）。
            搜索只靠 onChange 写状态，输入框自管 DOM 值即可，与其它页面一致。 */}
        <input
          placeholder="搜索工单编号/标题/型号"
          onChange={(e) => setSearch(e.target.value)}
          className="eo-input !w-60 !py-1.5 !text-sm"
        />
        <Button onClick={openCreate} size="sm" className="!py-1.5 !text-sm">
          <Plus size={14} className="mr-1" /> 新建工单
        </Button>
        {/* 批量操作收到顶栏：选中后才出现，琥珀修改/红色删除一眼可见 */}
        <BatchEditBar
          selectedKeys={selectedKeys}
          onClear={() => setSelectedKeys([])}
          moduleName="工单"
          queryKey={['after-sales']}
          updateFn={(id, dto) => afterSalesApi.update(id, dto)}
          deleteFn={(id) => afterSalesApi.remove(id)}
          fields={[
            { key: 'type', label: '工单类型', options: Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })) },
            { key: 'priority', label: '优先级', options: PRIORITY_OPTIONS },
            { key: 'status', label: '状态', options: [
              { value: 'open', label: '待处理' }, { value: 'assigned', label: '已派单' },
              { value: 'in_progress', label: '处理中' }, { value: 'resolved', label: '已解决' },
              { value: 'closed', label: '已关闭' },
            ] },
          ]}
        />
      </>
    )
    return () => setPageActions(null)
     
  }, [selectedKeys])

  const { values: form, errors, isValid, setValue, setValues, validateAll, reset } = useFormValidation({
    initialValues: {
      title: '', type: 'fault', priority: 'medium', customerId: '', contractId: '', projectId: '',
      productModel: '', description: '', assignedTo: '',
      resolution: '', spareParts: '', status: '',
      satisfactionScore: '', visitDate: '', visitNotes: '',
    },
    rules: { title: required('请输入工单标题') },
  })

  // 带 ?fromProjectId= 进来：自动打开新建弹窗并预填项目/客户，打通「项目 → 售后」链路
  useEffect(() => {
    if (!fromProjectId || modalOpen || editing) return
    setEditing(null)
    setValues({
      title: seedProject?.name ? `【${seedProject.name}】售后工单` : '',
      type: 'fault', priority: 'medium',
      customerId: seedProject?.customerId || '', contractId: seedProject?.contractId || '',
      projectId: fromProjectId,
      productModel: '', description: '', assignedTo: '',
      resolution: '', spareParts: '', status: '',
      satisfactionScore: '', visitDate: '', visitNotes: '',
    })
    setModalOpen(true)
     
  }, [fromProjectId])

  useEffect(() => {
    if (!highlightId || !list.length) return
    const highlighted = list.find((item: AfterSalesTicket) => item.id === highlightId)
    if (highlighted) {
      setSelected(highlighted)
      setDrawerOpen(true)
    }
  }, [highlightId, list])

  function openCreate() { setEditing(null); reset(); setModalOpen(true) }

  // 客户 195 条、服务端每页只回 20 —— 必须走搜索，不能让用户手填 32 位 ID
  const searchCustomers = async (keyword: string) => {
    const res = await customerApi.list({ keyword: keyword || undefined, pageSize: 50 })
    return toList<any>(res).map((c: any) => ({
      value: c.id,
      label: c.name,
      hint: [c.industry, c.region].filter(Boolean).join(' · ') || undefined,
    }))
  }

  const resolveCustomer = async (id: string) => {
    const c = await customerApi.get(id)
    return c ? { value: c.id, label: c.name } : null
  }

  function openEdit(row: AfterSalesTicket) {
    setEditing(row)
    setValues({
      title: row.title || '', type: row.type || 'fault', priority: row.priority || 'medium',
      customerId: row.customerId || '', contractId: row.contractId || '', projectId: (row as any).projectId || '',
      productModel: row.productModel || '', description: row.description || '',
      assignedTo: row.assignedTo || '', resolution: row.resolution || '', spareParts: row.spareParts || '',
      status: row.status || '', satisfactionScore: row.satisfactionScore ? String(row.satisfactionScore) : '',
      visitDate: row.visitDate ? row.visitDate.slice(0, 10) : '', visitNotes: row.visitNotes || '',
    })
    setModalOpen(true)
  }

  function openDetail(row: AfterSalesTicket) { setSelected(row); setDrawerOpen(true) }

  const saveMutation = useMutation({
    mutationFn: () => {
      const dto: any = {
        title: form.title, type: form.type, priority: form.priority,
        customerId: form.customerId || undefined, contractId: form.contractId || undefined,
        projectId: form.projectId || undefined,
        productModel: form.productModel || undefined, description: form.description || undefined,
        assignedTo: form.assignedTo || undefined, resolution: form.resolution || undefined,
        spareParts: form.spareParts || undefined,
        status: form.status || undefined,
        satisfactionScore: form.satisfactionScore ? Number(form.satisfactionScore) : undefined,
        visitDate: form.visitDate || undefined, visitNotes: form.visitNotes || undefined,
      }
      return editing ? afterSalesApi.update(editing.id, dto) : afterSalesApi.create(dto)
    },
    onSuccess: () => {
      toast.success(editing ? '工单已更新' : '工单已创建')
      queryClient.invalidateQueries({ queryKey: ['after-sales'] })
      queryClient.invalidateQueries({ queryKey: ['after-sales-stats'] })
      setModalOpen(false); refetch()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '操作失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => afterSalesApi.remove(id),
    onSuccess: () => {
      toast.success('已删除')
      queryClient.invalidateQueries({ queryKey: ['after-sales'] })
      setDeleteId(null)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '删除失败'),
  })

  const convertReqMutation = useMutation({
    mutationFn: (id: string) => afterSalesApi.convertToReq(id),
    onSuccess: (data) => {
      toast.success(`已转为需求：${data.requirementNo}`)
      queryClient.invalidateQueries({ queryKey: ['after-sales'] })
      setDrawerOpen(false)
      navigate(`/requirements/${data.requirementId}`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '转换失败'),
  })

  const convertFaqMutation = useMutation({
    mutationFn: (id: string) => afterSalesApi.convertToFaq(id),
    onSuccess: () => {
      toast.success('已转知识库 FAQ（故障排除分类）')
      queryClient.invalidateQueries({ queryKey: ['after-sales'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '转换失败'),
  })

  if (isLoading && !list.length) return <PageLoader />
  if (isError) return <ErrorState message={(error as any)?.message} onRetry={refetch} />

  const stats = statsQuery.data
  const handleSubmit = () => { if (validateAll()) saveMutation.mutate() }

  return (
    <div className="space-y-4">
      {/*
        统计面板改用共用组件：原来是 text-2xl + 各自着色的卡片，比业务概览那排明显厚一截，
        模块之间来回切时视觉会跳一下。现在高度与配色跟工作台完全一致。
      */}
      <StatCards
        loading={statsQuery.isLoading}
        skeletonCount={6}
        items={[
          { label: '工单总数', value: stats?.totalTickets ?? 0, icon: Headset },
          { label: '处理中', value: stats?.openTickets ?? 0, icon: Activity },
          { label: '已解决', value: stats?.resolvedTickets ?? 0, icon: CheckCircle2 },
          { label: '平均满意度', value: stats?.avgSatisfaction ? `${stats.avgSatisfaction}★` : '—', icon: Star },
          { label: '平均处理天数', value: stats?.avgResolutionDays ?? '—', suffix: stats?.avgResolutionDays ? '天' : undefined, icon: Timer },
          { label: '质保即将到期', value: stats?.warrantyExpiring ?? 0, icon: ShieldAlert, title: '30 天内质保到期的合同' },
        ]}
      />

      {/* 状态 tab */}
      <div className="flex gap-1">
        {[
          { value: '', label: '全部' },
          { value: 'open', label: '待处理' },
          { value: 'in_progress', label: '处理中' },
          { value: 'resolved', label: '已解决' },
          { value: 'converted', label: '已转需求' },
        ].map((t) => (
          <button
            key={t.value}
            onClick={() => setStatusFilter(t.value)}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              statusFilter === t.value ? 'bg-accent-50 text-accent-700 font-medium' : 'text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <DataTable
        data={list}
        pagination={pagination}
        columns={[
          { key: 'ticketNo', title: '工单编号', sortable: true },
          { key: 'title', title: '标题' },
          { key: 'type', title: '类型', render: (row: any) => TYPE_LABELS[row.type] || row.type },
          { key: 'customerShortName', title: '客户', render: (row: any) => row.customerShortName || '—' },
          { key: 'productModel', title: '设备型号', render: (row: any) => row.productModel || '—' },
          { key: 'priority', title: '优先级', sortable: true, render: (row: any) => <StatusBadge status={row.priority} label={PRIORITY_OPTIONS.find(p => p.value === row.priority)?.label || row.priority} /> },
          { key: 'status', title: '状态', sortable: true, render: (row: any) => <StatusBadge status={row.status} /> },
        ]}
        rowKey={(row) => row.id}
        selectedKeys={selectedKeys}
        onSelectionChange={setSelectedKeys}
        onRowDoubleClick={(row) => openDetail(row as AfterSalesTicket)}
        onSort={onSort}
        sortKey={sortBy}
        sortDirection={sortOrder === 'ASC' ? 'asc' : sortOrder === 'DESC' ? 'desc' : null}
        widthStorageKey="after-sales"
        actions={(row) => (
          <div className="flex items-center gap-1">
            <button onClick={() => openDetail(row as AfterSalesTicket)} className="text-accent-600 hover:text-accent-700" title={"查看"}
            aria-label="查看"><Eye size={15} /></button>
            <button onClick={() => openEdit(row as AfterSalesTicket)} className="text-ink-soft hover:text-ink" title={"编辑"}
            aria-label="编辑"><Pencil size={15} /></button>
            <button onClick={() => setDeleteId(row.id)} className="text-danger-fg hover:text-danger-fg" title={"删除"}
            aria-label="删除"><Trash2 size={15} /></button>
          </div>
        )}
      />

      {/* 创建/编辑 Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? '编辑工单' : '新建工单'} onConfirm={handleSubmit} loading={saveMutation.isPending} confirmDisabled={!isValid} size="lg">
        <FormSection title="基本信息" icon={Headset}>
          {form.projectId && (
            <div className="mb-2 text-xs px-2.5 py-1.5 rounded-md bg-accent-50 text-accent-700">
              来源项目：{seedProject?.name || form.projectId}{seedProject?.projectNo ? ` (${seedProject.projectNo})` : ''}
            </div>
          )}
          <FieldGrid cols={2}>
            <FormInput label="工单标题" required value={form.title} error={errors.title} onChange={(e) => setValue('title', e.target.value)} placeholder="如：XX设备液压系统漏油" />
            <FormSelect label="工单类型" value={form.type} onChange={(e) => setValue('type', e.target.value)} options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
          </FieldGrid>
          <FieldGrid cols={3}>
            <FormSelect label="优先级" value={form.priority} onChange={(e) => setValue('priority', e.target.value)} options={PRIORITY_OPTIONS} />
            <EntityPicker
              label="客户"
              queryKey="after-sales-customer"
              value={form.customerId}
              onChange={(v) => setValue('customerId', v)}
              search={searchCustomers}
              resolve={resolveCustomer}
              placeholder="输入客户名称搜索"
            />
            <FormInput label="设备型号" value={form.productModel} onChange={(e) => setValue('productModel', e.target.value)} placeholder="如：BJP-1200" />
          </FieldGrid>
          <FormTextarea label="故障描述" rows={3} value={form.description} onChange={(e) => setValue('description', e.target.value)} placeholder="详细描述故障现象、发生时间、影响范围…" />
        </FormSection>

        {/* 新建/编辑均可填：支持现场同步创建并记录处理结果；新建时状态由后端按是否指派自动判定 */}
        <FormSection title="处理与回访" icon={Wrench}>
            <FieldGrid cols={2}>
              <FormInput label="指派工程师" value={form.assignedTo} onChange={(e) => setValue('assignedTo', e.target.value)} placeholder="工程师ID或姓名" helper={!editing ? '填写后工单自动标记为已派单' : undefined} />
              {editing && (
                <FormSelect label="状态" value={form.status} onChange={(e) => setValue('status', e.target.value)} options={[
                  { value: 'open', label: '待处理' }, { value: 'assigned', label: '已派单' },
                  { value: 'in_progress', label: '处理中' }, { value: 'resolved', label: '已解决' },
                  { value: 'closed', label: '已关闭' },
                ]} />
              )}
            </FieldGrid>
            <FormTextarea label="处理过程" rows={3} value={form.resolution} onChange={(e) => setValue('resolution', e.target.value)} placeholder="记录故障原因、处理步骤、更换部件…" />
            <FormTextarea label="使用备件" rows={2} value={form.spareParts} onChange={(e) => setValue('spareParts', e.target.value)} placeholder="备件名称、型号、数量…" />
            <FieldGrid cols={3}>
              <FormSelect label="满意度(1-5)" value={form.satisfactionScore} onChange={(e) => setValue('satisfactionScore', e.target.value)} options={[{value:'',label:'未评'},{value:'1',label:'1★'},{value:'2',label:'2★'},{value:'3',label:'3★'},{value:'4',label:'4★'},{value:'5',label:'5★'}]} />
              <FormInput label="回访日期" type="date" value={form.visitDate} onChange={(e) => setValue('visitDate', e.target.value)} />
            </FieldGrid>
            <FormTextarea label="回访记录" rows={2} value={form.visitNotes} onChange={(e) => setValue('visitNotes', e.target.value)} placeholder="客户反馈、改进建议…" />
        </FormSection>


        <FormSection title="售后资料" hint="标记为输入文件(客户提交)或输出文件(我方提交)，同步进客户资料">
          <EntityFileUpload
            entityType="customer"
            entityId={editing?.customerId || undefined}
            entityNo={editing?.ticketNo}
            customerId={editing?.customerId || undefined}
            category="售后资料"
          />
        </FormSection>
      </Modal>

      {/* 详情 Drawer */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="售后工单详情" width="w-[540px]">
        {detailQuery.data && (
          <div className="space-y-4">
            <DetailHeader
              title={detailQuery.data.title}
              code={detailQuery.data.ticketNo}
              badge={<StatusBadge status={detailQuery.data.status} />}
              stats={[
                { label: '类型', value: TYPE_LABELS[detailQuery.data.type] || detailQuery.data.type },
                { label: '客户', value: (detailQuery.data as any).customerShortName || '—' },
              ]}
            />
            <DetailSection title="详细信息">
              <DescList items={[
                { label: '工单编号', value: detailQuery.data.ticketNo },
                { label: '设备型号', value: detailQuery.data.productModel || '—' },
                { label: '优先级', value: PRIORITY_OPTIONS.find(p => p.value === detailQuery.data!.priority)?.label || detailQuery.data.priority },
                { label: '指派工程师', value: detailQuery.data.assignedTo || '未指派' },
                { label: '创建时间', value: new Date(detailQuery.data.createdAt).toLocaleString('zh-CN') },
                { label: '解决时间', value: detailQuery.data.resolvedAt ? new Date(detailQuery.data.resolvedAt).toLocaleString('zh-CN') : '—' },
              ]} />
            </DetailSection>
            {detailQuery.data.description && (
              <DetailSection title="故障描述"><p className="text-sm text-ink-soft whitespace-pre-wrap">{detailQuery.data.description}</p></DetailSection>
            )}
            {detailQuery.data.resolution && (
              <DetailSection title="处理过程"><p className="text-sm text-ink-soft whitespace-pre-wrap">{detailQuery.data.resolution}</p></DetailSection>
            )}
            {detailQuery.data.spareParts && (
              <DetailSection title="使用备件"><p className="text-sm text-ink-soft whitespace-pre-wrap">{detailQuery.data.spareParts}</p></DetailSection>
            )}
            {detailQuery.data.satisfactionScore && (
              <DetailSection title="客户满意度">
                <div className="flex items-center gap-1">
                  {[1,2,3,4,5].map(n => <Star key={n} size={16} className={n <= detailQuery.data!.satisfactionScore! ? 'text-warning-fg fill-warning-fg' : 'text-border'} />)}
                  {detailQuery.data.visitNotes && <span className="text-sm text-muted ml-2">{detailQuery.data.visitNotes}</span>}
                </div>
              </DetailSection>
            )}

            {/* 数据回流操作 */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              <Button variant="secondary" size="sm" loading={convertReqMutation.isPending} onClick={() => convertReqMutation.mutate(detailQuery.data!.id)} disabled={detailQuery.data.status === 'converted'}>
                <RefreshCw size={14} className="mr-1" /> 转备件需求
              </Button>
              <Button variant="secondary" size="sm" loading={convertFaqMutation.isPending} onClick={() => convertFaqMutation.mutate(detailQuery.data!.id)} disabled={!detailQuery.data.resolution}>
                <BookPlus size={14} className="mr-1" /> 转知识库FAQ
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setDrawerOpen(false); openEdit(detailQuery.data!) }}>
                <Pencil size={14} className="mr-1" /> 编辑
              </Button>
            </div>
          </div>
        )}
      </Drawer>

      {/* 删除确认 */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="删除工单" onConfirm={() => deleteId && deleteMutation.mutate(deleteId)} confirmText="删除" confirmVariant="danger" loading={deleteMutation.isPending}>
        <p className="text-sm text-ink-soft">确定删除该售后工单吗？此操作不可撤销。</p>
      </Modal>
    </div>
  )
}
