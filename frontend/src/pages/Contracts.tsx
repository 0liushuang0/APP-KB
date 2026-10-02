import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Eye, Pencil, Trash2, ScrollText, DollarSign, FolderKanban, FileSignature, Activity, CheckCircle2, ShieldAlert } from 'lucide-react'
import { contractApi, quotationApi, systemApi } from '../api/services'
import { usePageActions } from '../contexts/PageActionsContext'
import { usePagedQuery } from '../hooks/usePagedQuery'
import { useDebounce } from '../hooks/useDebounce'
import { useFormValidation, required } from '../hooks/useFormValidation'
import { useModuleStats } from '../hooks/useModuleStats'
import StatCards, { compactMoney } from '../components/StatCards'
import Button from '../components/Button'
import Modal from '../components/Modal'
import Drawer from '../components/Drawer'
import DataTable from '../components/DataTable'
import BatchEditBar from '../components/BatchEditBar'
import StatusBadge from '../components/StatusBadge'
import Skeleton from '../components/Skeleton'
import ErrorState from '../components/ErrorState'
import { FormSection, FieldGrid, DetailHeader, DetailSection, DescList } from '../components/layout-kit'
import EntityFileUpload from '../components/EntityFileUpload'
import FormInput from '../components/FormInput'
import FormTextarea from '../components/FormTextarea'
import EntityPicker from '../components/EntityPicker'
import { toList } from '../utils/apiList'
import type { Contract } from '../types'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'

export default function Contracts() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  // 从报价列表「转合同」跳来：预填来源报价，客户/金额/编号由报价自动带出
  const fromQuotationId = searchParams.get('fromQuotationId') || ''
  // 从客户 360 等入口带 ?highlight= 跳来：直接打开对应合同详情
  const highlightId = searchParams.get('highlight') || ''
  const seedQuotation = (location.state as any)?.quotation
  const queryClient = useQueryClient()
  const setPageActions = usePageActions()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  // 按合同状态过滤（后端列表接口已支持 status 参数）
  const [statusFilter, setStatusFilter] = useState('')

  // 合同语境的状态文案：pending/approved 是审批态，与通用徽标（待整理/可用）含义不同
  const CONTRACT_STATUS_LABELS: Record<string, string> = {
    draft: '草稿',
    pending: '待审批',
    approved: '已批准（待签约）',
    signed: '已签订',
    executing: '执行中',
    completed: '已完成',
    terminated: '已终止',
  }

  const [modalOpen, setModalOpen] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [editing, setEditing] = useState<Contract | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState<Contract | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { list, isLoading, isError, error, refetch, onSort, sortBy, sortOrder, pagination } = usePagedQuery<Contract>({
    key: ['contracts'],
    filters: { keyword: debouncedSearch || undefined, status: statusFilter || undefined },
    fetcher: (params) => contractApi.list(params) as any,
  })

  useRegisterPageAssistant({
    key: 'contracts',
    label: '合同管理',
    sourceTypes: ['contract', 'customer', 'quotation', 'project'],
    questions: [
      '本页合同的金额分布是怎样的？',
      '哪些合同即将到期或质保将满？',
      '这些合同的付款条件有什么差异？',
      '按当前列表，哪些客户的合同额最大？',
      '有哪些合同还没生效？',
    ],
    context: [
      `页面：合同管理（共 ${list.length} 份，当前页）`,
      search ? `搜索关键词：${search}` : '',
      statusFilter ? `状态筛选：${statusFilter}` : '',
      '当前页合同清单：',
      ...list
        .slice(0, 40)
        .map(
          (x: Contract, i: number) =>
            `${i + 1}. ${x.contractNo || ''} ${(x as any).title || ''}｜客户 ${(x as any).customer?.name || (x as any).customerName || '—'}｜金额 ${Number((x as any).amount || 0).toLocaleString('zh-CN')}｜状态 ${x.status || '—'}`,
        ),
    ]
      .filter(Boolean)
      .join('\n'),
  })

  const detailQuery = useQuery({
    queryKey: ['contract', selected?.id],
    queryFn: () => (selected?.id ? contractApi.get(selected.id) : null),
    enabled: !!selected?.id,
  })

  useEffect(() => {
    setPageActions(
      <>
        {/* 非受控：受控 value 在 IME 组字时会被回写打断（拼音乱码），搜索只靠 onChange */}
        <input
          placeholder="搜索合同编号/标题/客户"
          onChange={(e) => setSearch(e.target.value)}
          className="eo-input !w-60 !py-1.5 !text-sm"
        />
        {/* 状态筛选收到顶栏，与搜索同行展示 */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="eo-input !w-28 !py-1 !text-xs"
          aria-label="按状态筛选"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="pending">待审批</option>
          <option value="approved">已批准</option>
          <option value="signed">已签订</option>
          <option value="executing">执行中</option>
          <option value="completed">已完成</option>
          <option value="terminated">已终止</option>
        </select>
        {statusFilter && (
          <button onClick={() => setStatusFilter('')} className="text-caption text-muted hover:text-ink transition-colors">
            清除
          </button>
        )}
        {/* 财务对接轻量版：应收台账一键导出（合同 × 回款节点汇总） */}
        <button
          onClick={() => window.open(systemApi.export({ type: 'receivables' }), '_blank')}
          className="text-caption text-accent-600 hover:text-accent-700 transition-colors"
          title="导出合同应收/实收/未收汇总表"
        >
          导出应收
        </button>
        {/* 不再提供空白「新建合同」——合同统一由报价列表的「转合同」派生 */}
        {/* 批量操作收到顶栏：选中后才出现，琥珀修改/红色删除一眼可见 */}
        <BatchEditBar
          selectedKeys={selectedKeys}
          onClear={() => setSelectedKeys([])}
          moduleName="合同"
          queryKey={['contracts']}
          updateFn={(id, dto) => contractApi.update(id, dto)}
          deleteFn={(id) => contractApi.remove(id)}
          fields={[
            { key: 'status', label: '状态', options: [
              { value: 'draft', label: '草稿' }, { value: 'signed', label: '已签订' },
              { value: 'executing', label: '执行中' }, { value: 'completed', label: '已完成' },
              { value: 'terminated', label: '已终止' },
            ] },
          ]}
        />
      </>
    )
    return () => setPageActions(null)
  }, [statusFilter, selectedKeys])

  const { values: form, errors, isValid, setValue, setValues, validateAll } = useFormValidation({
    initialValues: {
      title: '',
      quotationId: '',
      customerId: '',
      amount: '',
      signedDate: '',
      effectiveDate: '',
      expiryDate: '',
      paymentTerms: '',
      deliveryTerms: '',
    },
    rules: { title: required('请输入合同标题') },
  })

  // 带 ?fromQuotationId= 进来：自动打开新建弹窗并预填来源报价；客户/编号由后端从报价继承
  useEffect(() => {
    if (!fromQuotationId || modalOpen || editing) return
    const projName = seedQuotation?.projectName || seedQuotation?.customerShortName || ''
    setValues({
      title: projName ? `${projName} 采购合同` : '',
      quotationId: fromQuotationId,
      customerId: seedQuotation?.customerId || '',
      amount: seedQuotation?.amount != null ? String(seedQuotation.amount) : '',
      signedDate: '',
      effectiveDate: '',
      expiryDate: '',
      paymentTerms: '',
      deliveryTerms: '',
    })
    setModalOpen(true)
    if (!seedQuotation) {
      quotationApi.get(fromQuotationId).then((q: any) => {
        setValues((prev) => ({
          ...prev,
          customerId: q.customerId || prev.customerId,
          amount: q.amount != null ? String(q.amount) : prev.amount,
        }))
      }).catch(() => {})
    }
     
  }, [fromQuotationId])

  useEffect(() => {
    if (!highlightId || !list.length) return
    const highlighted = list.find((item: Contract) => item.id === highlightId)
    if (highlighted) {
      setSelected(highlighted)
      setDrawerOpen(true)
    }
  }, [highlightId, list])

  function openEdit(row: Contract) {
    setEditing(row)
    setValues({
      title: row.title || '',
      quotationId: row.quotationId || '',
      customerId: row.customerId || '',
      amount: String(row.amount || ''),
      signedDate: row.signedDate ? row.signedDate.slice(0, 10) : '',
      effectiveDate: row.effectiveDate ? row.effectiveDate.slice(0, 10) : '',
      expiryDate: row.expiryDate ? row.expiryDate.slice(0, 10) : '',
      paymentTerms: row.paymentTerms || '',
      deliveryTerms: row.deliveryTerms || '',
    })
    setModalOpen(true)
  }

  function openDetail(row: Contract) {
    setSelected(row)
    setDrawerOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const dto: any = {
        title: form.title,
        quotationId: form.quotationId || undefined,
        customerId: form.customerId || undefined,
        amount: Number(form.amount) || 0,
        signedDate: form.signedDate || undefined,
        effectiveDate: form.effectiveDate || undefined,
        expiryDate: form.expiryDate || undefined,
        paymentTerms: form.paymentTerms || undefined,
        deliveryTerms: form.deliveryTerms || undefined,
      }
      return editing ? contractApi.update(editing.id, dto) : contractApi.create(dto)
    },
    onSuccess: () => {
      toast.success(editing ? '合同已更新' : '合同已创建')
      queryClient.invalidateQueries({ queryKey: ['contracts'] })
      setModalOpen(false)
      refetch()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '操作失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => contractApi.remove(id),
    onSuccess: () => {
      toast.success('已删除')
      queryClient.invalidateQueries({ queryKey: ['contracts'] })
      setDeleteId(null)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '删除失败'),
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => contractApi.approve(id),
    onSuccess: () => {
      toast.success('合同已审核通过')
      queryClient.invalidateQueries({ queryKey: ['contracts'] })
      refetch()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '审核失败'),
  })

  // 必须在下面的提前 return 之前调用，否则加载态与正常态的 hook 顺序会对不上
  const { stats, isLoading: statsLoading } = useModuleStats()
  const ct = stats?.contracts
  const contractCards = [
    { label: '合同总数', value: ct?.total ?? 0, icon: ScrollText },
    { label: '已签订', value: ct?.signed ?? 0, icon: FileSignature },
    { label: '执行中', value: ct?.executing ?? 0, icon: Activity },
    { label: '已完成', value: ct?.completed ?? 0, icon: CheckCircle2 },
    { label: '合同总额', value: compactMoney(ct?.totalAmount ?? 0), suffix: '元', icon: DollarSign },
    { label: '质保将到期', value: ct?.warrantyExpiring ?? 0, icon: ShieldAlert, title: '30 天内质保到期的合同' },
  ]

  if (isLoading) {
    // 骨架屏代替整页 spinner：结构与真实页面一致（统计卡+表格），加载有"形状"可预期
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
        <Skeleton className="h-8 w-64 rounded-md" />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 rounded-md" />)}
        </div>
      </div>
    )
  }
  if (isError) return <ErrorState message={(error as any)?.message} onRetry={refetch} />

  const handleSubmit = () => {
    if (!validateAll()) return
    saveMutation.mutate()
  }

  return (
    <>
      {/* 统计卡片：与业务概览顶部同一套组件，各模块高度与配色一致 */}
      <StatCards className="mb-4" loading={statsLoading} skeletonCount={6} items={contractCards} />

      <DataTable
        data={list}
        pagination={pagination}
        columns={[
          { key: 'contractNo', title: '合同编号', sortable: true },
          { key: 'title', title: '合同标题' },
          { key: 'customerShortName', title: '客户', render: (row: any) => row.customerShortName || '—' },
          { key: 'amount', title: '合同金额', sortable: true, render: (row: any) => `¥${Number(row.amount || 0).toLocaleString()}` },
          { key: 'status', title: '状态', sortable: true, render: (row: any) => <StatusBadge status={row.status} label={CONTRACT_STATUS_LABELS[row.status]} /> },
          { key: 'signedDate', title: '签订日期', sortable: true, render: (row: any) => row.signedDate ? new Date(row.signedDate).toLocaleDateString('zh-CN') : '—' },
        ]}
        rowKey={(row) => row.id}
        onRowDoubleClick={(row) => openDetail(row as Contract)}
        onSort={onSort}
        sortKey={sortBy}
        sortDirection={sortOrder === 'ASC' ? 'asc' : sortOrder === 'DESC' ? 'desc' : null}
        widthStorageKey="contracts"
        actions={(row) => (
          <div className="flex items-center gap-1">
            <button onClick={() => openDetail(row as Contract)} className="text-accent-600 hover:text-accent-700" title={"查看"}
            aria-label="查看">
              <Eye size={15} />
            </button>
            {/* 派生下一步：转项目（客户、项目名称、编号由合同自动带出，阶段落在已签约） */}
            <button
              onClick={() => navigate(`/projects?fromContractId=${row.id}`, { state: { contract: row } })}
              className="text-ink-soft hover:text-accent-600"
              aria-label="转项目"
              title="由该合同立项"
            >
              <FolderKanban size={15} />
            </button>
            <button onClick={() => openEdit(row as Contract)} className="text-ink-soft hover:text-ink" title={"编辑"}
            aria-label="编辑">
              <Pencil size={15} />
            </button>
            <button onClick={() => setDeleteId(row.id)} className="text-danger-fg hover:text-danger-fg" title={"删除"}
            aria-label="删除">
              <Trash2 size={15} />
            </button>
          </div>
        )}
        selectedKeys={selectedKeys}
        onSelectionChange={setSelectedKeys}
      />

      {/* 创建/编辑 Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? '编辑合同' : '新建合同'}
        onConfirm={handleSubmit}
        loading={saveMutation.isPending}
        confirmDisabled={!isValid}
        size="lg"
      >
        <FormSection title="基本信息" icon={ScrollText}>
          <FieldGrid cols={2}>
            <FormInput label="合同标题" required value={form.title} error={errors.title} onChange={(e) => setValue('title', e.target.value)} placeholder="如：XX生产线采购合同" />
            <FormInput label="合同金额" value={form.amount} onChange={(e) => setValue('amount', e.target.value)} placeholder="0.00" type="number" />
          </FieldGrid>
          <FieldGrid cols={2}>
            <div>
              <label className="eo-label mb-1 block">关联报价</label>
              <EntityPicker
                queryKey="contract-quotation"
                value={form.quotationId}
                onChange={(id) => setValue('quotationId', id)}
                search={async (kw) => {
                  const res = await quotationApi.list({ keyword: kw, pageSize: 20 })
                  return toList(res).map((q: any) => ({ value: q.id, label: `${q.quotationNo} · ¥${q.amount}`, hint: q.customerShortName }))
                }}
                resolve={async (id) => {
                  const q = await quotationApi.get(id)
                  return { value: q.id, label: q.quotationNo }
                }}
                placeholder="选择报价单（可继承编号）"
              />
            </div>
            <div>
              <label className="eo-label mb-1 block">关联客户</label>
              {/* 客户顺着 合同 → 报价 → 方案 → 需求 带出，只读；后端保存时按关联报价继承 */}
              <FormInput
                value={
                  seedQuotation?.customerShortName ||
                  seedQuotation?.customerName ||
                  (form.customerId ? '已由报价带出（保存后显示名称）' : '')
                }
                readOnly
                placeholder="由关联报价带出"
              />
            </div>
          </FieldGrid>
        </FormSection>

        <FormSection title="日期与条款" icon={DollarSign}>
          <FieldGrid cols={3}>
            <FormInput label="签订日期" type="date" value={form.signedDate} onChange={(e) => setValue('signedDate', e.target.value)} />
            <FormInput label="生效日期" type="date" value={form.effectiveDate} onChange={(e) => setValue('effectiveDate', e.target.value)} />
            <FormInput label="到期日期" type="date" value={form.expiryDate} onChange={(e) => setValue('expiryDate', e.target.value)} />
          </FieldGrid>
          <FormTextarea label="付款条款" rows={2} value={form.paymentTerms} onChange={(e) => setValue('paymentTerms', e.target.value)} placeholder="如：预付30%，发货前付60%，验收后付10%" />
          <FormTextarea label="交付条款" rows={2} value={form.deliveryTerms} onChange={(e) => setValue('deliveryTerms', e.target.value)} placeholder="如：合同签订后90天内交付" />
        </FormSection>

        <FormSection title="合同资料" hint="标记为输入文件(客户提交)或输出文件(我方提交)，同步进客户资料">
          <EntityFileUpload
            entityType="contract"
            entityId={editing?.id}
            entityNo={editing?.contractNo}
            customerId={editing?.customerId || undefined}
            category="合同资料"
          />
        </FormSection>
      </Modal>

      {/* 详情 Drawer */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="合同详情" width="w-[520px]">
        {detailQuery.data && (
          <div className="space-y-4">
            <DetailHeader
              title={detailQuery.data.title || detailQuery.data.contractNo}
              code={detailQuery.data.contractNo}
              badge={<StatusBadge status={detailQuery.data.status} label={CONTRACT_STATUS_LABELS[detailQuery.data.status]} />}
              stats={[
                { label: '合同金额', value: `¥${Number(detailQuery.data.amount || 0).toLocaleString()}` },
                { label: '客户', value: detailQuery.data.customerShortName || '—' },
              ]}
            />
            <DetailSection title="详细信息">
              <DescList items={[
                { label: '合同编号', value: detailQuery.data.contractNo },
                { label: '关联报价', value: (detailQuery.data as any).quotationNo || '—' },
                { label: '签订日期', value: detailQuery.data.signedDate ? new Date(detailQuery.data.signedDate).toLocaleDateString('zh-CN') : '—' },
                { label: '生效日期', value: detailQuery.data.effectiveDate ? new Date(detailQuery.data.effectiveDate).toLocaleDateString('zh-CN') : '—' },
                { label: '到期日期', value: detailQuery.data.expiryDate ? new Date(detailQuery.data.expiryDate).toLocaleDateString('zh-CN') : '—' },
              ]} />
            </DetailSection>
            {detailQuery.data.paymentTerms && (
              <DetailSection title="付款条款">
                <p className="text-sm text-ink-soft whitespace-pre-wrap">{detailQuery.data.paymentTerms}</p>
              </DetailSection>
            )}
            {detailQuery.data.deliveryTerms && (
              <DetailSection title="交付条款">
                <p className="text-sm text-ink-soft whitespace-pre-wrap">{detailQuery.data.deliveryTerms}</p>
              </DetailSection>
            )}
            <ContractPaymentsSection contractId={detailQuery.data.id} />
            <div className="flex gap-2 pt-2 border-t border-border">
              {detailQuery.data.status === 'draft' && (
                <Button variant="secondary" size="sm" loading={approveMutation.isPending} onClick={() => approveMutation.mutate(detailQuery.data!.id)}>
                  审核通过
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => { setDrawerOpen(false); openEdit(detailQuery.data!) }}>
                <Pencil size={14} className="mr-1" /> 编辑
              </Button>
              {detailQuery.data.customerId && (
                <Button variant="ghost" size="sm" onClick={() => navigate(`/customers/${detailQuery.data!.customerId}`)}>
                  查看客户
                </Button>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* 删除确认 */}
      <Modal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="删除合同"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        confirmText="删除"
        loading={deleteMutation.isPending}
      >
        <p className="text-sm text-ink-soft">确定删除该合同吗？此操作不可撤销。</p>
      </Modal>
    </>
  )
}

/** 合同回款台账：应收节点 + 实收登记 + 汇总（合同执行到哪、款收了多少） */
const PAYMENT_NODE_PRESETS = ['首付款', '发货款', '验收款', '质保金']

function ContractPaymentsSection({ contractId }: { contractId?: string }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['contract-payments', contractId],
    queryFn: () => (contractId ? contractApi.getPayments(contractId!) : { list: [], summary: null }),
    enabled: !!contractId,
  })
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ nodeName: '', dueDate: '', dueAmount: '' })
  const [receiving, setReceiving] = useState<any | null>(null)
  const [recv, setRecv] = useState({ receivedAmount: '', receivedDate: '', invoiceNo: '' })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['contract-payments', contractId] })
  const addMutation = useMutation({
    mutationFn: () => contractApi.addPayment(contractId!, {
      nodeName: draft.nodeName,
      dueDate: draft.dueDate || undefined,
      dueAmount: Number(draft.dueAmount || 0),
    }),
    onSuccess: () => {
      invalidate()
      setAdding(false)
      setDraft({ nodeName: '', dueDate: '', dueAmount: '' })
    },
  })
  const receiveMutation = useMutation({
    mutationFn: () => contractApi.updatePayment(contractId!, receiving.id, {
      receivedAmount: Number(recv.receivedAmount || 0),
      receivedDate: recv.receivedDate || undefined,
      invoiceNo: recv.invoiceNo || undefined,
    }),
    onSuccess: () => { invalidate(); setReceiving(null) },
  })
  const removeMutation = useMutation({
    mutationFn: (paymentId: string) => contractApi.removePayment(contractId!, paymentId),
    onSuccess: invalidate,
  })

  const s = data?.summary
  const money = (n: any) => Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  const rows = data?.list ?? []

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-ink">回款台账{rows.length > 0 && ` (${rows.length})`}</h4>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-xs text-accent-600 hover:text-accent-700">
            + 登记应收节点
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : (
        <>
          {s && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 bg-subtle rounded-md px-3 py-2 mb-2 text-caption">
              <span>合同金额 <b className="text-ink">{money(s.contractAmount)}</b></span>
              <span>应收 <b className="text-ink">{money(s.totalDue)}</b></span>
              <span>已收 <b className="text-success-fg">{money(s.totalReceived)}</b></span>
              <span>未收 <b className="text-warning-fg">{money(s.outstanding)}</b></span>
              {s.uncovered > 0 && (
                <span className="text-muted" title="合同金额中尚未建立应收节点的部分">另有 {money(s.uncovered)} 未建节点</span>
              )}
              <span className="ml-auto">回款进度 <b className="text-ink">{s.receivedRatio}%</b></span>
            </div>
          )}
          {adding && (
            <div className="bg-canvas p-2.5 rounded-md flex flex-wrap gap-1.5 mb-2">
              <input list="payment-node-presets" placeholder="节点（如：首付款）" value={draft.nodeName}
                onChange={(e) => setDraft(p => ({ ...p, nodeName: e.target.value }))}
                className="eo-input !py-1 !text-sm w-28" />
              <datalist id="payment-node-presets">
                {PAYMENT_NODE_PRESETS.map(n => <option key={n} value={n} />)}
              </datalist>
              <input type="date" value={draft.dueDate} onChange={(e) => setDraft(p => ({ ...p, dueDate: e.target.value }))} className="eo-input !py-1 !text-sm" />
              <input type="number" min="0" placeholder="应收金额" value={draft.dueAmount}
                onChange={(e) => setDraft(p => ({ ...p, dueAmount: e.target.value }))}
                className="eo-input !py-1 !text-sm w-28" />
              <button onClick={() => addMutation.mutate()} disabled={!draft.nodeName.trim()}
                className="px-2 py-1 text-xs bg-accent-500 text-white rounded disabled:opacity-40">保存</button>
              <button onClick={() => setAdding(false)} className="px-2 py-1 text-xs text-muted">取消</button>
            </div>
          )}
          {rows.length === 0 && !adding ? (
            <p className="text-caption text-muted">尚未登记回款节点——按首付款/发货款/验收款/质保金拆分登记后，这里汇总应收与实收。</p>
          ) : (
            <div className="space-y-1.5">
              {rows.map((p: any) => (
                <div key={p.id}>
                  <div className="flex items-center gap-2 bg-subtle p-2 rounded-md text-caption">
                    <span className="text-ink font-medium w-16 shrink-0">{p.nodeName}</span>
                    <span className="text-muted">应收 {money(p.dueAmount)}{p.dueDate ? ` · ${p.dueDate.slice(0, 10)}` : ''}</span>
                    <span className={Number(p.receivedAmount) > 0 ? 'text-success-fg' : 'text-muted'}>
                      已收 {money(p.receivedAmount)}{p.receivedDate ? ` · ${p.receivedDate.slice(0, 10)}` : ''}
                    </span>
                    {p.invoiceNo && <span className="text-muted">票号 {p.invoiceNo}</span>}
                    <span className="ml-auto flex gap-2 shrink-0">
                      <button onClick={() => { setReceiving(p); setRecv({ receivedAmount: String(p.receivedAmount || ''), receivedDate: p.receivedDate ? p.receivedDate.slice(0, 10) : '', invoiceNo: p.invoiceNo || '' }) }}
                        className="text-accent-600 hover:text-accent-700">收款</button>
                      <button onClick={() => removeMutation.mutate(p.id)} className="text-muted hover:text-danger-fg">
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                  {receiving?.id === p.id && (
                    <div className="bg-canvas p-2 rounded-md flex flex-wrap gap-1.5 mt-1">
                      <input type="number" min="0" placeholder="实收金额" value={recv.receivedAmount}
                        onChange={(e) => setRecv(r => ({ ...r, receivedAmount: e.target.value }))}
                        className="eo-input !py-1 !text-sm w-24" />
                      <input type="date" value={recv.receivedDate}
                        onChange={(e) => setRecv(r => ({ ...r, receivedDate: e.target.value }))}
                        className="eo-input !py-1 !text-sm" />
                      <input placeholder="发票号（可空）" value={recv.invoiceNo}
                        onChange={(e) => setRecv(r => ({ ...r, invoiceNo: e.target.value }))}
                        className="eo-input !py-1 !text-sm flex-1" />
                      <button onClick={() => receiveMutation.mutate()}
                        className="px-2 py-1 text-xs bg-accent-500 text-white rounded">保存</button>
                      <button onClick={() => setReceiving(null)} className="px-2 py-1 text-xs text-muted">取消</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
