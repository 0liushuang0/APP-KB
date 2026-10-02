import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Search,
  FileText,
  Download,
  FolderOpen,
  ExternalLink,
  Scan,
  Upload,
  Link2,
  Building2,
  ChevronRight,
  ChevronDown,
} from 'lucide-react'
import { customerApi, documentApi } from '../api/services'
import { downloadFile } from '../api/files'
import { usePageActions } from '../contexts/PageActionsContext'
import { useModuleStats } from '../hooks/useModuleStats'
import { useDebounce } from '../hooks/useDebounce'
import { usePagedQuery } from '../hooks/usePagedQuery'
import { useResizablePanel, ResizeHandle } from '../hooks/useResizablePanel'
import { useNavPageSize, clampNavPage } from '../hooks/useNavPageSize'
import type { Document } from '../types'
import StatCards from '../components/StatCards'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import EmptyState from '../components/EmptyState'
import FilePreview from '../components/FilePreview'
import NavPager from '../components/NavPager'
import BatchEditBar from '../components/BatchEditBar'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'

const stageLabels: Record<string, string> = {
  raw: '原始资料',
  requirement: '需求文件',
  analysis: '分析文档',
  solution: '技术方案',
  quotation: '报价文件',
  contract: '合同协议',
  // 项目 dealStage 值
  requirement_registered: '需求登记',
  requirement_analyzed: '需求识别',
  solution_drafting: '方案编制',
  quotation_drafting: '报价编制',
  quotation_reviewed: '报价审核',
  submitted: '已提交客户',
  contract_signed: '已签合同',
  won: '已成交',
  lost: '已流失',
  // 其他常见来源
  需求资料: '需求资料',
  方案资料: '方案资料',
  报价资料: '报价资料',
  合同资料: '合同资料',
  项目资料: '项目资料',
  售后资料: '售后资料',
}

const categoryLabels: Record<string, string> = {
  raw_material: '原始资料',
  requirement_spec: '需求规格',
  cad_drawing: 'CAD图纸',
  tech_agreement: '技术协议',
  bid_doc: '标书',
  quotation: '报价单',
  contract: '合同',
  需求资料: '需求资料',
  other: '其他',
}

const formatSize = (bytes?: number) => {
  if (!bytes) return '-'
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`
}

/*
 * 阶段分桶：库里 stage 有三代历史值（DocStage 六类、项目 dealStage、中文阶段名），
 * 统一归一到「需求 → 售后」的业务阶段，左侧导航与右侧筛选共用同一套桶。
 */
const STAGE_BUCKETS = [
  { key: 'requirement', label: '需求管理' },
  { key: 'analysis', label: '分析文档' },
  { key: 'solution', label: '技术方案' },
  { key: 'quotation', label: '报价管理' },
  { key: 'contract', label: '合同管理' },
  { key: 'project', label: '项目管理' },
  { key: 'aftersales', label: '售后管理' },
  { key: 'raw', label: '原始资料' },
  { key: 'other', label: '其他' },
]

function bucketOf(stage?: string): string {
  const s = stage || ''
  if (/requirement|需求/.test(s)) return 'requirement'
  if (/analysis|分析/.test(s)) return 'analysis'
  if (/solution|方案/.test(s)) return 'solution'
  if (/quotation|报价/.test(s)) return 'quotation'
  if (/contract|合同/.test(s)) return 'contract'
  if (/售后|ticket/.test(s)) return 'aftersales'
  if (/项目|project|submitted|won|lost|registered|drafting|reviewed|signed/.test(s)) return 'project'
  if (/raw|原始/.test(s)) return 'raw'
  return 'other'
}

/** 把一家公司的原始 stage 计数汇总到业务阶段桶 */
function bucketCounts(stages: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [stage, cnt] of Object.entries(stages || {})) {
    const b = bucketOf(stage)
    out[b] = (out[b] || 0) + Number(cnt)
  }
  return out
}

export default function CustomerDocs() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setPageActions = usePageActions()
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [customerId, setCustomerId] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  // 右侧资料列表批量选择（全部视图与客户视图共用一份，键是资料 id）
  const [docSelected, setDocSelected] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // 左侧公司导航页码：全部公司翻页显示，搜索时回到第 1 页
  const [navPage, setNavPage] = useState(1)
  /** 用户是否主动选过（含点「全部」）；选过后再翻页/搜索不抢回第一家公司 */
  const hasPickedRef = useRef(false)
  // 预览中的文件
  const [previewDoc, setPreviewDoc] = useState<{ id: string; fileName: string; mimeType?: string; fileSize?: number } | null>(null)

  // 左侧导航可拖拽调宽（宽度存本地，与产品管理/知识资料同一套组件）
  const navPanel = useResizablePanel('aikb-nav-width-customer-docs', 280)
  /*
   * 每页公司数按**实测**可用高度算。
   *
   * 原来是估算（视口高 - 固定 reserve 230 - 估计行高 76），1080p 下只能算出
   * 五六家，下面留一大片空白。改成量 navListRef 到视口底部的真实距离，
   * 全屏、窗口缩放、统计卡换行都会自动重算。
   *
   * rowHeight 也从 76 调到 34：76 是"公司 + 展开后的阶段行"加起来的高度，
   * 但阶段行只有展开那一家才有，按它算等于永远按最坏情况留空间。
   */
  const navListRef = useRef<HTMLDivElement>(null)
  const navPageSize = useNavPageSize({ rowHeight: 34, min: 5, containerRef: navListRef })

  // 顶栏搜索：筛选左侧公司列表（默认只显示前 10 家，其余靠搜索找）
  useEffect(() => {
    setPageActions(
      <>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          {/* 非受控：受控 value 在 IME 组字时被回写打断（拼音乱码），搜索只靠 onChange */}
          <input
            placeholder="搜索公司…"
            onChange={(e) => setSearch(e.target.value)}
            className="eo-input !w-60 !pl-8 !py-1 !text-sm"
          />
        </div>
        {/* 批量操作收到顶栏：右侧列表勾选后才出现。
            本页文件只读：只提供批量修改分类，不提供批量删除 ——
            删除需回上传源头页面执行（需求页上传的到需求页删，以此类推）。
            客户视图的数据在 ['customer-360'] 里，包装一层同步刷新 */}
        <BatchEditBar
          selectedKeys={docSelected}
          onClear={() => setDocSelected([])}
          moduleName="资料"
          queryKey={['customer-docs-all']}
          updateFn={async (id, dto) => {
            const r = await documentApi.update(id, dto)
            queryClient.invalidateQueries({ queryKey: ['customer-360'] })
            return r
          }}
          fields={[
            { key: 'category', label: '所属分类', options: Object.entries(categoryLabels).map(([value, label]) => ({ value, label })) },
          ]}
        />
      </>
    )
    return () => setPageActions(null)
       
  }, [docSelected])

  // 左侧导航数据：一页客户 + 各家分阶段资料条数（一次请求，支持翻页）
  const overviewQuery = useQuery({
    queryKey: ['customer-doc-overview', debouncedSearch, navPage, navPageSize],
    queryFn: () =>
      customerApi.docOverview({ keyword: debouncedSearch || undefined, limit: navPageSize, page: navPage }),
    /*
     * 翻页时保留上一页的数据。
     *
     * 页码进了 queryKey，不留住旧数据的话点「下一页」这一瞬间 data 是 undefined，
     * total 归 0 → navTotalPages 算成 1 → 下面的 clamp 立刻把页码打回第 1 页，
     * 表现就是"点下一页又自己弹回第一页"。
     */
    placeholderData: keepPreviousData,
  })
  const overview: any = overviewQuery.data || {}
  const overviewCustomers: any[] = overview.customers || []
  const navTotalPages = Math.max(1, Math.ceil((overview.total || 0) / navPageSize))

  // 搜索词变化回到第 1 页；每页条数/总数变化时把页码收敛回合法区间
  useEffect(() => { setNavPage(1) }, [debouncedSearch])
  useEffect(() => {
    // 总数还没拿到（首次加载）时别收敛：那会儿 navTotalPages 只是个占位的 1
    if (!overviewQuery.data) return
    setNavPage((p) => clampNavPage(p, navTotalPages))
  }, [navTotalPages, overviewQuery.data])

  // 首次加载后默认选中第一家公司，右侧不至于空着；用户主动选过后不再抢选
  useEffect(() => {
    if (!hasPickedRef.current && overviewCustomers.length > 0) {
      hasPickedRef.current = true
      setCustomerId(overviewCustomers[0].id)
    }
     
  }, [overviewCustomers.length])

  // 「全部」视图：所有客户资料（scope=customer 与列表口径一致），服务端分页
  const allDocsQuery = usePagedQuery<Document>({
    key: ['customer-docs-all'],
    filters: { scope: 'customer' },
    fetcher: (p) => documentApi.list(p) as any,
    initialPageSize: 15,
    enabled: !customerId,
  })
  const allDocsTotalPages = Math.max(1, Math.ceil(allDocsQuery.total / allDocsQuery.pageSize))

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['customer-360', customerId],
    queryFn: () => customerApi.get360(customerId),
    enabled: !!customerId,
  })

  const { stats, isLoading: statsLoading } = useModuleStats()

  const d: any = data || {}
  const documents: any[] = d.documents || []
  const visibleDocs = stageFilter ? documents.filter((x: any) => bucketOf(x.stage) === stageFilter) : documents

  /*
   * 页面助手上下文。
   *
   * 这一页是「按客户看资料」，所以上下文的主语必须是当前选中的那家客户 ——
   * 只列文件名而不说清是谁家的，助手答出来的东西对不上用户眼前看到的。
   */
  useRegisterPageAssistant({
    key: 'customer-docs',
    label: '客户资料',
    sourceTypes: ['document', 'customer', 'requirement', 'proposal', 'quotation', 'contract'],
    questions: [
      '这家客户的资料齐全吗？还缺哪些阶段的？',
      '按业务阶段看，资料是怎么分布的？',
      '这家客户最近提交了哪些资料？',
      '哪些客户的资料明显偏少？',
      '挑一份资料，说明它属于哪个环节',
    ],
    context: (() => {
      const cust = d.customer?.name || overviewCustomers.find((c: any) => c.id === customerId)?.name
      const lines = [
        `页面：客户资料（共 ${overview.total ?? overviewCustomers.length} 家客户有资料）`,
        cust ? `当前选中客户：${cust}` : '当前视图：全部客户资料',
        stageFilter ? `阶段筛选：${stageFilter}` : '',
        search ? `搜索关键词：${search}` : '',
      ]
      if (customerId && visibleDocs.length) {
        lines.push(`该客户资料清单（${visibleDocs.length} 份）：`)
        lines.push(
          ...visibleDocs
            .slice(0, 40)
            .map(
              (x: any, i: number) =>
                `${i + 1}. ${x.title || x.fileName || '—'}｜阶段 ${x.stage || '—'}｜状态 ${x.status || '—'}`,
            ),
        )
      } else if (!customerId) {
        lines.push('客户清单（按资料数）：')
        lines.push(
          ...overviewCustomers
            .slice(0, 40)
            .map((c: any, i: number) => `${i + 1}. ${c.name}｜资料 ${c.docCount ?? c.count ?? 0} 份`),
        )
      }
      return lines.filter(Boolean).join('\n')
    })(),
  })

  const selectAll = () => {
    hasPickedRef.current = true
    setCustomerId('')
    setStageFilter('')
  }
  const selectCustomer = (id: string) => {
    hasPickedRef.current = true
    setCustomerId(id)
    setStageFilter('')
    setExpanded((prev) => ({ ...prev, [id]: true }))
  }
  const selectStage = (id: string, bucketKey: string) => {
    setCustomerId(id)
    setStageFilter(bucketKey)
  }
  const toggleExpand = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

  const reqById = new Map<string, any>((d.requirements || []).map((r: any) => [r.id, r]))
  const propById = new Map<string, any>((d.proposals || []).map((p: any) => [p.id, p]))
  const quoById = new Map<string, any>((d.quotations || []).map((q: any) => [q.id, q]))
  const projById = new Map<string, any>((d.projects || []).map((p: any) => [p.id, p]))
  const conById = new Map<string, any>((d.contracts || []).map((c: any) => [c.id, c]))

  const sourceOf = (link: any): { kind: string; label: string; path?: string } => {
    if (link.requirementId) {
      const r = reqById.get(link.requirementId)
      return { kind: '客户需求', label: r ? `${r.requirementNo} ${r.title || ''}`.trim() : '需求', path: `/requirements/${link.requirementId}` }
    }
    if (link.proposalId) {
      const p = propById.get(link.proposalId)
      return { kind: '技术方案', label: p?.proposalNo || '方案', path: `/proposals` }
    }
    if (link.quotationId) {
      const q = quoById.get(link.quotationId)
      return { kind: '报价', label: q?.quotationNo || '报价', path: `/quotations` }
    }
    if (link.projectId) {
      const p = projById.get(link.projectId)
      return { kind: '项目', label: p ? `${p.projectNo} ${p.name || ''}`.trim() : '项目', path: `/projects` }
    }
    if (link.contractId) {
      const c = conById.get(link.contractId)
      return { kind: '合同', label: c?.contractNo || '合同', path: `/contracts` }
    }
    return { kind: '客户档案', label: '客户档案' }
  }

  const kindColor: Record<string, string> = {
    客户需求: 'bg-accent-50 text-accent-700 border-accent-200',
    技术方案: 'bg-warning-bg text-warning-fg border-warning-line',
    报价: 'bg-info-bg text-info-fg border-info-line',
    项目: 'bg-success-bg text-success-fg border-success-line',
    合同: 'bg-danger-bg text-danger-fg border-danger-line',
    客户档案: 'bg-canvas text-ink-soft border-border',
  }

  const roleLabel = (r?: string) => (r === 'deliverable' ? '输出资料' : r === 'reference' ? '参考' : '输入资料')
  const roleColor = (r?: string) =>
    r === 'deliverable'
      ? 'bg-success-bg text-success-fg border-success-line'
      : r === 'reference'
        ? 'bg-canvas text-ink-soft border-border'
        : 'bg-info-bg text-info-fg border-info-line'

  /*
   * 未选客户时给全局口径（库里一共多少客户资料），选了客户就切成这家客户的明细 ——
   * 卡片始终描述"下面正在看的内容"，不然选了客户还显示全局数字会让人以为筛选没生效。
   */
  const docCards = customerId
    ? [
        { label: '资料总数', value: documents.length, icon: FolderOpen },
        {
          label: '输入资料',
          value: documents.filter((x: any) => (x.role || 'input') === 'input').length,
          icon: Download,
        },
        {
          label: '输出资料',
          value: documents.filter((x: any) => x.role === 'deliverable').length,
          icon: Upload,
        },
        {
          label: '关联单据',
          value: new Set(
            documents
              .map(
                (x: any) =>
                  x.requirementId || x.proposalId || x.quotationId || x.projectId || x.contractId,
              )
              .filter(Boolean),
          ).size,
          icon: Link2,
        },
      ]
    : [
        { label: '客户资料总数', value: stats?.documents.customer.total ?? 0, icon: FolderOpen },
        { label: '涉及客户', value: stats?.documents.customer.customers ?? 0, icon: Building2 },
        { label: '本月新增', value: stats?.documents.customer.newThisMonth ?? 0, icon: Upload },
      ]

  const stageFilterLabel = STAGE_BUCKETS.find((b) => b.key === stageFilter)?.label

  return (
    <div className="space-y-4">
      {/* 统计卡片横跨整行，与知识资料/产品管理一致 */}
      <StatCards loading={!customerId && statsLoading} skeletonCount={3} items={docCards} />

      {/*
        左右布局对齐知识资料：导航与内容之间 gap-4、导航独立成卡片。
        原来是 gap-0 + border-r，两列贴在一起没有间距。
      */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* ===================== 左侧：全部 → 公司 → 阶段 导航 ===================== */}
        <aside className="lg:w-[280px] flex-shrink-0" style={navPanel.panelStyle}>
          <div className="eo-card p-3 lg:sticky lg:top-4">
            {/* ref 用于实测可用高度，决定每页显示几家公司（见 useNavPageSize） */}
            <div ref={navListRef} className="space-y-0.5">
              {/* 全部：所有公司的客户资料汇总 */}
              <button
                onClick={selectAll}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-body-sm transition-colors ${
                  !customerId ? 'bg-accent-50 text-accent-700 font-medium' : 'text-ink-soft hover:bg-canvas'
                }`}
              >
                <span>全部</span>
                <span className="text-caption text-muted shrink-0">{stats?.documents.customer.total ?? 0}</span>
              </button>

              {overviewQuery.isLoading && <div className="py-6"><PageLoader /></div>}
              {overviewQuery.isError && (
                <ErrorState message={(overviewQuery.error as any)?.message} onRetry={() => overviewQuery.refetch()} />
              )}
              {!overviewQuery.isLoading && !overviewQuery.isError && overviewCustomers.length === 0 && (
                <div className="text-center py-6 text-sm text-muted">
                  {debouncedSearch ? '未找到匹配的公司' : '暂无客户'}
                </div>
              )}
              {overviewCustomers.map((cust: any) => {
                const counts = bucketCounts(cust.stages)
                const bucketEntries = STAGE_BUCKETS.filter((b) => (counts[b.key] || 0) > 0)
                const isSelected = customerId === cust.id
                const isOpen = !!expanded[cust.id]
                return (
                  <div key={cust.id}>
                    <div className={`flex items-center rounded-md transition-colors ${isSelected && !stageFilter ? 'bg-accent-50' : 'hover:bg-canvas'}`}>
                      <button
                        onClick={() => toggleExpand(cust.id)}
                        className="w-6 h-8 flex items-center justify-center text-muted shrink-0"
                        title={isOpen ? '收起阶段' : '展开阶段'}
                      >
                        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                      <button
                        onClick={() => selectCustomer(cust.id)}
                        className={`flex-1 min-w-0 flex items-center justify-between gap-1 px-1 py-1.5 text-left ${
                          isSelected ? 'text-accent-700 font-medium' : 'text-ink-soft'
                        }`}
                        title={cust.name}
                      >
                        <span className="truncate text-body-sm">{cust.name}</span>
                        <span className="text-caption text-muted shrink-0">{cust.docTotal || 0}</span>
                      </button>
                    </div>
                    {isOpen && (
                      <div className="ml-6 border-l border-border pl-1.5 space-y-0.5 mb-1">
                        {bucketEntries.length === 0 && (
                          <p className="text-caption text-muted px-2 py-1">暂无往来资料</p>
                        )}
                        {bucketEntries.map((b) => (
                          <button
                            key={b.key}
                            onClick={() => selectStage(cust.id, b.key)}
                            className={`w-full flex items-center justify-between px-2 py-1 rounded text-xs transition-colors ${
                              isSelected && stageFilter === b.key
                                ? 'bg-accent-50 text-accent-700 font-medium'
                                : 'text-muted hover:bg-canvas hover:text-ink-soft'
                            }`}
                          >
                            <span>{b.label}</span>
                            <span>{counts[b.key]}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* 公司翻页：全部公司都能翻到，也可以用顶栏搜索直达 */}
            <NavPager page={navPage} totalPages={navTotalPages} onChange={setNavPage} label="公司" />
          </div>
        </aside>
        <ResizeHandle onMouseDown={navPanel.startDrag} />

        {/* ===================== 右侧：「全部」资料列表 / 客户明细 ===================== */}
        <div className="flex-1 min-w-0">
          {!customerId ? (
            <>
              {/* 汇总条：与选中客户时的头部同一套观感 */}
              <div className="flex items-center gap-3 text-sm flex-wrap mb-3">
                <span className="font-medium text-ink">全部客户资料</span>
                <span className="text-muted">
                  共 {allDocsQuery.total} 份 · 涉及 {stats?.documents.customer.customers ?? 0} 家客户
                </span>
              </div>
              {allDocsQuery.isLoading ? (
                <PageLoader />
              ) : allDocsQuery.isError ? (
                <ErrorState message={(allDocsQuery.error as any)?.message} onRetry={() => allDocsQuery.refetch()} />
              ) : allDocsQuery.list.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="暂无客户资料"
                  description="在需求、方案、报价、合同等编辑窗口中上传资料后会自动汇总到这里"
                />
              ) : (
                <>
                  <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
                    <div className="overflow-x-auto eo-scroll-x">
                      <table className="w-full text-sm">
                        <thead className="bg-canvas text-xs text-muted">
                          <tr>
                            {/* 全选：勾当前页全部资料 */}
                            <th className="w-10 px-3 py-3">
                              <input
                                type="checkbox"
                                className="rounded border-border"
                                aria-label="全选当前页资料"
                                checked={allDocsQuery.list.length > 0 && allDocsQuery.list.every((d) => docSelected.includes(d.id))}
                                onChange={(e) => {
                                  const ids = allDocsQuery.list.map((d) => d.id)
                                  setDocSelected(
                                    e.target.checked
                                      ? [...new Set([...docSelected, ...ids])]
                                      : docSelected.filter((id) => !ids.includes(id)),
                                  )
                                }}
                              />
                            </th>
                            <th className="text-left px-4 py-3 font-medium whitespace-nowrap">文件</th>
                            <th className="text-left px-4 py-3 font-medium whitespace-nowrap">类型</th>
                            <th className="text-left px-4 py-3 font-medium whitespace-nowrap">大小</th>
                            <th className="text-left px-4 py-3 font-medium whitespace-nowrap">上传人</th>
                            <th className="text-left px-4 py-3 font-medium whitespace-nowrap">时间</th>
                            <th className="text-right px-4 py-3 font-medium whitespace-nowrap">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allDocsQuery.list.map((doc) => (
                            <tr key={doc.id} className={`border-t border-border hover:bg-canvas/50 transition-colors ${docSelected.includes(doc.id) ? 'bg-accent-50/60' : ''}`}>
                              <td className="px-3 py-3 w-10">
                                <input
                                  type="checkbox"
                                  className="rounded border-border"
                                  aria-label={`选择「${doc.title || doc.fileName}」`}
                                  checked={docSelected.includes(doc.id)}
                                  onChange={(e) =>
                                    setDocSelected(
                                      e.target.checked
                                        ? [...docSelected, doc.id]
                                        : docSelected.filter((id) => id !== doc.id),
                                    )
                                  }
                                />
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileText size={15} className="text-accent-600 shrink-0" />
                                  <span className="text-ink truncate" title={doc.fileName}>
                                    {doc.title || doc.fileName}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                                {categoryLabels[doc.category || ''] || doc.category || '—'}
                              </td>
                              <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">{formatSize(doc.fileSize)}</td>
                              <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">{doc.uploader?.nickname || '—'}</td>
                              <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                                {doc.createdAt ? new Date(doc.createdAt).toLocaleString('zh-CN') : '—'}
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() =>
                                      setPreviewDoc({
                                        id: doc.id,
                                        fileName: doc.fileName || 'preview',
                                        mimeType: doc.mimeType,
                                        fileSize: doc.fileSize,
                                      })
                                    }
                                    className="text-muted hover:text-accent-600"
                                    aria-label="预览"
                                    title="预览"
                                  >
                                    <Scan size={16} />
                                  </button>
                                  <button
                                    onClick={() =>
                                      downloadFile('documents', doc.id, doc.fileName).catch((e: any) =>
                                        toast.error(e?.message || '下载失败'),
                                      )
                                    }
                                    className="text-muted hover:text-accent-600"
                                    aria-label="下载"
                                    title="下载"
                                  >
                                    <Download size={16} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {/* 分页 */}
                  {allDocsTotalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-3 text-sm">
                      <button
                        onClick={() => allDocsQuery.setPage(Math.max(1, allDocsQuery.page - 1))}
                        disabled={allDocsQuery.page <= 1}
                        className="px-3 py-1 rounded border border-border text-muted hover:text-ink hover:bg-canvas disabled:opacity-40"
                      >
                        上一页
                      </button>
                      <span className="text-muted">{allDocsQuery.page} / {allDocsTotalPages}</span>
                      <button
                        onClick={() => allDocsQuery.setPage(Math.min(allDocsTotalPages, allDocsQuery.page + 1))}
                        disabled={allDocsQuery.page >= allDocsTotalPages}
                        className="px-3 py-1 rounded border border-border text-muted hover:text-ink hover:bg-canvas disabled:opacity-40"
                      >
                        下一页
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          ) : isLoading ? (
            <PageLoader />
          ) : isError ? (
            <ErrorState message={(error as any)?.message} onRetry={refetch} />
          ) : (
            <>
              {/* 汇总条 */}
              <div className="flex items-center gap-3 text-sm flex-wrap mb-3">
                <span className="font-medium text-ink">{d.customer?.name}</span>
                <span className="text-muted">
                  {stageFilter ? `${stageFilterLabel} ${visibleDocs.length} 份 / 共 ${documents.length} 份` : `共 ${documents.length} 份资料`}
                </span>
                {stageFilter && (
                  <button
                    onClick={() => setStageFilter('')}
                    className="text-xs text-accent-600 hover:text-accent-700"
                  >
                    清除阶段筛选 ×
                  </button>
                )}
                <button
                  onClick={() => navigate(`/customers/${customerId}?tab=documents`)}
                  className="ml-auto text-accent-600 hover:text-accent-700 flex items-center gap-1 text-xs"
                >
                  在客户 360 中查看 <ExternalLink size={12} />
                </button>
              </div>

              {visibleDocs.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title={stageFilter ? `该环节暂无资料` : '该客户暂无往来资料'}
                  description={
                    stageFilter
                      ? '换其他阶段看看，或清除筛选查看全部资料'
                      : '在需求、方案、报价、合同等编辑窗口中上传资料后会自动汇总到这里'
                  }
                />
              ) : (
                <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
                  <div className="overflow-x-auto eo-scroll-x">
                    <table className="w-full text-sm">
                      <thead className="bg-canvas text-xs text-muted">
                        <tr>
                          {/* 全选：勾当前列表里有实体文件的全部资料 */}
                          <th className="w-10 px-3 py-3">
                            <input
                              type="checkbox"
                              className="rounded border-border"
                              aria-label="全选当前列表资料"
                              checked={(() => {
                                const ids = visibleDocs.map((l: any) => l.document?.id).filter(Boolean)
                                return ids.length > 0 && ids.every((id: string) => docSelected.includes(id))
                              })()}
                              onChange={(e) => {
                                const ids: string[] = visibleDocs.map((l: any) => l.document?.id).filter(Boolean)
                                setDocSelected(
                                  e.target.checked
                                    ? [...new Set([...docSelected, ...ids])]
                                    : docSelected.filter((id) => !ids.includes(id)),
                                )
                              }}
                            />
                          </th>
                          <th className="text-left px-4 py-3 font-medium whitespace-nowrap">文件</th>
                          <th className="text-left px-4 py-3 font-medium whitespace-nowrap">来源</th>
                          <th className="text-left px-4 py-3 font-medium whitespace-nowrap">类型</th>
                          <th className="text-left px-4 py-3 font-medium whitespace-nowrap">阶段</th>
                          <th className="text-left px-4 py-3 font-medium whitespace-nowrap">上传人</th>
                          <th className="text-left px-4 py-3 font-medium whitespace-nowrap">时间</th>
                          <th className="text-right px-4 py-3 font-medium whitespace-nowrap">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleDocs.map((link: any) => {
                          const doc = link.document || {}
                          const src = sourceOf(link)
                          const time = doc.createdAt || link.createdAt
                          return (
                            <tr key={link.id} className={`border-t border-border hover:bg-canvas/50 transition-colors ${doc.id && docSelected.includes(doc.id) ? 'bg-accent-50/60' : ''}`}>
                              <td className="px-3 py-3 w-10">
                                {/* 文件实体已删的链接没有可操作对象，不给复选框 */}
                                {doc.id && (
                                  <input
                                    type="checkbox"
                                    className="rounded border-border"
                                    aria-label={`选择「${doc.title || doc.fileName}」`}
                                    checked={docSelected.includes(doc.id)}
                                    onChange={(e) =>
                                      setDocSelected(
                                        e.target.checked
                                          ? [...docSelected, doc.id]
                                          : docSelected.filter((id) => id !== doc.id),
                                      )
                                    }
                                  />
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileText size={15} className="text-accent-600 shrink-0" />
                                  <span className="text-ink truncate" title={doc.title || doc.fileName}>
                                    {doc.title || doc.fileName || '（文件已删除）'}
                                  </span>
                                  {link.version > 1 && (
                                    <span className="text-[10px] text-warning-fg bg-warning-bg border border-warning-line px-1 py-0.5 rounded shrink-0">
                                      v{link.version}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${kindColor[src.kind] || kindColor['客户档案']}`}>
                                    {src.kind}
                                  </span>
                                  {src.path ? (
                                    <button
                                      onClick={() => navigate(src.path!)}
                                      className="text-xs text-ink-soft hover:text-accent-600 truncate"
                                      title={src.label}
                                    >
                                      {src.label}
                                    </button>
                                  ) : (
                                    <span className="text-xs text-muted truncate">{src.label}</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 whitespace-nowrap ${roleColor(link.linkRole)}`}>
                                  {roleLabel(link.linkRole)}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                                {stageLabels[link.stage] || link.stage || '—'}
                                {link.category ? ` · ${categoryLabels[link.category] || link.category}` : ''}
                              </td>
                              <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">{link.uploadedByName || '—'}</td>
                              <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">
                                {time ? new Date(time).toLocaleString('zh-CN') : '—'}
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                {doc.id && (
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      onClick={() =>
                                        setPreviewDoc({
                                          id: doc.id,
                                          fileName: doc.fileName || 'preview',
                                          mimeType: doc.mimeType,
                                          fileSize: doc.fileSize,
                                        })
                                      }
                                      className="text-muted hover:text-accent-600"
                                      aria-label="预览"
                                      title="预览"
                                    >
                                      <Scan size={16} />
                                    </button>
                                    <button
                                      onClick={() =>
                                        downloadFile('documents', doc.id, doc.fileName).catch((e: any) =>
                                          toast.error(e?.message || '下载失败'),
                                        )
                                      }
                                      className="text-muted hover:text-accent-600"
                                      aria-label="下载"
                                      title="下载"
                                    >
                                      <Download size={16} />
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <FilePreview
        isOpen={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        fileKind="documents"
        fileId={previewDoc?.id}
        fileName={previewDoc?.fileName || ''}
        mimeType={previewDoc?.mimeType}
        fileSize={previewDoc?.fileSize}
        // 翻阅范围＝当前阶段筛选后看到的这些，与页面显示一致
        siblings={visibleDocs as any}
        // 文件名的兜底要与上面点击预览时一致，否则翻过去标题会是空的
        onNavigate={(item: any) =>
          setPreviewDoc({
            id: item.id,
            fileName: item.fileName || 'preview',
            mimeType: item.mimeType,
            fileSize: item.fileSize,
          })
        }
      />
    </div>
  )
}
