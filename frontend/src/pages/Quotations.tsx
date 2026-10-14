import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Search, Sparkles, Eye, Pencil, Trash2, PlusCircle, MinusCircle,
  Printer, Scale, AlertTriangle, DollarSign, ScrollText,
  FileEdit, Send, Trophy, CheckCircle2,
} from 'lucide-react'
import { quotationApi, customerApi, proposalApi, productApi } from '../api/services'
import { useDebounce } from '../hooks/useDebounce'
import { useFormValidation, required } from '../hooks/useFormValidation'
import { usePagedQuery } from '../hooks/usePagedQuery'
import { useModuleStats } from '../hooks/useModuleStats'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'
import { usePageActions } from '../contexts/PageActionsContext'
import StatCards, { compactMoney } from '../components/StatCards'
import type { Quotation, QuotationItem } from '../types'
import Button from '../components/Button'
import Modal from '../components/Modal'
import AttachmentBadge from '../components/AttachmentBadge'
import Drawer from '../components/Drawer'
import FormInput from '../components/FormInput'
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

/** 毛利率低于此值时在详情页告警 */
const MARGIN_ALERT = 15

const initialForm = {
  quotationNo: '',
  // 项目名称的主数据在关联需求上，这里改了会写回去（见 SharedFieldsService）
  projectName: '',
  customerId: '',
  proposalId: '',
  amount: 0,
  notes: '',
  items: [{ name: '', quantity: 1, unitPrice: 0 }] as QuotationItem[],
}

const initialAiForm = {
  customerId: '',
  requirements: '',
}

const handleError = (error: any) => {
  toast.error(error?.response?.data?.message || error?.message || '操作失败')
}

export default function Quotations() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get('highlight') || ''
  // 从方案列表「生成报价」跳来：预填来源方案，客户/项目名称/编号由方案自动带出
  const fromProposalId = searchParams.get('fromProposalId') || ''
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  // 按报价状态过滤（后端列表接口已支持 status 参数）
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
  const [editing, setEditing] = useState<Quotation | null>(null)
  const [selected, setSelected] = useState<Quotation | null>(null)
  const { values: form, isValid, setValue, setValues, validateAll, reset } = useFormValidation({
    initialValues: initialForm,
    // 报价编码由后端继承方案编号自动生成（QUO-007 ← PROP-007），不校验；
    // 但方案、明细必须校验——此前 rules:{} 关掉了全部校验，能存下空方案/空明细/0 元的报价单。
    rules: {
      proposalId: required('请选择来源方案'),
      items: (items: QuotationItem[]) =>
        (items || []).filter((it) => it.name?.trim()).length === 0 ? '至少需要一条明细' : undefined,
    },
  })
  const [aiForm, setAiForm] = useState(initialAiForm)
  const [suggestResult, setSuggestResult] = useState<any>(null)
  // 从报价弹窗内发起的 AI 建议：结果可一键回填到当前明细；页顶入口则仅浏览
  const [adoptMode, setAdoptMode] = useState(false)
  // 来源方案（派生新建时用于只读展示项目名称/客户/关联方案）
  const [derivedProposal, setDerivedProposal] = useState<any>(null)

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
  } = usePagedQuery<Quotation>({
    key: ['quotations'],
    filters: { keyword: debouncedSearch || undefined, status: statusFilter || undefined },
    fetcher: (params) => quotationApi.list(params) as any,
    initialPageSize: 15,
  })

  const detailQuery = useQuery({
    queryKey: ['quotation', selected?.id],
    queryFn: () => (selected?.id ? quotationApi.get(selected.id) : null),
    enabled: !!selected?.id,
  })

  // 后端随详情返回的成本 / 毛利汇总
  const margin = (detailQuery.data as any)?.margin as
    | {
        total: number
        costTotal: number
        grossProfit: number
        grossMargin: number | null
        coveredRatio: number
        itemsWithoutCost: number
      }
    | undefined


  /** 报价明细的产品候选。数量不大，一次取回即可，用 datalist 做本地过滤 */
  const { data: productPick } = useQuery({
    queryKey: ['products-pick'],
    queryFn: () => productApi.list({ pageSize: 200 }),
  })
  const productPickList = toList<any>(productPick)
  /**
   * 候选项: 产品本身 + 型号价格表里的每个型号(「产品名 型号」)。
   * 选型号直接带出该型号的销售价(依次取 销售价/标配价/参考价), 不用再翻价格表。
   */
  const pickOptions = productPickList.flatMap((x: any) => {
    const base = [{ key: x.id, value: x.name, productId: x.id, price: x.price ? Number(x.price) : undefined, hint: x.code || '' }]
    const models = (Array.isArray(x.priceList) ? x.priceList : [])
      .filter((m: any) => m?.model)
      .map((m: any) => ({
        key: `${x.id}:${m.model}`,
        value: `${x.name} ${m.model}`,
        productId: x.id,
        price: Number(m.salePrice ?? m.standardPrice ?? m.referencePrice) || undefined,
        hint: m.spec || '',
      }))
    return [...base, ...models]
  })
  const productById = new Map(productPickList.map((x: any) => [x.id, x]))
  /** 选了产品库里的产品, 但该产品没有型号价格表: 单价只能靠人工, 提示一下 */
  const lacksPriceList = (productId?: string) => {
    const prod: any = productId ? productById.get(productId) : null
    return !!prod && !(Array.isArray(prod.priceList) && prod.priceList.length)
  }

  const { data: proposals } = useQuery({
    queryKey: ['proposals-select'],
    queryFn: () => proposalApi.list(),
  })


  useEffect(() => {
    if (!highlightId || !listData.length) return
    const highlighted = listData.find((item: Quotation) => item.id === highlightId)
    if (highlighted) {
      setSelected(highlighted)
      setDrawerOpen(true)
    }
  }, [highlightId, listData])

  // 带 ?fromProposalId= 进来：自动打开新建弹窗并预填来源方案；客户/编号由后端从方案继承
  useEffect(() => {
    if (!fromProposalId || modalOpen || editing) return
    setEditing(null)
    setValues({
      quotationNo: '',
      projectName: '',
      customerId: '',
      proposalId: fromProposalId,
      amount: 0,
      notes: '',
      items: [{ name: '', quantity: 1, unitPrice: 0 }],
    })
    setModalOpen(true)
    proposalApi.get(fromProposalId).then((p: any) => setDerivedProposal(p)).catch(() => {})
     
  }, [fromProposalId])


  // 客户 195 条、服务端每页只回 20 —— 必须走搜索，不能一次拉全量塞下拉
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

  const saveMutation = useMutation({
    mutationFn: (dto: any) => {
      // 带上读取时的版本号：期间有人改过这张报价，服务器会返回 409 而不是静默覆盖
      if (editing) return quotationApi.update(editing.id, { ...dto, version: (editing as any).version })
      return quotationApi.create(dto)
    },
    onSuccess: () => {
      // 项目名称是四个模块共用的一份，改完要让它们一起重新取数
      for (const k of ['quotations', 'requirements', 'proposals', 'projects']) {
        queryClient.invalidateQueries({ queryKey: [k] })
      }
      closeModal()
      refetch()
    },
    onError: handleError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => quotationApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotations'] })
      setDeleteId(null)
      refetch()
    },
    onError: handleError,
  })

  const suggestMutation = useMutation({
    mutationFn: (dto: any) => quotationApi.suggest(dto),
    onSuccess: (data) => {
      setSuggestResult(data)
    },
    onError: handleError,
  })

  /** 将 AI 建议明细行追加到当前报价单（空行不入内，总金额自动重算） */
  const adoptSuggestedItems = () => {
    const suggested: any[] = suggestResult?.items || []
    if (!suggested.length) return
    setValues((prev) => {
      const kept = prev.items.filter((it) => it.name?.trim())
      const items = [
        ...kept,
        ...suggested.map((it) => ({
          name: it.name || '', specification: it.specification || '',
          quantity: Number(it.quantity) || 1, unitPrice: Number(it.unitPrice) || 0,
          unit: it.unit || '',
        })),
      ] as QuotationItem[]
      const amount = items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0)
      return { ...prev, items, amount }
    })
    toast.success(`已采纳 ${suggested.length} 条 AI 建议明细，请核对后保存`)
    setAiOpen(false)
    setSuggestResult(null)
    setAiForm(initialAiForm)
  }

  /**
   * 打开编辑。
   *
   * 必须先把详情拉全 —— 列表接口**不返回 items**（明细是子表，
   * 列表页用不上就没查）。直接拿列表行填表单的话，明细是一条空行，
   * 用户改个备注一保存，后端先删后插，真实明细就被这条空行replace 掉了。
   * 这不是显示不一致，是数据丢失。
   */
  const openEdit = async (row: Quotation) => {
    setEditing(row)
    setOriginalProjectName((row as any).projectName || '')
    setValues({
      quotationNo: row.quotationNo || '',
      projectName: (row as any).projectName || '',
      customerId: row.customerId || '',
      proposalId: row.proposalId || '',
      amount: row.amount || 0,
      notes: row.notes || '',
      items: [],
    })
    setModalOpen(true)

    try {
      const full: any = await quotationApi.get(row.id)
      setValues((prev) => ({
        ...prev,
        amount: full.amount ?? prev.amount,
        notes: full.notes ?? prev.notes,
        items: full.items?.length ? full.items : [{ name: '', quantity: 1, unitPrice: 0 }],
      }))
    } catch {
      // 拉不到就给一条空行，至少不会拿 undefined 去渲染
      setValues((prev) => ({ ...prev, items: [{ name: '', quantity: 1, unitPrice: 0 }] }))
      toast.error('明细加载失败，请关闭后重试')
    }
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    setDerivedProposal(null)
    reset()
  }

  const openDetail = (row: Quotation) => {
    setSelected(row)
    setDrawerOpen(true)
  }

  const addItem = () => {
    setValues((prev) => ({ ...prev, items: [...prev.items, { name: '', quantity: 1, unitPrice: 0 }] }))
  }

  const updateItem = (idx: number, field: keyof QuotationItem, value: any) => {
    setValues((prev) => {
      const items = [...prev.items]
      items[idx] = { ...items[idx], [field]: value }
      const amount = items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice), 0)
      return { ...prev, items, amount }
    })
  }

  const removeItem = (idx: number) => {
    setValues((prev) => {
      const items = prev.items.filter((_, i) => i !== idx)
      const amount = items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice), 0)
      return { ...prev, items, amount }
    })
  }

  const handleSubmit = () => {
    if (!validateAll()) return
    saveMutation.mutate({
      ...form,
      // 只在用户真改过时才写回，避免用旧值覆盖别处刚改的新值
      projectName: form.projectName !== originalProjectName ? form.projectName : undefined,
      // 空行不入库
      items: form.items.filter((it) => it.name?.trim()),
    })
  }

  const proposalsArray = Array.isArray(proposals) ? proposals : proposals?.list || []
  // 方案的 title 已废弃（项目名称改由需求提供），这里用编号 + 项目名称
  const proposalOptions = proposalsArray.map((p: any) => ({
    value: p.id,
    label: `${p.proposalNo}${p.projectName ? ' · ' + p.projectName : ''}`,
  }))

  const setPageActions = usePageActions()
  useEffect(() => {
    setPageActions(
      <>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            placeholder="搜索编号/客户/方案/需求"
            onChange={(e) => setSearch(e.target.value)}
            className="eo-input !w-60 !pl-8 !py-1 !text-sm"
          />
        </div>
        {/* 状态筛选收到顶栏，与搜索、AI 建议同行展示 */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="eo-input !w-28 !py-1 !text-xs"
          aria-label="按状态筛选"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="pending">待审核</option>
          <option value="approved">已批准</option>
          <option value="sent">已发送</option>
          <option value="won">已成交</option>
          <option value="lost">已失单</option>
        </select>
        {statusFilter && (
          <button onClick={() => setStatusFilter('')} className="text-caption text-muted hover:text-ink transition-colors">
            清除
          </button>
        )}
        <Button variant="secondary" onClick={() => { setAdoptMode(false); setAiOpen(true) }} size="sm" className="!py-1 !text-sm">
          <Sparkles size={13} className="mr-0.5" /> AI建议
        </Button>
        {/* 不再提供空白「新建」——报价统一由方案列表的「生成报价」派生 */}
        {/* 批量操作收到顶栏：选中后才出现，琥珀修改/红色删除一眼可见 */}
        <BatchEditBar
          selectedKeys={selectedKeys}
          onClear={() => setSelectedKeys([])}
          moduleName="报价"
          queryKey={['quotations']}
          updateFn={(id, dto) => quotationApi.update(id, dto)}
          deleteFn={(id) => quotationApi.remove(id)}
          fields={[
            { key: 'status', label: '状态', options: [
              { value: 'draft', label: '草稿' }, { value: 'pending', label: '待审核' },
              { value: 'approved', label: '已审核' }, { value: 'rejected', label: '已驳回' },
            ] },
          ]}
        />
      </>
    )
    return () => setPageActions(null)
     
  }, [statusFilter, selectedKeys])

  useRegisterPageAssistant({
    key: 'quotations',
    label: '报价管理',
    sourceTypes: ['quotation', 'customer', 'product', 'supplier'],
    questions: [
      '本页报价的金额分布是怎样的？',
      '哪些报价还停在草稿或待审批？',
      '本页金额最高的几单分别是哪些客户？',
      '挑一单报价，说明它的成本构成',
      '这些报价里有哪些可以跟进促成交？',
    ],
    context: [
      `页面：报价管理（共 ${pagination?.total ?? listData.length} 单，当前第 ${pagination?.page ?? 1} 页）`,
      '当前页报价清单：',
      ...listData
        .slice(0, 40)
        .map(
          (x: Quotation, i: number) =>
            `${i + 1}. ${x.quotationNo}｜客户 ${(x as any).customer?.name || (x as any).customerName || '—'}｜金额 ${Number(x.amount || 0).toLocaleString('zh-CN')}｜状态 ${x.status || '—'}`,
        ),
    ]
      .filter(Boolean)
      .join('\n'),
  })

  const { stats, isLoading: statsLoading } = useModuleStats()
  const q = stats?.quotations
  const quotationCards = [
    { label: '报价总数', value: q?.total ?? 0, icon: ScrollText },
    { label: '草稿', value: q?.draft ?? 0, icon: FileEdit },
    { label: '已批准', value: q?.approved ?? 0, icon: CheckCircle2 },
    { label: '已发送', value: q?.sent ?? 0, icon: Send },
    { label: '已成交', value: q?.won ?? 0, icon: Trophy },
    { label: '本月报价额', value: compactMoney(q?.monthAmount ?? 0), suffix: '元', icon: DollarSign },
  ]

  return (
    <div>
      <PageHeader title="报价" titleEm="管理" />

      {/* 统计卡片：与业务概览顶部同一套组件，各模块高度与配色一致 */}
      <StatCards className="mb-4" loading={statsLoading} skeletonCount={6} items={quotationCards} />

      {isLoading && !listData.length && <PageLoader />}
      {isError && <ErrorState message={error?.message || '加载失败'} onRetry={refetch} />}
      {!isLoading && !isError && (
        <DataTable
          loading={isLoading}
          data={listData}
          columns={[
            { key: 'quotationNo', title: '报价编码', sortable: true },
            {
              key: 'customerShortName',
              // 客户与项目名称都顺着 报价 → 方案 → 需求 取，三处不会各写各的
              title: '客户名称',
              render: (row: any) =>
                row.customerShortName || <span className="text-warning-fg text-xs">未关联</span>,
            },
            {
              key: 'projectName',
              title: '项目名称',
              render: (row: any) =>
                row.projectName || <span className="text-warning-fg text-xs">未关联方案</span>,
            },
            { key: 'amount', title: '金额', sortable: true, render: (row) => `¥${row.amount?.toLocaleString?.() || row.amount}` },
            { key: 'status', title: '状态', sortable: true, render: (row) => <StatusBadge status={row.status} /> },
            { key: 'createdAt', title: '创建时间', sortable: true, render: (row) => new Date(row.createdAt).toLocaleString() },
          ]}
          rowKey={(row) => row.id}
          onRowDoubleClick={(row) => openDetail(row)}
          pagination={pagination}
          widthStorageKey="quotations"
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
              {/* 派生下一步：转合同（客户、金额、编号由报价自动带出） */}
              <button
                onClick={() => navigate(`/contracts?fromQuotationId=${row.id}`, { state: { quotation: row } })}
                className="text-ink-soft hover:text-accent-600"
                aria-label="转合同"
                title="由该报价转合同"
              >
                <ScrollText size={16} />
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
        title={editing ? '编辑报价' : '新建报价'}
        onConfirm={handleSubmit}
        loading={saveMutation.isPending}
        confirmDisabled={!isValid}
        size="lg"
      >
        <div className="space-y-6">
          <SharedFieldNotice origin="quotation" id={editing?.id} />

          <FormSection title="基本信息" icon={DollarSign}>
            <FieldGrid>
              <FormInput label="报价编码" value={editing?.quotationNo || ''} readOnly placeholder="保存后自动生成（继承方案编号）" />
              <FormInput label="总金额" type="number" value={form.amount} readOnly helper="由下方明细自动汇总" />
            </FieldGrid>
          </FormSection>

          <FormSection title="关联信息" icon={Scale} hint="项目名称与客户四个模块共用一份">
            <FieldGrid>
              <FormInput
                label="项目名称"
                value={editing ? form.projectName : (derivedProposal?.projectName || '')}
                onChange={(e) => setValue('projectName', e.target.value)}
                placeholder={editing ? '' : '由关联方案带出'}
                disabled={!editing}
                helper="在这里改会同步到需求及其下的方案、项目"
              />
              {/* 客户顺着 报价 → 方案 → 需求 带出，只读 */}
              <FormInput
                label="客户名称"
                value={
                  editing
                    ? ((editing as any).customerShortName || (editing as any).customerName || '')
                    : (derivedProposal?.customerShortName || derivedProposal?.customerName || '')
                }
                readOnly
                placeholder="由关联方案带出"
                helper="如需变更请到客户需求页修改"
              />
              <div className="md:col-span-2">
                {/*
                  关联方案只读：报价是由方案派生出来的（编号也继承自它），
                  在这里改等于把这张报价挪到另一单生意下，客户和项目名称会跟着全变。
                  真要换，应该重新从那份方案生成报价。
                */}
                <FormInput
                  label="关联方案"
                  value={
                    (derivedProposal && !editing
                      ? `${derivedProposal.proposalNo}${derivedProposal.projectName ? ' · ' + derivedProposal.projectName : ''}`
                      : proposalOptions.find((o) => o.value === form.proposalId)?.label) ||
                    (form.proposalId ? '（方案已删除）' : '')
                  }
                  readOnly
                  placeholder="由方案列表「生成报价」带入"
                  helper="报价由方案派生，编号也继承自它，不可改挂"
                />
              </div>
            </FieldGrid>
          </FormSection>

          <FormSection
            title="报价明细"
            icon={PlusCircle}
            action={
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setAdoptMode(true)
                    setAiForm({ ...initialAiForm, customerId: form.customerId || '' })
                    setAiOpen(true)
                  }}
                  className="py-1 px-2 text-xs"
                >
                  <Sparkles size={14} className="mr-1" /> AI建议
                </Button>
                <Button type="button" variant="secondary" onClick={addItem} className="py-1 px-2 text-xs">
                  <PlusCircle size={14} className="mr-1" /> 添加行
                </Button>
              </div>
            }
          >
          <div>
            <div className="space-y-2">
              {form.items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-subtle p-2 rounded-md">
                  {/*
                    从产品库选：选中后带出名称和参考单价，并把 productId 存下来。
                    这个引用是产品页「报价记录」的数据来源 —— 没有它，
                    产品库和报价之间就只有一个自由文本的名字，谁也追溯不了谁。
                    仍允许手工输入，临时物料不必先建档。
                  */}
                  <input
                    list={`prod-opts-${idx}`}
                    placeholder="产品名称（可从产品库选）"
                    value={item.name}
                    onChange={(e) => {
                      const picked = pickOptions.find((x) => x.value === e.target.value)
                      updateItem(idx, 'name', e.target.value)
                      updateItem(idx, 'productId', picked?.productId || '')
                      if (picked?.price) updateItem(idx, 'unitPrice', picked.price)
                    }}
                    className="col-span-5 px-2 py-1 border border-border rounded text-sm"
                  />
                  <datalist id={`prod-opts-${idx}`}>
                    {pickOptions.map((x) => (
                      <option key={x.key} value={x.value}>
                        {x.hint ? x.hint + ' · ' : ''}
                        {x.price ? '¥' + x.price.toLocaleString('zh-CN') : ''}
                      </option>
                    ))}
                  </datalist>
                  <input
                    placeholder="数量"
                    type="number"
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                    className="col-span-3 px-2 py-1 border border-border rounded text-sm"
                  />
                  <input
                    placeholder="单价"
                    type="number"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(idx, 'unitPrice', Number(e.target.value))}
                    className="col-span-3 px-2 py-1 border border-border rounded text-sm"
                  />
                  <button onClick={() => removeItem(idx)} className="col-span-1 text-danger-fg hover:text-danger-fg" title={"删除明细"}
                  aria-label="删除明细">
                    <MinusCircle size={18} />
                  </button>
                  {lacksPriceList(item.productId) && (
                    <p className="col-span-12 text-xs text-warning-fg">
                      该产品还没有型号价格表，单价需人工确认；在「产品管理」补上价格表后，这里可直接按型号带出价格。
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
          </FormSection>

          <FormSection title="备注" icon={Printer}>
            <FormTextarea label="" value={form.notes} onChange={(e) => setValue('notes', e.target.value)} rows={3} />
          </FormSection>

          <FormSection title="报价资料" hint="标记为输入文件(客户提交)或输出文件(我方提交)，同步进客户资料">
            <EntityFileUpload
              entityType="quotation"
              entityId={editing?.id}
              entityNo={editing?.quotationNo}
              customerId={(editing as any)?.customerId || undefined}
              category="报价资料"
            />
          </FormSection>
        </div>
      </Modal>

      <Modal
        open={aiOpen}
        onClose={() => {
          setAiOpen(false)
          setSuggestResult(null)
          setAiForm(initialAiForm)
          setAdoptMode(false)
        }}
        title="AI 报价建议"
        onConfirm={() => suggestMutation.mutate(aiForm)}
        loading={suggestMutation.isPending}
        confirmText="获取建议"
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
          />
          <FormTextarea label="客户需求" value={aiForm.requirements} onChange={(e) => setAiForm({ ...aiForm, requirements: e.target.value })} rows={4} />
          {suggestResult && (
            <div className="space-y-3">
              <div className="bg-subtle p-4 rounded-md text-sm whitespace-pre-wrap">
                {typeof suggestResult === 'string' ? suggestResult : (suggestResult.text || JSON.stringify(suggestResult, null, 2))}
              </div>
              {/* 建议明细预览 + 一键回填（仅从报价弹窗内发起时可采纳） */}
              {(suggestResult.items || []).length > 0 && (
                <div className="border border-border rounded-md overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-canvas">
                    <span className="text-xs font-medium text-ink">AI 建议明细行（{suggestResult.items.length}）</span>
                    {adoptMode && (
                      <Button type="button" size="sm" variant="secondary" onClick={adoptSuggestedItems} className="!py-0.5 !text-xs">
                        <PlusCircle size={12} className="mr-1" /> 采纳到报价单
                      </Button>
                    )}
                  </div>
                  <table className="w-full text-xs">
                    <thead className="text-muted bg-canvas">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-medium">品名</th>
                        <th className="text-left px-3 py-1.5 font-medium">规格</th>
                        <th className="text-right px-3 py-1.5 font-medium">数量</th>
                        <th className="text-right px-3 py-1.5 font-medium">单价</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suggestResult.items.map((it: any, i: number) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-3 py-1.5 text-ink">{it.name}</td>
                          <td className="px-3 py-1.5 text-muted">{it.specification || '—'}</td>
                          <td className="px-3 py-1.5 text-right">{it.quantity}{it.unit ? ' ' + it.unit : ''}</td>
                          <td className="px-3 py-1.5 text-right">{Number(it.unitPrice) ? '¥' + Number(it.unitPrice).toLocaleString('zh-CN') : '待定价'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!adoptMode && (
                    <div className="px-3 py-1.5 text-xs text-muted bg-canvas">提示：在报价编辑弹窗的「报价明细」区发起 AI 建议，可一键采纳到报价单</div>
                  )}
                </div>
              )}
            </div>
          )}
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
        <p className="text-sm text-ink-soft">确定要删除该报价吗？删除后无法恢复。</p>
      </Modal>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="报价详情" width="w-[560px]">
        {detailQuery.isLoading ? (
          <PageLoader />
        ) : detailQuery.isError ? (
          <ErrorState message={detailQuery.error?.message || '加载失败'} onRetry={() => detailQuery.refetch()} />
        ) : (
          <div className="space-y-5">
            {/* 同一业务线上的其它单据，点编号直接跳过去 */}
            <RelatedChain origin="quotation" id={selected?.id} currentId={selected?.id} />

            <DetailHeader
              title={(selected as any)?.projectName}
              code={detailQuery.data?.quotationNo}
              badge={<StatusBadge status={detailQuery.data?.status} />}
              stats={[
                {
                  label: '报价金额',
                  value: `¥${detailQuery.data?.amount?.toLocaleString?.('zh-CN') ?? 0}`,
                  emphasis: true,
                },
                { label: '客户', value: (selected as any)?.customerShortName },
              ]}
            />

            <DetailSection title="基本信息">
              <DescList
                items={[
                  {
                    label: '关联方案',
                    // 方案的 title 已废弃并清空，只能用编码 + 项目名称
                    value:
                      (detailQuery.data as any)?.proposal?.proposalNo ||
                      proposalOptions.find((o) => o.value === (detailQuery.data as any)?.proposalId)?.label,
                  },
                  { label: '明细行数', value: detailQuery.data?.items?.length ?? 0 },
                  { label: '备注', value: detailQuery.data?.notes, full: true },
                ]}
              />
            </DetailSection>

            {/* 成本与毛利：只覆盖填了成本的明细行，覆盖率低时明确提示，避免误读 */}
            {margin && margin.costTotal > 0 && (
              <div className="rounded-md p-4 ring-1 ring-inset ring-border">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="eo-label mb-1">总成本</div>
                    <div className="eo-num text-body text-ink">¥{margin.costTotal.toLocaleString('zh-CN')}</div>
                  </div>
                  <div>
                    <div className="eo-label mb-1">毛利</div>
                    <div className="eo-num text-body text-ink">¥{margin.grossProfit.toLocaleString('zh-CN')}</div>
                  </div>
                  <div>
                    <div className="eo-label mb-1">毛利率</div>
                    <div
                      className={`eo-num text-body font-semibold ${
                        margin.grossMargin == null
                          ? 'text-muted'
                          : margin.grossMargin < MARGIN_ALERT
                            ? 'text-danger-fg'
                            : 'text-success-fg'
                      }`}
                    >
                      {margin.grossMargin == null ? '-' : `${margin.grossMargin}%`}
                    </div>
                  </div>
                </div>
                {margin.coveredRatio < 100 && (
                  <p className="mt-2 flex items-start gap-1.5 text-caption text-warning-fg">
                    <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                    毛利率仅覆盖 {margin.coveredRatio}% 的报价金额，还有 {margin.itemsWithoutCost} 行未填成本
                  </p>
                )}
                {margin.grossMargin != null && margin.grossMargin < MARGIN_ALERT && (
                  <p className="mt-1 flex items-start gap-1.5 text-caption text-danger-fg">
                    <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                    毛利率低于 {MARGIN_ALERT}%，提交前请复核
                  </p>
                )}
              </div>
            )}

            {/* 历史版本：每次修改自动存档，审计与客户对账可回放 */}
            <QuotationVersionsSection quotationId={selected?.id} />

            <div>
              <h4 className="text-sm font-semibold text-ink mb-2">明细项</h4>
              {(detailQuery.data?.items || []).length === 0 ? (
                <p className="text-sm text-muted">暂无明细</p>
              ) : (
                <div className="eo-scroll-x">
                  <table className="w-full text-body-sm">
                    <thead>
                      <tr className="border-b border-border bg-subtle">
                        <th className="eo-th text-left py-2 px-2">名称 / 规格</th>
                        <th className="eo-th text-right py-2 px-2">数量</th>
                        <th className="eo-th text-right py-2 px-2">单价</th>
                        <th className="eo-th text-right py-2 px-2">小计</th>
                        <th className="eo-th text-left py-2 px-2">供应商</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detailQuery.data?.items || []).map((it: any, idx: number) => (
                        <tr key={idx} className="border-b border-divider last:border-0">
                          <td className="py-2 px-2">
                            <div className="text-ink">{it.name}</div>
                            {it.specification && (
                              <div className="text-caption text-muted">{it.specification}</div>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right eo-num">{it.quantity}</td>
                          <td className="py-2 px-2 text-right eo-num">
                            ¥{Number(it.unitPrice).toLocaleString('zh-CN')}
                          </td>
                          <td className="py-2 px-2 text-right eo-num">
                            ¥{Number(it.totalPrice ?? it.quantity * it.unitPrice).toLocaleString('zh-CN')}
                          </td>
                          <td className="py-2 px-2 text-label text-muted">
                            {it.supplierName || '-'}
                            {it.cost != null && (
                              <div className="text-caption">成本 ¥{Number(it.cost).toLocaleString('zh-CN')}</div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => navigate('/suppliers/compare')}
              >
                <Scale size={15} className="mr-1" /> 查供应商比价
              </Button>
              <a
                href={`${import.meta.env.VITE_API_BASE_URL || '/api'}/quotations/${detailQuery.data?.id}/print`}
                target="_blank"
                rel="noreferrer"
                className="flex-1"
              >
                <Button className="w-full">
                  <Printer size={15} className="mr-1" /> 打印 / 导出 PDF
                </Button>
              </a>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}

/** 历史版本区：每次修改自动存档（头字段 + 明细），可展开核对每一版金额 */
function QuotationVersionsSection({ quotationId }: { quotationId?: string }) {
  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['quotation-versions', quotationId],
    queryFn: () => (quotationId ? quotationApi.getVersions(quotationId) : []),
    enabled: !!quotationId,
  })
  const [expanded, setExpanded] = useState<string | null>(null)

  if (isLoading) return null
  if (versions.length === 0) return null // 从未修改过的报价不显示该区块

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <h4 className="text-sm font-semibold text-ink mb-2">历史版本 ({versions.length})</h4>
      <div className="space-y-1.5">
        {versions.map((v: any) => (
          <div key={v.id} className="bg-subtle rounded-md">
            <button
              onClick={() => setExpanded(expanded === v.id ? null : v.id)}
              className="w-full flex items-center gap-3 p-2 text-caption text-left"
            >
              <span className="text-ink font-medium">v{v.version}</span>
              <span className="text-muted">金额 ¥{Number(v.snapshot?.amount || 0).toLocaleString('zh-CN')}</span>
              <span className="text-muted">{v.snapshot?.items?.length ?? v.items?.length ?? 0} 行明细</span>
              <span className="ml-auto text-muted">{new Date(v.createdAt).toLocaleString('zh-CN')}</span>
            </button>
            {expanded === v.id && (
              <div className="px-2 pb-2 space-y-1">
                {(v.items || []).map((it: any, i: number) => (
                  <div key={i} className="flex gap-2 text-caption text-muted">
                    <span className="flex-1 truncate">{it.name}</span>
                    <span>{Number(it.quantity || 0)} × ¥{Number(it.unitPrice || 0).toLocaleString('zh-CN')}</span>
                    <span className="text-ink">¥{Number(it.totalPrice || 0).toLocaleString('zh-CN')}</span>
                  </div>
                ))}
                {v.snapshot?.notes && <p className="text-caption text-muted pt-1">备注：{v.snapshot.notes}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-caption text-muted mt-1.5">修改报价时系统自动存档被覆盖的版本；已送审/已审核的修改会退回待审重新走审批。</p>
    </div>
  )
}

