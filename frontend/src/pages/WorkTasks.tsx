import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, Plus, Pencil, Trash2, CalendarDays, Hourglass, CheckCircle2, ListTodo } from 'lucide-react'
import { workTaskApi, projectApi, customerApi } from '../api/services'
import { useDebounce } from '../hooks/useDebounce'
import { usePagedQuery } from '../hooks/usePagedQuery'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'
import { usePageActions } from '../contexts/PageActionsContext'
import AttachmentBadge from '../components/AttachmentBadge'
import StatCards from '../components/StatCards'
import Button from '../components/Button'
import Modal from '../components/Modal'
import FormInput from '../components/FormInput'
import FormSelect from '../components/FormSelect'
import FormTextarea from '../components/FormTextarea'
import EntityFileUpload from '../components/EntityFileUpload'
import EntityPicker from '../components/EntityPicker'
import DataTable from '../components/DataTable'
import ConfirmDialog from '../components/ConfirmDialog'
import StatusBadge from '../components/StatusBadge'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import PageHeader from '../components/PageHeader'
import { FormSection, FieldGrid } from '../components/layout-kit'
import { toList } from '../utils/apiList'

/**
 * 工作任务：业务流程之外的日常工作记录。
 *
 * 客户→需求→…→售后是"跟单子走"的业务链；还有一类"每天都要做、
 * 但不在任何单子上"的事（会议、出差、报告、跨部门协作、资料整理、培训）。
 * 本页就是它们的落点：按工作日期记录，可上传文件并区分
 * 工作输入（source）/ 工作输出（deliverable），后续可回溯工作量与成果。
 */
/**
 * 工作分类：在参考系统（智能工作系统）的类型基础上补充技术研究/业务推进/宣传资料。
 */
const CATEGORY_OPTIONS = [
  { value: 'daily', label: '日常事务' },
  { value: 'business', label: '业务推进' },
  { value: 'research', label: '技术研究' },
  { value: 'meeting', label: '会议' },
  { value: 'trip', label: '出差' },
  { value: 'report', label: '文档报告' },
  { value: 'support', label: '协作支持' },
  { value: 'organize', label: '资料整理' },
  { value: 'publicity', label: '宣传资料' },
  { value: 'training', label: '培训学习' },
  { value: 'other', label: '其他' },
]

const STATUS_OPTIONS = [
  { value: 'todo', label: '待办' },
  { value: 'doing', label: '进行中' },
  { value: 'done', label: '已完成' },
]

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: '紧急' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

const categoryLabel = (v?: string) => CATEGORY_OPTIONS.find((o) => o.value === v)?.label || v || '—'
const priorityLabel = (v?: string) => PRIORITY_OPTIONS.find((o) => o.value === v)?.label || v || '—'
const statusLabel = (v?: string) => STATUS_OPTIONS.find((o) => o.value === v)?.label || v || '—'

const initialForm = {
  title: '',
  category: 'daily',
  /** 工作日期默认今天：打开新建就落在"今天做了什么"上，不用每次手选 */
  workDate: new Date().toISOString().slice(0, 10),
  startDate: '',
  dueDate: '',
  status: 'todo',
  priority: 'medium',
  sourcePerson: '',
  deliverTo: '',
  spentHours: '',
  content: '',
  projectName: '',
  customerId: '',
}

export default function WorkTasks() {
  const queryClient = useQueryClient()
  const setPageActions = usePageActions()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const [form, setForm] = useState(initialForm)
  const setValue = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }))

  const {
    list,
    isLoading,
    isError,
    error,
    refetch,
    pagination,
    onSort,
    sortBy,
    sortOrder,
  } = usePagedQuery<any>({
    key: ['work-tasks', categoryFilter, statusFilter],
    filters: {
      keyword: debouncedSearch || undefined,
      category: categoryFilter || undefined,
      status: statusFilter || undefined,
    },
    fetcher: (params) => workTaskApi.list(params) as any,
    initialPageSize: 15,
  })

  const { data: openCount } = useQuery({
    queryKey: ['work-tasks-open-count'],
    queryFn: () => workTaskApi.myOpenCount(),
  })

  // 项目名提示（datalist）：所属项目可从中选，也可自由手写
  const { data: projectOptions } = useQuery({
    queryKey: ['work-task-projects'],
    queryFn: () => projectApi.list({ pageSize: 200 }),
    staleTime: 5 * 60_000,
  })
  const projectNames = toList<any>(projectOptions).map((p) => p.name).filter(Boolean)

  // 来源/交付的历史输入提示：输入时下拉之前用过的值，避免重复手敲
  const { data: historyTasks } = useQuery({
    queryKey: ['work-tasks-history'],
    queryFn: () => workTaskApi.list({ pageSize: 200, sortBy: 'createdAt', sortOrder: 'DESC' }),
    staleTime: 60_000,
  })
  const sourceHints = [...new Set(toList<any>(historyTasks).map((t) => t.sourcePerson).filter(Boolean))]
  const deliverHints = [...new Set(toList<any>(historyTasks).map((t) => t.deliverTo).filter(Boolean))]

  /** 客户候选走服务端搜索（同需求页） */
  const searchCustomers = async (keyword: string) => {
    const res = await customerApi.list({ keyword: keyword || undefined, pageSize: 50 })
    return toList<any>(res).map((c) => ({
      value: c.id,
      label: c.name,
      hint: [c.industry, c.region].filter(Boolean).join(' · ') || undefined,
    }))
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ ...initialForm, workDate: new Date().toISOString().slice(0, 10) })
    setModalOpen(true)
  }

  const openEdit = (row: any) => {
    setEditing(row)
    setForm({
      title: row.title || '',
      category: row.category || 'daily',
      workDate: row.workDate ? String(row.workDate).slice(0, 10) : '',
      startDate: row.startDate ? String(row.startDate).slice(0, 10) : '',
      dueDate: row.dueDate ? String(row.dueDate).slice(0, 10) : '',
      status: row.status || 'todo',
      priority: row.priority || 'medium',
      sourcePerson: row.sourcePerson || '',
      deliverTo: row.deliverTo || '',
      spentHours: row.spentHours != null ? String(row.spentHours) : '',
      content: row.content || '',
      projectName: (row as any).projectDisplayName || row.projectName || '',
      customerId: row.customerId || '',
    })
    setModalOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const dto: any = {
        title: form.title,
        category: form.category,
        status: form.status,
        priority: form.priority,
        sourcePerson: form.sourcePerson || undefined,
        deliverTo: form.deliverTo || undefined,
        spentHours: form.spentHours === '' ? undefined : Number(form.spentHours),
        content: form.content || undefined,
        // 日期空串转 null（清空），不能传 ''：PG date 列收到空串会 500
        workDate: form.workDate || null,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        // 所属项目：手写名（与项目跟踪重名时后端自动挂 projectId）
        projectName: form.projectName || null,
        customerId: form.customerId || null,
      }
      if (editing) return workTaskApi.update(editing.id, dto)
      return workTaskApi.create(dto)
    },
    onSuccess: async (saved: any) => {
      toast.success(editing ? '已保存' : `已创建 ${saved?.taskNo || ''}`)
      queryClient.invalidateQueries({ queryKey: ['work-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['work-tasks-open-count'] })
      // 新建成功后保持弹窗打开并切到编辑态：附件（输入/输出文件）要等有了 id 才能传
      if (!editing && saved?.id) {
        setEditing(saved)
      } else {
        setModalOpen(false)
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '保存失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => workTaskApi.remove(id),
    onSuccess: () => {
      toast.success('已删除')
      queryClient.invalidateQueries({ queryKey: ['work-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['work-tasks-open-count'] })
      setDeleteId(null)
      setModalOpen(false)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '删除失败'),
  })

  useEffect(() => {
    setPageActions(
      <>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            placeholder="搜索主题/内容/来源/交付"
            onChange={(e) => setSearch(e.target.value)}
            className="eo-input !w-60 !pl-8 !py-1 !text-sm"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="eo-input !w-28 !py-1 !text-xs"
          aria-label="按分类筛选"
        >
          <option value="">全部分类</option>
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="eo-input !w-28 !py-1 !text-xs"
          aria-label="按状态筛选"
        >
          <option value="">全部状态</option>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Button onClick={openCreate} size="sm" className="!py-1 !text-sm">
          <Plus size={13} className="mr-0.5" /> 记一笔
        </Button>
      </>
    )
    return () => setPageActions(null)
  }, [categoryFilter, statusFilter])

  useRegisterPageAssistant({
    key: 'work-tasks',
    label: '工作任务',
    sourceTypes: ['document'],
    questions: [
      '我今天/这周都做了哪些工作？',
      '哪些工作任务还没完成？',
      '按分类汇总一下我的工作量分布',
      '最近有哪些会议/出差记录？',
    ],
    context: [
      `页面：工作任务（共 ${pagination?.total ?? list.length} 条，当前第 ${pagination?.page ?? 1} 页）`,
      search ? `搜索关键词：${search}` : '',
      categoryFilter ? `分类筛选：${categoryLabel(categoryFilter)}` : '',
      statusFilter ? `状态筛选：${statusLabel(statusFilter)}` : '',
      '当前页工作任务：',
      ...list
        .slice(0, 40)
        .map(
          (x: any, i: number) =>
            `${i + 1}. ${x.taskNo || ''} ${x.title || ''}｜日期 ${x.workDate ? String(x.workDate).slice(0, 10) : '—'}｜分类 ${categoryLabel(x.category)}｜状态 ${statusLabel(x.status)}｜耗时 ${x.spentHours ?? '—'}h｜项目 ${(x as any).projectDisplayName || '—'}｜客户 ${(x as any).customerName || '—'}｜来源 ${x.sourcePerson || '—'}→交付 ${x.deliverTo || '—'}`,
        ),
    ]
      .filter(Boolean)
      .join('\n'),
  })

  const cards = [
    { label: '未完成', value: openCount?.open ?? 0, icon: Hourglass },
    { label: '今日待办', value: openCount?.today ?? 0, icon: CalendarDays },
    { label: '本页已完成', value: list.filter((x: any) => x.status === 'done').length, icon: CheckCircle2 },
    { label: '任务总数', value: pagination?.total ?? list.length, icon: ListTodo },
  ]

  const canSave = form.title.trim().length > 0

  return (
    <div>
      <PageHeader title="工作" titleEm="任务" />

      <StatCards className="mb-4" loading={isLoading} skeletonCount={4} items={cards} />

      {isLoading && !list.length && <PageLoader />}
      {isError && <ErrorState message={error?.message || '加载失败'} onRetry={refetch} />}
      {!isLoading && !isError && (
        <DataTable
          loading={isLoading}
          data={list}
          columns={[
            {
              key: 'workDate',
              title: '工作日期',
              sortable: true,
              render: (row: any) => (row.workDate ? String(row.workDate).slice(0, 10) : <span className="text-muted">—</span>),
            },
            {
              key: 'startDate',
              title: '开始 → 截止',
              sortable: true,
              render: (row: any) => {
                const s = row.startDate ? String(row.startDate).slice(0, 10) : ''
                const d = row.dueDate ? String(row.dueDate).slice(0, 10) : ''
                if (!s && !d) return <span className="text-muted">—</span>
                // 截止已过且未完成：红色提示（时间管理的一眼信号）
                const overdue = d && row.status !== 'done' && d < new Date().toISOString().slice(0, 10)
                return (
                  <span className={`text-xs whitespace-nowrap ${overdue ? 'text-danger-fg' : 'text-ink-soft'}`}>
                    {s || '—'} → {d || '—'}
                    {overdue ? ' ⚠' : ''}
                  </span>
                )
              },
            },
            {
              key: 'projectDisplayName',
              title: '项目 / 客户',
              render: (row: any) => (
                <div className="min-w-0 text-xs">
                  <div className="truncate text-ink-soft" title="所属项目">{row.projectDisplayName || <span className="text-muted">—</span>}</div>
                  <div className="truncate text-muted" title="所属客户">{row.customerName || ''}</div>
                </div>
              ),
            },
            { key: 'taskNo', title: '编号', sortable: true },
            {
              key: 'title',
              title: '工作主题',
              sortable: true,
              render: (row: any) => (
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{row.title}</p>
                  {row.content && <p className="truncate text-caption text-muted">{row.content}</p>}
                </div>
              ),
            },
            { key: 'category', title: '分类', render: (row: any) => categoryLabel(row.category) },
            {
              key: 'sourcePerson',
              title: '来源 → 交付',
              render: (row: any) => (
                <span className="text-xs text-ink-soft whitespace-nowrap">
                  {row.sourcePerson || '—'} → {row.deliverTo || '—'}
                </span>
              ),
            },
            {
              key: 'spentHours',
              title: '耗时(h)',
              sortable: true,
              render: (row: any) => (row.spentHours != null ? <span className="tabular-nums">{Number(row.spentHours)}</span> : <span className="text-muted">—</span>),
            },
            { key: 'priority', title: '优先级', sortable: true, render: (row: any) => priorityLabel(row.priority) },
            { key: 'status', title: '状态', sortable: true, render: (row: any) => <StatusBadge status={row.status} label={statusLabel(row.status)} /> },
            { key: 'createdAt', title: '创建时间', sortable: true, render: (row: any) => new Date(row.createdAt).toLocaleDateString() },
          ]}
          rowKey={(row) => row.id}
          onRowDoubleClick={(row) => openEdit(row)}
          pagination={pagination}
          widthStorageKey="work-tasks"
          onSort={onSort}
          sortKey={sortBy}
          sortDirection={sortOrder === 'ASC' ? 'asc' : sortOrder === 'DESC' ? 'desc' : null}
          actions={(row) => (
            <div className="flex items-center gap-2">
              <AttachmentBadge counts={(row as any).attachmentCounts} onClick={() => openEdit(row)} />
              <button onClick={() => openEdit(row)} className="text-ink-soft hover:text-ink" title="编辑" aria-label="编辑">
                <Pencil size={16} />
              </button>
              <button onClick={() => setDeleteId(row.id)} className="text-danger-fg hover:text-danger-fg" title="删除" aria-label="删除">
                <Trash2 size={16} />
              </button>
            </div>
          )}
        />
      )}

      {/* 新建/编辑弹窗：保存后可继续上传 输入/输出 文件 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `编辑工作任务 ${editing.taskNo || ''}` : '新建工作任务'}
        onConfirm={() => saveMutation.mutate()}
        confirmText={saveMutation.isPending ? '保存中…' : '保存'}
        confirmDisabled={!canSave || saveMutation.isPending}
        size="lg"
      >
        <FormSection title="基本信息">
          <FieldGrid>
            <FormInput label="工作主题" required value={form.title} onChange={(e) => setValue('title', e.target.value)} placeholder="例：参加 1450 拉矫机组技术评审会" />
            <FormInput label="工作日期" type="date" value={form.workDate} onChange={(e) => setValue('workDate', e.target.value)} />
            <FormInput label="开始时间" type="date" value={form.startDate} onChange={(e) => setValue('startDate', e.target.value)} />
            <FormInput label="截止时间" type="date" value={form.dueDate} onChange={(e) => setValue('dueDate', e.target.value)} />
            <FormSelect label="分类" options={CATEGORY_OPTIONS} value={form.category} onChange={(e) => setValue('category', e.target.value)} />
            <FormSelect label="状态" options={STATUS_OPTIONS} value={form.status} onChange={(e) => setValue('status', e.target.value)} />
            <FormSelect label="优先级" options={PRIORITY_OPTIONS} value={form.priority} onChange={(e) => setValue('priority', e.target.value)} />
            <FormInput label="耗时（小时）" type="number" step="0.5" min="0" value={form.spentHours} onChange={(e) => setValue('spentHours', e.target.value)} placeholder="例：2.5" />
            <FormInput
              label="来源（谁交办/协同）"
              list="wt-source-hints"
              value={form.sourcePerson}
              onChange={(e) => setValue('sourcePerson', e.target.value)}
              placeholder="例：张工 / 生产部"
              helper="输入时提示之前用过的来源"
            />
            <FormInput
              label="交付（成果交给谁）"
              list="wt-deliver-hints"
              value={form.deliverTo}
              onChange={(e) => setValue('deliverTo', e.target.value)}
              placeholder="例：技术中心 / 客户"
              helper="输入时提示之前用过的交付对象"
            />
            {/* 所属项目：datalist 列项目跟踪里的项目名 —— 可选可手写 */}
            <FormInput
              label="所属项目"
              list="wt-project-names"
              value={form.projectName}
              onChange={(e) => setValue('projectName', e.target.value)}
              placeholder="选择或手写项目名"
              helper="与「项目跟踪」重名时自动关联"
            />
            <EntityPicker
              label="所属客户"
              value={form.customerId}
              onChange={(v) => setValue('customerId', v || '')}
              search={searchCustomers}
              queryKey="work-task-customer"
              placeholder="搜索客户（可留空）"
            />
          </FieldGrid>
          <FormTextarea label="工作内容" rows={3} value={form.content} onChange={(e) => setValue('content', e.target.value)} placeholder="做了什么、结论/成果、后续待办…" className="mt-3" />
          {/* 历史输入提示：原生 datalist，输入时出现，不打断手写 */}
          <datalist id="wt-source-hints">
            {sourceHints.map((s) => <option key={s} value={s} />)}
          </datalist>
          <datalist id="wt-deliver-hints">
            {deliverHints.map((s) => <option key={s} value={s} />)}
          </datalist>
          <datalist id="wt-project-names">
            {projectNames.map((s) => <option key={s} value={s} />)}
          </datalist>
        </FormSection>

        {editing && (
          <FormSection title="工作文件">
            {/* 输入=收到的资料（会议通知、任务书），输出=产出的成果（会议纪要、报告） */}
            <EntityFileUpload
              entityType="workTask"
              entityId={editing.id}
              entityNo={editing.taskNo}
              category="业务资料"
            />
          </FormSection>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="删除工作任务"
        message="确定要删除这条工作记录吗？已上传的文件保留在业务资料中，但记录无法恢复。"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
