import { useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Building2,
  FolderKanban,
  ClipboardList,
  FileText,
  DollarSign,
  Files,
  TrendingUp,
  Phone,
  Mail,
  MapPin,
  Calendar,
  ScrollText,
  Headset,
  Plus,
  Trash2,
} from 'lucide-react'
import { customerApi } from '../api/services'
import Skeleton from '../components/Skeleton'
import ErrorState from '../components/ErrorState'
import StatusBadge from '../components/StatusBadge'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'
import CustomerTimeline from '../components/CustomerTimeline'
import FollowUpModal from '../components/FollowUpModal'
import Button from '../components/Button'

const stageLabels: Record<string, string> = {
  raw: '原始资料',
  requirement: '需求文件',
  analysis: '分析文档',
  solution: '技术方案',
  quotation: '报价文件',
  contract: '合同协议',
}

const categoryLabels: Record<string, string> = {
  raw_material: '原始资料',
  requirement_spec: '需求规格',
  cad_drawing: 'CAD图纸',
  tech_agreement: '技术协议',
  bid_doc: '标书',
  quotation: '报价单',
  contract: '合同',
}

const TAB_KEYS = ['overview', 'timeline', 'requirements', 'proposals', 'quotations', 'contracts', 'documents', 'projects', 'afterSales', 'followUps', 'aiInsights'] as const
type CustomerTab = typeof TAB_KEYS[number]

export default function Customer360() {
  const { id } = useParams<{ id: string }>()
  const [statPeriod, setStatPeriod] = useState<'all' | 'year' | 'quarter' | 'month'>('all')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // 支持 ?tab=documents 深链（客户资料页据此直接落到"文档"汇总）
  const tabParam = searchParams.get('tab')
  const initialTab: CustomerTab = TAB_KEYS.includes(tabParam as CustomerTab) ? (tabParam as CustomerTab) : 'overview'
  const [activeTab, setActiveTab] = useState<CustomerTab>(initialTab)
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const queryClient = useQueryClient()
  const removeFollowUp = async (fid: string) => {
    if (!window.confirm('删除这条沟通记录？')) return
    try {
      await customerApi.removeFollowUp(fid)
      queryClient.invalidateQueries({ queryKey: ['customer-360', id] })
      queryClient.invalidateQueries({ queryKey: ['customer-timeline', id] })
      toast.success('已删除')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '删除失败')
    }
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['customer-360', id],
    queryFn: () => customerApi.get360(id!),
    enabled: !!id,
  })

  // AI 洞察：只在用户点到该页签时才请求，避免进页就拖两次 AI 调用
  const { data: aiInsights, isLoading: aiLoading } = useQuery({
    queryKey: ['customer-ai-insights', id],
    queryFn: async () => {
      const [similar, crossSell] = await Promise.all([
        customerApi.findSimilar(id!),
        customerApi.crossSell(id!),
      ])
      return { similar, crossSell }
    },
    enabled: !!id && activeTab === 'aiInsights',
  })

  /*
   * 页面助手上下文。
   *
   * 必须放在下面几个 early return **之前** —— Hook 不能条件调用。
   * 因此这里对 data 全程做空值保护：加载中先注册一个最小上下文，
   * 数据到了再自动更新（useRegisterPageAssistant 按内容做浅比较）。
   *
   * 客户 360 是页面助手最该发挥作用的地方：一整条客户档案（联系人、在手需求、
   * 报价、合同、跟进记录）都在眼前，助手直接据此作答，比去全库检索准得多。
   */
  const c360: any = data || {}
  useRegisterPageAssistant({
    key: `customer-360-${id || ''}`,
    label: c360.customer?.name ? `客户 · ${c360.customer.name}` : '客户档案',
    sourceTypes: ['customer', 'requirement', 'proposal', 'quotation', 'contract', 'project', 'ticket'],
    questions: [
      '这家客户目前的在手需求和进展如何？',
      '最近一次跟进谈到哪儿了？下一步该做什么？',
      '这家客户历史成交了哪些设备、价格区间是多少？',
      '有哪些报价还没有推进成合同？',
      '这家客户有过哪些售后问题？',
    ],
    context: (() => {
      const cu = c360.customer
      if (!cu) return `页面：客户档案（数据加载中）`
      const list = (arr: any[] | undefined, n: number, fn: (x: any, i: number) => string) =>
        (arr || []).slice(0, n).map(fn)
      return [
        `页面：客户 360（${cu.name}）`,
        `客户编号 ${cu.customerCode || cu.code || '—'}｜等级 ${cu.level || '—'}｜业务状态 ${cu.businessStatus || '—'}` +
          `｜行业 ${cu.industry || '—'}｜区域 ${cu.region || '—'}｜销售 ${cu.salesPerson || '—'}`,
        cu.address ? `地址：${cu.address}` : '',
        cu.description ? `简介：${cu.description}` : '',
        (c360.contacts || cu.contacts)?.length
          ? '联系人：' +
            list(c360.contacts || cu.contacts, 8, (p) =>
              `${p.name}${p.title ? `（${p.title}${p.decisionRole ? `/${p.decisionRole}` : ''}）` : ''}`,
            ).join('、')
          : '',
        (c360.requirements || []).length ? '在手需求：' : '',
        ...list(c360.requirements, 10, (r, i) =>
          `  ${i + 1}. ${r.requirementNo || ''} ${r.title || ''}｜优先级 ${r.priority || '—'}｜状态 ${r.status || '—'}`,
        ),
        (c360.quotations || []).length ? '报价记录：' : '',
        ...list(c360.quotations, 10, (q, i) =>
          `  ${i + 1}. ${q.quotationNo || ''}｜金额 ${Number(q.amount || 0).toLocaleString('zh-CN')}｜状态 ${q.status || '—'}`,
        ),
        (c360.contracts || []).length ? '合同：' : '',
        ...list(c360.contracts, 8, (t, i) =>
          `  ${i + 1}. ${t.contractNo || ''}｜金额 ${Number(t.amount || 0).toLocaleString('zh-CN')}｜状态 ${t.status || '—'}`,
        ),
        (c360.followUps || []).length ? '近期跟进：' : '',
        ...list(c360.followUps, 6, (f, i) =>
          `  ${i + 1}. ${f.followUpAt ? new Date(f.followUpAt).toLocaleDateString('zh-CN') : ''} ${f.method || ''} ${f.content || ''}${f.nextAction ? `｜下一步：${f.nextAction}` : ''}`,
        ),
        (c360.tickets || []).length ? '售后工单：' : '',
        ...list(c360.tickets, 6, (t, i) =>
          `  ${i + 1}. ${t.ticketNo || ''} ${t.title || ''}｜状态 ${t.status || '—'}`,
        ),
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 6000)
    })(),
  })

  if (isLoading) {
    // 360 页骨架：头部客户卡 + KPI 行 + 两个内容卡，形状与真实页一致
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    )
  }
  if (isError || !data) return <ErrorState onRetry={() => navigate('/customers')} />

  const { customer, stats, projects, requirements, proposals, quotations, contracts, documents, documentsByStage, followUps, tickets }: any = data

  // 按周期过滤数据
  const periodStart = (() => {
    if (statPeriod === 'all') return null
    const now = new Date()
    if (statPeriod === 'year') return new Date(now.getFullYear(), 0, 1)
    if (statPeriod === 'quarter') return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
    if (statPeriod === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
    return null
  })()
  const inPeriod = (d?: string) => !d || !periodStart || new Date(d) >= periodStart

  const statCards = [
    { label: '项目数', value: (projects || []).filter((p: any) => inPeriod(p.createdAt)).length, icon: FolderKanban, color: 'text-info-fg', bg: 'bg-info-bg' },
    { label: '已成交', value: (projects || []).filter((p: any) => p.dealStage === 'won' && inPeriod(p.createdAt)).length, icon: TrendingUp, color: 'text-success-fg', bg: 'bg-success-bg' },
    { label: '需求数', value: (requirements || []).filter((r: any) => inPeriod(r.createdAt)).length, icon: ClipboardList, color: 'text-accent-600', bg: 'bg-accent-50' },
    { label: '方案数', value: (proposals || []).filter((p: any) => inPeriod(p.createdAt)).length, icon: FileText, color: 'text-warning-fg', bg: 'bg-warning-bg' },
    { label: '报价数', value: (quotations || []).filter((q: any) => inPeriod(q.createdAt)).length, icon: DollarSign, color: 'text-info-fg', bg: 'bg-info-bg' },
    { label: '合同数', value: (contracts || []).filter((c: any) => inPeriod(c.createdAt)).length, icon: ScrollText, color: 'text-success-fg', bg: 'bg-success-bg' },
    { label: '合同额(万)', value: ((contracts || []).filter((c: any) => inPeriod(c.createdAt)).reduce((s: number, c: any) => s + Number(c.amount || 0), 0) / 10000).toFixed(1), icon: DollarSign, color: 'text-danger-fg', bg: 'bg-danger-bg' },
    { label: '文档数', value: (documents || []).filter((d: any) => inPeriod(d.createdAt)).length, icon: Files, color: 'text-ink-soft', bg: 'bg-subtle' },
    { label: '售后数', value: (tickets || []).filter((t: any) => inPeriod(t.createdAt)).length, icon: Headset, color: 'text-warning-fg', bg: 'bg-warning-bg' },
  ]

  return (
    <div className="space-y-5">
      {/* Back */}
      <button
        onClick={() => navigate('/customers')}
        className="flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors"
      >
        <ArrowLeft size={16} /> 返回客户列表
      </button>

      {/* Customer header */}
      <div className="bg-surface rounded-xl border border-border px-5 py-4 shadow-card">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-accent-500 to-accent-300 flex items-center justify-center text-white flex-shrink-0">
            <Building2 size={22} />
          </div>
          <div className="flex-1 min-w-0">
            {/*
              这里原本挂着 <StatusBadge status={customer.status} />，显示"审核通过"。
              那个 status 是审批流状态，审批模块套在所有实体上的通用字段 ——
              对客户档案没有业务含义（客户不需要被"审核通过"），只会误导。
            */}
            <h1 className="text-lg font-serif font-semibold text-ink">{customer.name}</h1>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
              {customer.industry && <span>行业: {customer.industry}</span>}
              {customer.scale && <span>规模: {customer.scale}</span>}
              {customer.code && <span>编码: {customer.code}</span>}
              {customer.address && (
                <span className="flex items-center gap-1"><MapPin size={12} /> {customer.address}</span>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-serif font-bold text-accent-600">
              ¥{(stats.totalQuotationAmount / 10000).toFixed(1)}
            </div>
            <div className="text-xs text-muted">累计报价金额(万)</div>
          </div>
        </div>

        {/* Contacts */}
        {customer.contacts && customer.contacts.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <div className="text-xs font-medium text-muted mb-2">联系人</div>
            <div className="flex flex-wrap gap-3">
              {customer.contacts.map((c: any) => (
                <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 bg-canvas rounded-lg text-xs">
                  <span className="font-medium text-ink">{c.name}</span>
                  {c.title && <span className="text-muted">{c.title}</span>}
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="flex items-center gap-0.5 text-info-fg hover:underline">
                      <Phone size={11} /> {c.phone}
                    </a>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="flex items-center gap-0.5 text-info-fg hover:underline">
                      <Mail size={11} /> {c.email}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 周期切换 + Stats grid */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {([
            { value: 'all', label: '全部' },
            { value: 'year', label: '本年' },
            { value: 'quarter', label: '本季' },
            { value: 'month', label: '本月' },
          ] as const).map((p) => (
            <button
              key={p.value}
              onClick={() => setStatPeriod(p.value)}
              className={`px-2.5 py-0.5 text-xs rounded-md transition-colors ${
                statPeriod === p.value ? 'bg-accent-50 text-accent-700 font-medium' : 'text-muted hover:text-ink'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {/* Stats grid — flex 自适应保证一行显示 */}
      <div className="flex gap-2 flex-wrap">
        {statCards.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className="flex-1 min-w-[110px] bg-surface rounded-lg border border-border px-2.5 py-2 shadow-card">
              <div className="flex items-center gap-1.5">
                <div className={`w-6 h-6 rounded-md ${card.bg} flex items-center justify-center shrink-0`}>
                  <Icon size={13} className={card.color} />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-serif font-bold text-ink leading-none">{card.value}</div>
                  <div className="text-caption text-muted truncate">{card.label}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Tabs：手机上横向滑动，标签不再被挤成一字一行 */}
      <div className="flex gap-1 border-b border-border overflow-x-auto [scrollbar-width:none]">
        {([
          /* 顺序按业务推进：需求 → 方案 → 报价 → 文档 → 项目 */
          { key: 'overview', label: '概览' },
          { key: 'timeline', label: '时间线' },
          { key: 'requirements', label: `需求 (${requirements.length})` },
          { key: 'proposals', label: `方案 (${proposals.length})` },
          { key: 'quotations', label: `报价 (${quotations.length})` },
          { key: 'contracts', label: `合同 (${(contracts || []).length})` },
          { key: 'documents', label: `文档 (${documents.length})` },
          { key: 'projects', label: `项目 (${projects.length})` },
          { key: 'afterSales', label: `售后 (${(tickets || []).length})` },
          { key: 'followUps', label: `沟通记录 (${(followUps || []).length})` },
          { key: 'aiInsights', label: 'AI 洞察' },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === tab.key
                ? 'border-accent-500 text-accent-600'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-5">
          {/* Recent projects */}
          <div className="bg-surface rounded-xl border border-border p-5 shadow-card">
            <h3 className="text-sm font-semibold text-ink mb-3">最近项目</h3>
            <div className="space-y-3">
              {projects.slice(0, 5).map((p: any) => (
                <div key={p.id} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{p.name}</div>
                    <div className="text-xs text-muted">{p.projectNo}</div>
                  </div>
                  <StatusBadge status={p.dealStage} />
                </div>
              ))}
              {projects.length === 0 && <div className="text-sm text-muted py-4 text-center">暂无项目</div>}
            </div>
          </div>

          {/* Document stages */}
          <div className="bg-surface rounded-xl border border-border p-5 shadow-card">
            <h3 className="text-sm font-semibold text-ink mb-3">文档分布</h3>
            <div className="space-y-2.5">
              {Object.entries(documentsByStage).map(([stage, docs]: any) => (
                <div key={stage} className="flex items-center gap-3">
                  <div className="text-xs text-muted w-20 flex-shrink-0">{stageLabels[stage] || stage}</div>
                  <div className="flex-1 h-2 bg-canvas rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-accent-500 to-accent-300 rounded-full transition-all"
                      style={{ width: `${documents.length ? (docs.length / documents.length) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="text-xs font-medium text-ink w-8 text-right">{docs.length}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent quotations */}
          <div className="bg-surface rounded-xl border border-border p-5 shadow-card">
            <h3 className="text-sm font-semibold text-ink mb-3">最近报价</h3>
            <div className="space-y-3">
              {quotations.slice(0, 5).map((q: any) => (
                <div key={q.id} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{q.quotationNo}</div>
                    <div className="text-xs text-muted">{new Date(q.createdAt).toLocaleDateString('zh-CN')}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-serif font-bold text-accent-600">¥{Number(q.amount).toLocaleString()}</div>
                    <StatusBadge status={q.status} />
                  </div>
                </div>
              ))}
              {quotations.length === 0 && <div className="text-sm text-muted py-4 text-center">暂无报价</div>}
            </div>
          </div>

          {/* Recent requirements */}
          <div className="bg-surface rounded-xl border border-border p-5 shadow-card">
            <h3 className="text-sm font-semibold text-ink mb-3">最近需求</h3>
            <div className="space-y-3">
              {requirements.slice(0, 5).map((r: any) => (
                <div key={r.id} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{r.title}</div>
                    <div className="text-xs text-muted">{r.requirementNo}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.specStatus === 'done' && (
                      <span className="text-xs px-1.5 py-0.5 bg-success-bg text-success-fg rounded">已识别</span>
                    )}
                    <StatusBadge status={r.status} />
                  </div>
                </div>
              ))}
              {requirements.length === 0 && <div className="text-sm text-muted py-4 text-center">暂无需求</div>}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'projects' && (
        <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-xs text-muted">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">项目编号</th>
                  <th className="text-left px-4 py-3 font-medium">项目名称</th>
                  <th className="text-left px-4 py-3 font-medium">流程阶段</th>
                  <th className="text-left px-4 py-3 font-medium">类型</th>
                  <th className="text-left px-4 py-3 font-medium">文档数</th>
                  <th className="text-left px-4 py-3 font-medium">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p: any) => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/projects?highlight=${p.id}`)}
                    className="border-t border-border hover:bg-canvas/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted">{p.projectNo}</td>
                    <td className="px-4 py-3 font-medium text-ink">{p.name}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.dealStage} /></td>
                    <td className="px-4 py-3 text-muted">
                      {p.dealType === 'new' ? '新客户' : p.dealType === 'repeat' ? '复购' : '扩展'}
                    </td>
                    <td className="px-4 py-3 text-muted">{p.documentCount}</td>
                    <td className="px-4 py-3 text-xs text-muted">{p.createdAt ? new Date(p.createdAt).toLocaleDateString('zh-CN') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {projects.length === 0 && <div className="py-12 text-center text-muted">暂无项目记录</div>}
        </div>
      )}

      {/* 方案与报价：数据后端本来就返回了，之前只在概览里露个脸，没有独立页签 */}
      {activeTab === 'proposals' && (
        <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
          {proposals.length === 0 ? (
            <div className="text-sm text-muted py-10 text-center">暂无方案</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-canvas text-xs text-muted">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">编号</th>
                  <th className="text-left px-4 py-3 font-medium">项目名称</th>
                  <th className="text-left px-4 py-3 font-medium">版本</th>
                  <th className="text-left px-4 py-3 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p: any) => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/proposals?highlight=${p.id}`)}
                    className="border-t border-border hover:bg-canvas/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 eo-num text-xs">{p.proposalNo}</td>
                    <td className="px-4 py-3">{p.projectName || p.title || '-'}</td>
                    <td className="px-4 py-3 text-muted">v{p.version || 1}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'quotations' && (
        <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
          {quotations.length === 0 ? (
            <div className="text-sm text-muted py-10 text-center">暂无报价</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-canvas text-xs text-muted">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">编号</th>
                  <th className="text-left px-4 py-3 font-medium">金额</th>
                  <th className="text-left px-4 py-3 font-medium">状态</th>
                  <th className="text-left px-4 py-3 font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {quotations.map((q: any) => (
                  <tr
                    key={q.id}
                    onClick={() => navigate(`/quotations?highlight=${q.id}`)}
                    className="border-t border-border hover:bg-canvas/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 eo-num text-xs">{q.quotationNo}</td>
                    <td className="px-4 py-3 eo-num">¥{(q.amount || 0).toLocaleString('zh-CN')}</td>
                    <td className="px-4 py-3"><StatusBadge status={q.status} /></td>
                    <td className="px-4 py-3 text-muted text-xs">{q.createdAt?.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-xs text-muted">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">文件名</th>
                  <th className="text-left px-4 py-3 font-medium">来源</th>
                  <th className="text-left px-4 py-3 font-medium">阶段</th>
                  <th className="text-left px-4 py-3 font-medium">类别</th>
                  <th className="text-left px-4 py-3 font-medium">版本</th>
                  <th className="text-left px-4 py-3 font-medium">上传人</th>
                  <th className="text-left px-4 py-3 font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc: any) => (
                  <tr key={doc.id} className="border-t border-border hover:bg-canvas/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{doc.document?.title || doc.document?.fileName || '-'}</div>
                      {doc.description && <div className="text-xs text-muted">{doc.description}</div>}
                    </td>
                    {/*
                      来源 = 这份资料挂在哪个业务对象上。
                      document_links 里 requirementId / proposalId / quotationId / projectId
                      本来就分开存着，之前平铺展示等于把这个信息扔了 ——
                      客户给的需求资料和我们出的报价单混在一张表里分不出来。
                    */}
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded bg-canvas border border-border text-ink-soft">
                        {doc.requirementId
                          ? '需求'
                          : doc.proposalId
                            ? '方案'
                            : doc.quotationId
                              ? '报价'
                              : doc.projectId
                                ? '项目'
                                : '客户'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 bg-info-bg text-info-fg rounded">{stageLabels[doc.stage] || doc.stage}</span>
                    </td>
                    <td className="px-4 py-3 text-muted">{categoryLabels[doc.category] || doc.category}</td>
                    <td className="px-4 py-3 text-muted">v{doc.version}</td>
                    <td className="px-4 py-3 text-muted">{doc.uploadedByName || '-'}</td>
                    <td className="px-4 py-3 text-xs text-muted">{new Date(doc.createdAt).toLocaleDateString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {documents.length === 0 && <div className="py-12 text-center text-muted">暂无文档</div>}
        </div>
      )}

      {activeTab === 'requirements' && (
        <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-xs text-muted">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">需求编号</th>
                  <th className="text-left px-4 py-3 font-medium">项目名称</th>
                  <th className="text-left px-4 py-3 font-medium">识别状态</th>
                  <th className="text-left px-4 py-3 font-medium">优先级</th>
                  <th className="text-left px-4 py-3 font-medium">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {requirements.map((r: any) => (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/requirements?highlight=${r.id}`)}
                    className="border-t border-border hover:bg-canvas/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted">{r.requirementNo}</td>
                    <td className="px-4 py-3 font-medium text-ink">{r.title}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.specStatus} /></td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        r.priority === 'high' ? 'bg-danger-bg text-danger-fg' :
                        r.priority === 'medium' ? 'bg-warning-bg text-warning-fg' :
                        'bg-subtle text-ink-soft'
                      }`}>
                        {r.priority === 'high' ? '高' : r.priority === 'medium' ? '中' : '低'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(r.createdAt).toLocaleDateString('zh-CN')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {requirements.length === 0 && <div className="py-12 text-center text-muted">暂无需求</div>}
        </div>
      )}

      {/* 合同历史 */}
      {activeTab === 'contracts' && (
        <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-xs text-muted">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">合同编号</th>
                  <th className="text-left px-4 py-3 font-medium">标题</th>
                  <th className="text-left px-4 py-3 font-medium">金额</th>
                  <th className="text-left px-4 py-3 font-medium">状态</th>
                  <th className="text-left px-4 py-3 font-medium">签订日期</th>
                </tr>
              </thead>
              <tbody>
                {(contracts || []).map((c: any) => (
                  <tr key={c.id} className="border-t border-border hover:bg-canvas/50 transition-colors cursor-pointer" onClick={() => navigate(`/contracts?highlight=${c.id}`)}>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{c.contractNo}</td>
                    <td className="px-4 py-3 font-medium text-ink">{c.title || '—'}</td>
                    <td className="px-4 py-3">¥{Number(c.amount || 0).toLocaleString()}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3 text-xs text-muted">{c.signedDate ? new Date(c.signedDate).toLocaleDateString('zh-CN') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(!contracts || contracts.length === 0) && <div className="py-12 text-center text-muted">暂无合同</div>}
        </div>
      )}

      {/* 售后工单 */}
      {activeTab === 'afterSales' && (
        <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-xs text-muted">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">工单编号</th>
                  <th className="text-left px-4 py-3 font-medium">标题</th>
                  <th className="text-left px-4 py-3 font-medium">类型</th>
                  <th className="text-left px-4 py-3 font-medium">设备型号</th>
                  <th className="text-left px-4 py-3 font-medium">优先级</th>
                  <th className="text-left px-4 py-3 font-medium">状态</th>
                  <th className="text-left px-4 py-3 font-medium">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {(tickets || []).map((t: any) => (
                  <tr key={t.id} className="border-t border-border hover:bg-canvas/50 transition-colors cursor-pointer" onClick={() => navigate(`/after-sales?highlight=${t.id}`)}>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{t.ticketNo}</td>
                    <td className="px-4 py-3 font-medium text-ink">{t.title}</td>
                    <td className="px-4 py-3 text-muted">
                      {t.type === 'fault' ? '故障报修' : t.type === 'maintenance' ? '定期保养' : t.type === 'spare_part' ? '备件需求' : t.type === 'visit' ? '客户回访' : t.type}
                    </td>
                    <td className="px-4 py-3 text-muted">{t.productModel || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        t.priority === 'urgent' ? 'bg-danger-bg text-danger-fg' :
                        t.priority === 'high' ? 'bg-warning-bg text-warning-fg' :
                        'bg-subtle text-ink-soft'
                      }`}>
                        {t.priority === 'urgent' ? '紧急' : t.priority === 'high' ? '高' : t.priority === 'medium' ? '中' : '低'}
                      </span>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                    <td className="px-4 py-3 text-xs text-muted">{new Date(t.createdAt).toLocaleDateString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(!tickets || tickets.length === 0) && <div className="py-12 text-center text-muted">暂无售后工单</div>}
        </div>
      )}

      {/* 统一时间线：沟通、需求记录、任务、单据、资料、修改 */}
      {activeTab === 'timeline' && id && <CustomerTimeline customerId={id} requirements={requirements} />}

      {/* 沟通记录 */}
      {activeTab === 'followUps' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setFollowUpOpen(true)}>
              <Plus size={14} className="mr-1" /> 记一笔沟通
            </Button>
          </div>
          {(followUps || []).length === 0 ? (
            <div className="bg-surface rounded-xl border border-border py-12 text-center text-muted">暂无沟通记录</div>
          ) : (
            (followUps || []).map((f: any) => (
              <div key={f.id} className="bg-surface rounded-xl border border-border p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {f.method && <span className="text-xs px-2 py-0.5 rounded bg-accent-50 text-accent-700">{f.method}</span>}
                    <span className="text-xs text-muted">
                      {f.followUpAt ? new Date(f.followUpAt).toLocaleString('zh-CN') : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {f.deadline && (
                      <span className="text-xs text-warning-fg flex items-center gap-1">
                        <Calendar size={11} /> 跟进截止 {new Date(f.deadline).toLocaleDateString('zh-CN')}
                      </span>
                    )}
                    <button onClick={() => removeFollowUp(f.id)} className="text-muted hover:text-danger-fg" title="删除" aria-label="删除沟通记录">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-ink whitespace-pre-wrap">{f.content}</p>
                {(f.participants || f.customerParticipants) && (
                  <div className="mt-2 flex gap-4 text-xs text-muted">
                    {f.participants && <span>我方：{f.participants}</span>}
                    {f.customerParticipants && <span>客户方：{f.customerParticipants}</span>}
                  </div>
                )}
                {f.focusPoints && <p className="mt-1.5 text-xs text-warning-fg">📌 {f.focusPoints}</p>}
                {f.nextAction && <p className="mt-1 text-xs text-accent-600">→ {f.nextAction}</p>}
              </div>
            ))
          )}
        </div>
      )}
      {id && (
        <FollowUpModal open={followUpOpen} onClose={() => setFollowUpOpen(false)} customerId={id} requirements={requirements} />
      )}

      {/* AI 洞察：相似客户匹配 + 交叉销售机会（AI 服务 /customers/similar、/cross-sell） */}
      {activeTab === 'aiInsights' && (
        aiLoading ? (
          <div className="bg-surface rounded-xl border border-border py-12 text-center text-muted">AI 分析中，请稍候…</div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-5">
            {/* 相似客户 */}
            <div className="bg-surface rounded-xl border border-border p-5 shadow-card">
              <h3 className="text-sm font-semibold text-ink mb-1">相似客户</h3>
              <p className="text-xs text-muted mb-3">基于行业、产品需求与采购历史的画像匹配，点击可跳转对应客户档案</p>
              <div className="space-y-3">
                {aiInsights?.similar?.error && (
                  <div className="text-sm text-danger-fg py-4 text-center">{aiInsights.similar.error}</div>
                )}
                {aiInsights?.similar?.similar_customers?.length === 0 && !aiInsights?.similar?.error && (
                  <div className="text-sm text-muted py-4 text-center">未找到相似客户（知识库中其他客户资料较少时匹配结果会偏少）</div>
                )}
                {(aiInsights?.similar?.similar_customers || []).map((sc: any) => (
                  <div
                    key={sc.customer_id}
                    onClick={() => sc.customer_id && navigate(`/customers/${sc.customer_id}`)}
                    className="rounded-lg border border-border p-3 hover:bg-canvas/50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-ink truncate">{sc.name || '未知客户'}</div>
                      <span className="text-xs font-serif font-bold text-accent-600 shrink-0">
                        {Math.round((sc.similarity || 0) * 100)}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 bg-canvas rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-accent-500 to-accent-300 rounded-full"
                        style={{ width: `${Math.round((sc.similarity || 0) * 100)}%` }}
                      />
                    </div>
                    {(sc.match_reasons || []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {sc.match_reasons.map((r: string, i: number) => (
                          <span key={i} className="text-xs px-1.5 py-0.5 bg-info-bg text-info-fg rounded">{r}</span>
                        ))}
                      </div>
                    )}
                    {(sc.cross_sell_opportunities || []).length > 0 && (
                      <div className="mt-1.5 text-xs text-muted">机会：{sc.cross_sell_opportunities.join('、')}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 交叉销售推荐 */}
            <div className="bg-surface rounded-xl border border-border p-5 shadow-card">
              <h3 className="text-sm font-semibold text-ink mb-1">配套产品推荐</h3>
              <p className="text-xs text-muted mb-3">基于该客户已采购产品的配套关联规则</p>
              {aiInsights?.crossSell?.message && (
                <div className="text-sm text-muted py-4 text-center">{aiInsights.crossSell.message}</div>
              )}
              {aiInsights?.crossSell?.error && (
                <div className="text-sm text-danger-fg py-4 text-center">{aiInsights.crossSell.error}</div>
              )}
              {(aiInsights?.crossSell?.recommendations || []).length > 0 && (
                <div className="space-y-2">
                  {(aiInsights?.crossSell?.recommendations || []).map((rec: any, i: number) => (
                    <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink">{rec.product}</div>
                        <div className="text-xs text-muted">{rec.reason}</div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${
                        rec.priority === 'high' ? 'bg-danger-bg text-danger-fg' : 'bg-warning-bg text-warning-fg'
                      }`}>
                        {rec.priority === 'high' ? '优先' : '关注'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {(aiInsights?.crossSell?.recommendations || []).length === 0 && !aiInsights?.crossSell?.message && !aiInsights?.crossSell?.error && (
                <div className="text-sm text-muted py-4 text-center">暂无配套推荐（当前采购产品未命中配套规则）</div>
              )}
            </div>
          </div>
        )
      )}
    </div>
  )
}
