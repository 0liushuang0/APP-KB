import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Search,
  Plus,
  Eye,
  Pencil,
  Trash2,
  Building2,
  Phone,
  MapPin,
  StickyNote,
  LayoutDashboard,
  Users,
  UserCheck,
  UserPlus,
  Moon,
} from 'lucide-react'
import { customerApi } from '../api/services'
import {
  CUSTOMER_TYPE_OPTIONS,
  INDUSTRY_OPTIONS,
  CUSTOMER_LEVEL_OPTIONS,
  BUSINESS_STATUS_OPTIONS,
  REGION_OPTIONS,
  SCALE_OPTIONS,
  DECISION_ROLE_OPTIONS,
} from '../types'
import { useDebounce } from '../hooks/useDebounce'
import { useFormValidation, required } from '../hooks/useFormValidation'
import { usePagedQuery } from '../hooks/usePagedQuery'
import { useModuleStats } from '../hooks/useModuleStats'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'
import { usePageActions } from '../contexts/PageActionsContext'
import StatCards from '../components/StatCards'
import ImportButton from '../components/ImportButton'
import ExportButton from '../components/ExportButton'
import type { Customer } from '../types'
import Button from '../components/Button'
import Modal from '../components/Modal'
import Drawer from '../components/Drawer'
import FormInput from '../components/FormInput'
import FormSelect from '../components/FormSelect'
import DataTable from '../components/DataTable'
import BatchEditBar from '../components/BatchEditBar'
import StatusBadge from '../components/StatusBadge'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import PageHeader from '../components/PageHeader'
import { FormSection, FieldGrid, DetailHeader, DetailSection, DescList } from '../components/layout-kit'

const initialForm = {
  name: '',
  code: '',
  customerCode: '',
  status: '',
  industry: '',
  scale: '',
  level: '',
  businessStatus: '活跃',
  region: '',
  creditCode: '',
  address: '',
  website: '',
  description: '',
  customerType: '',
  salesPerson: '',
  firstCooperationDate: '',
  visibility: 'public',
}

const visibilityOptions = [
  { value: 'public', label: '公开' },
  { value: 'department', label: '部门' },
  { value: 'private', label: '私有' },
]

const handleError = (error: any) => {
  toast.error(error?.response?.data?.message || error?.message || '操作失败')
}

/** 弹窗里的一行联系人。id 有值＝库里已有记录，无值＝本次新增 */
interface ContactDraft {
  id?: string
  name: string
  title?: string
  department?: string
  phone?: string
  email?: string
  wechat?: string
  decisionRole?: string
  isPrimary?: boolean
}

/** 这一行相对库里那条有没有实际改动 —— 没改就不必发 PATCH */
const contactChanged = (draft: ContactDraft, original?: ContactDraft) => {
  if (!original) return true
  const keys: (keyof ContactDraft)[] = [
    'name', 'title', 'department', 'phone', 'email', 'wechat', 'decisionRole', 'isPrimary',
  ]
  return keys.some((k) => (draft[k] ?? '') !== (original[k] ?? ''))
}

export default function Customers() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  // 按客户状态过滤（后端列表接口已支持 status 参数）
  const [statusFilter, setStatusFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [selected, setSelected] = useState<Customer | null>(null)
  /*
   * 联系人编辑草稿。
   *
   * id 必须留着：有 id 的是库里已存在的记录（保存时走 update），没有的才是新增。
   * 早先这里把 id 抹掉、保存时无脑全量 addContact，而 contact_persons 表上
   * 并没有唯一约束 —— 每编辑保存一次，联系人就原样翻一倍。
   */
  const [contacts, setContacts] = useState<ContactDraft[]>([])
  /** 本次编辑中被删掉的已存在联系人 id，保存时才真正调接口删 */
  const [removedContactIds, setRemovedContactIds] = useState<string[]>([])
  /** 打开弹窗时从服务端读到的原始联系人，保存时用来判断哪几行真改过 */
  const originalContactsRef = useRef<ContactDraft[]>([])
  const [saving, setSaving] = useState(false)
  const { values: form, errors, isValid, setValue, setValues, validateAll, reset } = useFormValidation({
    initialValues: initialForm,
    rules: {
      name: required('请输入客户名称'),
      industry: required('请选择所属行业'),
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
  } = usePagedQuery<Customer>({
    key: ['customers'],
    filters: { keyword: debouncedSearch || undefined, status: statusFilter || undefined },
    fetcher: (params) => customerApi.list(params) as any,
    initialPageSize: 15,
  })

  const detailQuery = useQuery({
    queryKey: ['customer', selected?.id],
    queryFn: () => (selected?.id ? customerApi.get(selected.id) : null),
    enabled: !!selected?.id,
  })


  const deleteMutation = useMutation({
    mutationFn: (id: string) => customerApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      setDeleteId(null)
      refetch()
    },
    onError: handleError,
  })

  // 删除预检：删客户会硬删整条业务链（需求/方案/报价/合同/项目/资料），不可恢复。
  // 弹窗打开时才查级联计数，预先告知连带删除的范围。
  const { data: removePreview, isLoading: previewLoading } = useQuery({
    queryKey: ['customer-remove-preview', deleteId],
    queryFn: () => customerApi.removePreview(deleteId!),
    enabled: !!deleteId,
    staleTime: 0,
  })

  const openCreate = () => {
    setEditing(null)
    reset()
    setContacts([])
    setRemovedContactIds([])
    setModalOpen(true)
  }

  const openEdit = (row: Customer) => {
    setEditing(row)
    setValues({
      name: row.name || '',
      code: row.code || '',
      customerCode: (row as any).customerCode || '',
      status: row.status || '',
      industry: row.industry || '',
      scale: row.scale || '',
      level: (row as any).level || '',
      businessStatus: (row as any).businessStatus || '',
      region: (row as any).region || '',
      creditCode: (row as any).creditCode || '',
      address: row.address || '',
      website: row.website || '',
      description: row.description || '',
      customerType: (row as any).customerType || '',
      salesPerson: (row as any).salesPerson || '',
      firstCooperationDate: (row as any).firstCooperationDate ? (row as any).firstCooperationDate.slice(0, 10) : '',
      visibility: row.visibility || 'public',
    })
    setContacts([])
    setRemovedContactIds([])
    originalContactsRef.current = []
    setModalOpen(true)

    /*
     * 联系人单独取一次详情。
     *
     * 列表接口不 join contacts（196 家客户的列表也用不上），row.contacts 恒为
     * undefined —— 直接拿它填弹窗，打开永远是空的，用户只能重新录一遍，
     * 于是又生出重复数据。改成开弹窗后按 id 拉一次完整客户。
     * id 必须留住：保存时靠它区分"改已有"还是"加新的"。
     */
    customerApi
      .get(row.id)
      .then((full: any) => {
        const loaded: ContactDraft[] = (full?.contacts || []).map((c: any) => ({
          id: c.id,
          name: c.name || '', title: c.title || '', department: c.department || '',
          phone: c.phone || '', email: c.email || '', wechat: c.wechat || '',
          decisionRole: c.decisionRole || '', isPrimary: !!c.isPrimary,
        }))
        originalContactsRef.current = loaded
        setContacts(loaded.map((c) => ({ ...c })))
      })
      .catch(handleError)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    reset()
    // 取消编辑时把待删清单一并丢掉，否则下次保存会误删上次点掉的联系人
    setContacts([])
    setRemovedContactIds([])
    originalContactsRef.current = []
  }

  const openDetail = (row: Customer) => {
    setSelected(row)
    setDrawerOpen(true)
  }

  const handleSubmit = async () => {
    if (!validateAll()) return
    setSaving(true)
    const dto: any = { ...form }
    try {
      let savedCustomerId = editing?.id
      if (editing) {
        await customerApi.update(editing.id, dto)
      } else {
        const result: any = await customerApi.create(dto)
        savedCustomerId = result?.id || result?.data?.id
      }

      /*
       * 联系人三态同步：删的删、有 id 的改、没 id 的加。
       *
       * 原来是无脑全量 addContact + catch 吞异常，注释写着"跳过重复"——
       * 但 contact_persons 表根本没有唯一约束，谈不上"重复"被拦下，
       * 实际效果是每保存一次联系人列表就翻一倍。
       * 异常也不再吞：存不进去必须让用户当场知道。
       */
      if (savedCustomerId) {
        const payloadOf = (c: ContactDraft) => ({
          name: c.name.trim(),
          title: c.title,
          department: c.department,
          phone: c.phone,
          email: c.email,
          wechat: c.wechat,
          decisionRole: c.decisionRole,
          // 必须是布尔：后端 DTO 是 @IsBoolean()，ValidationPipe 没开隐式转换，
          // 早先这里传的是 String(checked)，勾一下"主联系人"整条就 400 存不进去
          isPrimary: !!c.isPrimary,
        })
        const originalById = new Map<string, ContactDraft>(
          originalContactsRef.current
            .filter((c): c is ContactDraft & { id: string } => !!c.id)
            .map((c) => [c.id, c]),
        )

        for (const id of removedContactIds) {
          await customerApi.removeContact(id)
        }
        for (const c of contacts.filter((c) => c.name?.trim())) {
          if (c.id) {
            // 没改动就别发请求，省得编辑个地址把全部联系人都 PATCH 一遍
            if (contactChanged(c, originalById.get(c.id))) {
              await customerApi.updateContact(c.id, payloadOf(c))
            }
          } else {
            await customerApi.addContact({ customerId: savedCustomerId, ...payloadOf(c) })
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ['customers'] })
      closeModal()
      refetch()
      toast.success(editing ? '已保存' : '客户已创建')
    } catch (error: any) {
      handleError(error)
    } finally {
      setSaving(false)
    }
  }

  const addContactRow = () => setContacts((prev) => [...prev, { name: '' }])
  const updateContactRow = <K extends keyof ContactDraft>(idx: number, field: K, value: ContactDraft[K]) =>
    setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)))
  /** 删除只改草稿；已存在的记下 id，等点保存时才真删（此前只 filter 数组，压根没调接口） */
  const removeContactRow = (idx: number) =>
    setContacts((prev) => {
      const target = prev[idx]
      if (target?.id) setRemovedContactIds((ids) => [...ids, target.id!])
      return prev.filter((_, i) => i !== idx)
    })


  const setPageActions = usePageActions()


  useEffect(() => {
    setPageActions(
      <>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            placeholder="搜索客户"
            onChange={(e) => setSearch(e.target.value)}
            className="eo-input !w-60 !pl-8 !py-1 !text-sm"
          />
        </div>
        {/* 状态筛选与导入/导出统一收到顶栏，与搜索、新建同行展示 */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="eo-input !w-28 !py-1 !text-xs"
          aria-label="按状态筛选"
        >
          <option value="">全部状态</option>
          <option value="potential">潜在客户</option>
          <option value="active">合作中</option>
          <option value="inactive">已停用</option>
        </select>
        {statusFilter && (
          <button onClick={() => setStatusFilter('')} className="text-caption text-muted hover:text-ink transition-colors">
            清除
          </button>
        )}
        <ImportButton type="customer" queryKey="customers" size="sm" className="!py-1 !text-xs" />
        <ExportButton type="customer" keyword={debouncedSearch || undefined} status={statusFilter || undefined} />
        <Button onClick={openCreate} size="sm" className="!py-1 !text-sm">
          <Plus size={13} className="mr-0.5" /> 新建
        </Button>
        {/* 批量操作收到顶栏：选中后才出现，琥珀修改/红色删除一眼可见 */}
        <BatchEditBar
          selectedKeys={selectedKeys}
          onClear={() => setSelectedKeys([])}
          moduleName="客户"
          queryKey={['customers']}
          updateFn={(id, dto) => customerApi.update(id, dto)}
          deleteFn={(id) => customerApi.remove(id)}
          fields={[
            { key: 'customerType', label: '客户类型', options: CUSTOMER_TYPE_OPTIONS },
            { key: 'industry', label: '所属行业', options: INDUSTRY_OPTIONS },
            { key: 'level', label: '客户等级', options: CUSTOMER_LEVEL_OPTIONS },
            { key: 'businessStatus', label: '业务状态', options: BUSINESS_STATUS_OPTIONS },
            { key: 'region', label: '所属区域', options: REGION_OPTIONS },
          ]}
        />
      </>
    )
    return () => setPageActions(null)
     
  }, [statusFilter, debouncedSearch, selectedKeys])

  /*
   * 把"用户此刻看到的"注册给悬浮 AI 助手：筛选条件 + 本页列表 + KPI。
   * 只放看得见的信息，助手才能做到"只回答本页内容"。
   */
  useRegisterPageAssistant({
    key: 'customers',
    label: '客户中心',
    sourceTypes: ['customer', 'requirement', 'quotation'],
    questions: [
      '本页列出的客户里，哪些等级最高？',
      '这些客户分别属于哪些行业和区域？',
      '本页有哪些客户处于沉默或流失状态？',
      '挑一个客户，说说该怎么跟进',
      '本页客户里最值得优先拜访的是哪几家？为什么',
    ],
    context: [
      `页面：客户中心（共 ${pagination?.total ?? listData.length} 家客户，当前第 ${pagination?.page ?? 1} 页）`,
      search ? `搜索关键词：${search}` : '',
      `当前页客户清单：`,
      ...listData
        .slice(0, 40)
        .map(
          (x: Customer, i: number) =>
            `${i + 1}. ${x.name}｜等级 ${x.level || '—'}｜业务状态 ${(x as any).businessStatus || '—'}｜行业 ${x.industry || '—'}｜区域 ${(x as any).region || '—'}｜销售 ${(x as any).salesPerson || '—'}`,
        ),
    ]
      .filter(Boolean)
      .join('\n'),
  })

  const { stats, isLoading: statsLoading } = useModuleStats()
  const c = stats?.customers
  // 口径与「业务状态」筛选一致：活跃 / 沉默 / 流失
  const customerCards = [
    { label: '客户总数', value: c?.total ?? 0, icon: Users },
    { label: '活跃', value: c?.active ?? 0, icon: UserCheck },
    { label: '沉默', value: c?.sleeping ?? 0, icon: Moon },
    { label: '流失', value: c?.lead ?? 0, icon: UserPlus },
    { label: '本月新增', value: c?.newThisMonth ?? 0, icon: Plus },
  ]

  return (
    <div>
      <PageHeader title="客户" titleEm="管理" />

      {/* 统计卡片：与业务概览顶部同一套组件，各模块高度与配色一致 */}
      <StatCards className="mb-4" loading={statsLoading} skeletonCount={5} items={customerCards} />

      {isLoading && !listData.length && <PageLoader />}
      {isError && <ErrorState message={error?.message || '加载失败'} onRetry={refetch} />}
      {!isLoading && !isError && (
        <DataTable
          loading={isLoading}
          data={listData}
          columns={[
            {
              key: 'customerCode',
              title: '客户编号',
              render: (row: any) => row.customerCode || <span className="text-muted">自动生成</span>,
            },
            { key: 'name', title: '客户名称', sortable: true },
            { key: 'code', title: '简称' },
            { key: 'customerType', title: '类型' },
            { key: 'industry', title: '行业' },
            { key: 'level', title: '等级', render: (row: any) => {
                const v = row.level || ''
                const colors: Record<string,string> = { A: 'text-danger-fg font-bold', B: 'text-warning-fg font-medium', C: 'text-muted', D: 'text-info-fg' }
                return <span className={colors[v] || 'text-muted'}>{v || '—'}</span>
              }
            },
            { key: 'businessStatus', title: '业务状态', render: (row: any) => <StatusBadge status={row.businessStatus} label={row.businessStatus || '—'} /> },
            { key: 'region', title: '区域', render: (row: any) => row.region || '—' },
            { key: 'salesPerson', title: '负责销售' },
          ]}
          rowKey={(row) => row.id}
          onRowDoubleClick={(row) => navigate(`/customers/${row.id}`)}
          pagination={pagination}
          widthStorageKey="customers"
              onSort={onSort}
          sortKey={sortBy}
          sortDirection={sortOrder === 'ASC' ? 'asc' : sortOrder === 'DESC' ? 'desc' : null}
          actions={(row) => (
            <div className="flex items-center gap-2">
              <button onClick={() => navigate(`/customers/${row.id}`)} className="text-accent-600 hover:text-accent-700" aria-label="客户档案" title="客户360档案">
                <LayoutDashboard size={16} />
              </button>
              <button onClick={() => openDetail(row)} className="text-accent-600 hover:text-accent-700" title={"查看"}
              aria-label="查看">
                <Eye size={16} />
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

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? '编辑客户' : '新建客户'}
        onConfirm={handleSubmit}
        loading={saving}
        confirmDisabled={!isValid}
        size="lg"
      >
        <div className="space-y-6">
        <FormSection title="客户识别" icon={Building2}>
        <FieldGrid cols={3}>
          <FormInput
            label="客户编号"
            value={form.customerCode}
            onChange={(e) => setValue('customerCode', e.target.value)}
            helper="留空则自动生成 CUST-2026-001"
          />
          <FormInput label="客户名称（全称）" value={form.name} onChange={(e) => setValue('name', e.target.value)} error={errors.name} required />
          <FormInput
            label="客户简称"
            value={form.code}
            onChange={(e) => setValue('code', e.target.value)}
            helper="需求、方案列表里显示的就是它"
          />
        </FieldGrid>
        </FormSection>

        <FormSection title="分类与状态">
        <FieldGrid cols={3}>
          <FormSelect label="客户类型" options={CUSTOMER_TYPE_OPTIONS} value={form.customerType} onChange={(e) => setValue('customerType', e.target.value)} />
          <FormSelect label="所属行业" options={INDUSTRY_OPTIONS} value={form.industry} onChange={(e) => setValue('industry', e.target.value)} error={errors.industry} />
          <FormSelect label="客户等级" options={CUSTOMER_LEVEL_OPTIONS} value={form.level} onChange={(e) => setValue('level', e.target.value)} />
          <FormSelect label="业务状态" options={BUSINESS_STATUS_OPTIONS} value={form.businessStatus} onChange={(e) => setValue('businessStatus', e.target.value)} />
          <FormSelect label="所属区域" options={REGION_OPTIONS} value={form.region} onChange={(e) => setValue('region', e.target.value)} />
          <FormSelect label="企业规模" options={SCALE_OPTIONS} value={form.scale} onChange={(e) => setValue('scale', e.target.value)} />
        </FieldGrid>
        </FormSection>

        <FormSection title="档案信息">
        <FieldGrid cols={3}>
          <FormInput label="统一社会信用代码" value={form.creditCode} onChange={(e) => setValue('creditCode', e.target.value)} />
          <FormInput label="注册地址" value={form.address} onChange={(e) => setValue('address', e.target.value)} />
          <FormInput label="企业网址" value={form.website} onChange={(e) => setValue('website', e.target.value)} />
          <FormInput label="负责销售" value={form.salesPerson} onChange={(e) => setValue('salesPerson', e.target.value)} />
          <FormInput label="首次合作日期" type="date" value={form.firstCooperationDate} onChange={(e) => setValue('firstCooperationDate', e.target.value)} />
          <FormSelect label="可见性" options={visibilityOptions} value={form.visibility} onChange={(e) => setValue('visibility', e.target.value)} />
        </FieldGrid>
        </FormSection>

        {/* 联系人子表单 */}
        <FormSection
          title={`联系人 (${contacts.length})`}
          icon={Phone}
          action={
            <button type="button" onClick={addContactRow} className="text-xs text-accent-600 hover:text-accent-700 flex items-center gap-0.5">
              <Plus size={13} /> 添加联系人
            </button>
          }
        >
        <div>
          {contacts.length === 0 ? (
            <p className="text-xs text-muted py-2">暂无联系人，点击"添加联系人"创建</p>
          ) : (
            <div className="space-y-2">
              {contacts.map((c, idx) => (
                <div key={idx} className="bg-canvas p-2 rounded-md space-y-1.5">
                  <div className="flex gap-1.5 items-center">
                    <input placeholder="姓名" value={c.name} onChange={(e) => updateContactRow(idx, 'name', e.target.value)} className="flex-1 min-w-0 px-2 py-1 border border-border rounded text-sm text-ink bg-surface" />
                    <input placeholder="职务" value={c.title || ''} onChange={(e) => updateContactRow(idx, 'title', e.target.value)} className="flex-1 min-w-0 px-2 py-1 border border-border rounded text-sm text-ink bg-surface" />
                    <input placeholder="部门" value={c.department || ''} onChange={(e) => updateContactRow(idx, 'department', e.target.value)} className="flex-1 min-w-0 px-2 py-1 border border-border rounded text-sm text-ink bg-surface" />
                    <input placeholder="手机" value={c.phone || ''} onChange={(e) => updateContactRow(idx, 'phone', e.target.value)} className="flex-1 min-w-0 px-2 py-1 border border-border rounded text-sm text-ink bg-surface" />
                    <input placeholder="邮箱" value={c.email || ''} onChange={(e) => updateContactRow(idx, 'email', e.target.value)} className="flex-1 min-w-0 px-2 py-1 border border-border rounded text-sm text-ink bg-surface" />
                    <button type="button" onClick={() => removeContactRow(idx)} className="text-danger-fg hover:text-danger-fg flex items-center justify-center px-1" title={"删除联系人"}
                    aria-label="删除联系人">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="flex gap-1.5 items-center">
                    <input placeholder="微信/飞书" value={c.wechat || ''} onChange={(e) => updateContactRow(idx, 'wechat', e.target.value)} className="flex-1 min-w-0 px-2 py-1 border border-border rounded text-sm text-ink bg-surface" />
                    <select value={c.decisionRole || ''} onChange={(e) => updateContactRow(idx, 'decisionRole', e.target.value)} className="flex-1 min-w-0 px-2 py-1 border border-border rounded text-sm text-ink bg-surface">
                      <option value="">决策角色</option>
                      {DECISION_ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-muted whitespace-nowrap px-1">
                      <input type="checkbox" checked={!!c.isPrimary} onChange={(e) => updateContactRow(idx, 'isPrimary', e.target.checked)} className="accent-accent-500" />
                      主联系人
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </FormSection>
        </div>
      </Modal>

      <Modal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="确认删除客户"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
        confirmText="删除"
      >
        {previewLoading ? (
          <p className="text-sm text-muted">正在检查关联数据…</p>
        ) : removePreview?.hasImpact ? (
          <div className="space-y-2">
            <p className="text-sm text-ink-soft">
              删除客户「<span className="text-ink font-medium">{removePreview.name}</span>」将<b className="text-danger-fg">级联删除</b>以下全部数据，不可恢复：
            </p>
            <ul className="text-sm text-ink-soft space-y-1 pl-1">
              {removePreview.requirementsCount > 0 && <li>· 需求 <b className="text-danger-fg">{removePreview.requirementsCount}</b> 条</li>}
              {removePreview.proposalsCount > 0 && <li>· 方案 <b className="text-danger-fg">{removePreview.proposalsCount}</b> 个</li>}
              {removePreview.quotationsCount > 0 && <li>· 报价 <b className="text-danger-fg">{removePreview.quotationsCount}</b> 份</li>}
              {removePreview.contractsCount > 0 && <li>· 合同 <b className="text-danger-fg">{removePreview.contractsCount}</b> 份</li>}
              {removePreview.projectsCount > 0 && <li>· 项目 <b className="text-danger-fg">{removePreview.projectsCount}</b> 个</li>}
              {removePreview.docsCount > 0 && <li>· 客户资料 <b className="text-danger-fg">{removePreview.docsCount}</b> 份（含全部阶段档案）</li>}
            </ul>
            <p className="text-xs text-warning-fg">⚠ 若只想暂时移除，建议改用"停用"而非删除。</p>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">该客户无关联业务数据，确定删除？删除后无法恢复。</p>
        )}
      </Modal>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="客户详情" width="w-[760px]">
        {detailQuery.isLoading ? (
          <PageLoader />
        ) : detailQuery.isError ? (
          <ErrorState message={detailQuery.error?.message || '加载失败'} onRetry={() => detailQuery.refetch()} />
        ) : (
          <div className="space-y-4">
            <DetailHeader
              title={detailQuery.data?.name}
              code={(detailQuery.data as any)?.customerCode}
              stats={[
                { label: '简称', value: detailQuery.data?.code },
                { label: '行业', value: detailQuery.data?.industry },
                { label: '等级', value: (detailQuery.data as any)?.level || '—' },
                { label: '业务状态', value: (detailQuery.data as any)?.businessStatus || '—' },
              ]}
            />

            {/* 左右两列布局 */}
            <div className="grid grid-cols-2 gap-4">
              <DetailSection title="基本信息" icon={Building2}>
                <DescList
                  items={[
                    { label: '客户类型', value: (detailQuery.data as any)?.customerType || '—' },
                    { label: '企业规模', value: detailQuery.data?.scale || '—' },
                    { label: '所属区域', value: (detailQuery.data as any)?.region || '—' },
                    { label: '负责销售', value: (detailQuery.data as any)?.salesPerson || '—' },
                    { label: '首次合作', value: (detailQuery.data as any)?.firstCooperationDate ? new Date((detailQuery.data as any).firstCooperationDate).toLocaleDateString('zh-CN') : '—' },
                  ]}
                />
              </DetailSection>
              <DetailSection title="企业信息" icon={MapPin}>
                <DescList
                  items={[
                    { label: '信用代码', value: (detailQuery.data as any)?.creditCode || '—' },
                    { label: '注册地址', value: detailQuery.data?.address || '—' },
                    { label: '企业网址', value: detailQuery.data?.website || '—' },
                    { label: '标签', value: ((detailQuery.data as any)?.tags || []).join('、') || '—' },
                  ]}
                />
              </DetailSection>
            </div>

            {detailQuery.data?.description && (
              <DetailSection title="备注" icon={StickyNote}>
                <DescList items={[{ label: '描述', value: detailQuery.data?.description, full: true }]} />
              </DetailSection>
            )}

            <DetailSection title={`联系人 (${detailQuery.data?.contacts?.length || 0})`} icon={Phone}>
              {(detailQuery.data?.contacts || []).length === 0 ? (
                <p className="text-sm text-muted">暂无联系人</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {(detailQuery.data?.contacts || []).map((c: any, idx: number) => (
                    <div key={idx} className="bg-subtle p-2.5 rounded-md text-sm">
                      <div className="font-medium text-ink">{c.name} {c.title ? `· ${c.title}` : ''}</div>
                      <div className="text-muted text-xs mt-0.5 space-y-0.5">
                        {c.department && <div>{c.department}</div>}
                        {c.phone && <div>📱 {c.phone}</div>}
                        {c.email && <div>✉️ {c.email}</div>}
                        {c.wechat && <div>💬 {c.wechat}</div>}
                        {c.decisionRole && <div className="text-accent-600">{c.decisionRole}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </DetailSection>

            <div className="flex gap-2 pt-2 border-t border-border">
              <Button variant="secondary" size="sm" onClick={() => { const d = detailQuery.data; if (d) { setDrawerOpen(false); openEdit(d as any) } }}>
                <Pencil size={14} className="mr-1" /> 编辑
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate(`/customers/${detailQuery.data?.id}`)}>
                <LayoutDashboard size={14} className="mr-1" /> 360°视图
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}
