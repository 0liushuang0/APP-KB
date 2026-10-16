import { useMemo, useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Sparkles,
  MessageSquare,
  ClipboardList,
  FileText,
  Layers,
  FileDown,
  Paperclip,
  Calculator,
  Copy,
  Check,
  AlertTriangle,
  Wand2,
  Bot,
  ChevronDown,
  Plus,
  X,
} from 'lucide-react'
import {
  requirementApi,
  documentApi,
  proposalApi,
  matchingApi,
  calcRecordApi,
} from '../api/services'
import type {
  RequirementCard,
  RequirementCardField,
  FollowUpDraft,
  RequirementLog,
  RequirementLogType,
  RequirementChangeItem,
} from '../types'
import { REQUIREMENT_STATUS_OPTIONS, requirementStatusLabel } from '../types'
import DetailLayout from '../components/DetailLayout'
import StatusBadge from '../components/StatusBadge'
import IdentificationPreviewModal from '../components/IdentificationPreviewModal'
import Button from '../components/Button'
import Modal from '../components/Modal'
import Drawer from '../components/Drawer'
import Tabs from '../components/Tabs'
import FormTextarea from '../components/FormTextarea'
import Timeline, { type TimelineItem } from '../components/Timeline'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import EmptyState from '../components/EmptyState'
import KeyValueList from '../components/KeyValueList'
import ParamTable, { type ParamField } from '../components/ParamTable'
import CalcRunner from '../components/CalcRunner'
import CalcSheetList from '../components/CalcSheetList'
import EntityFileUpload from '../components/EntityFileUpload'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'

const PRIORITY_LABELS: Record<string, string> = { urgent: '紧急', high: '高', medium: '中', low: '低' }

/** requirement.category 存需求来源（主动拜访/客户来询/展会/转介绍） */
const SOURCE_CATEGORY_LABELS: Record<string, string> = {
  '主动拜访': '主动拜访',
  '客户来询': '客户来询',
  '展会': '展会',
  '转介绍': '转介绍',
  '其他': '其他',
}

/** specStatus 与通用审批状态共用了 pending/done 等码值，但文案语义不同 */
const SPEC_STATUS_LABELS: Record<string, string> = {
  pending: '待解析',
  analyzing: '解析中',
  done: '已解析',
  rejected: '已驳回',
}

/** 需求记录类型 → 文案与时间线圆点色调 */
const LOG_TYPE_META: Record<
  RequirementLogType,
  { label: string; tone: 'info' | 'warning' | 'success' | 'neutral' }
> = {
  communication: { label: '沟通交流', tone: 'info' },
  change: { label: '需求变更', tone: 'warning' },
  confirm: { label: '客户确认', tone: 'success' },
  other: { label: '其他', tone: 'neutral' },
}

const LOG_TYPE_ORDER: RequirementLogType[] = ['communication', 'change', 'confirm', 'other']

/** structuredSpec 可能是需求卡，也可能是旧版简化结构，统一成 ParamTable 能吃的形状 */
function toParamFields(spec: string | undefined): {
  fields: ParamField[]
  card: RequirementCard | null
} {
  if (!spec) return { fields: [], card: null }

  let parsed: any
  try {
    parsed = JSON.parse(spec)
  } catch {
    return { fields: [], card: null }
  }

  const card: RequirementCard = parsed?.card ?? parsed

  // 新版需求卡
  if (Array.isArray(card.fields)) {
    return {
      card,
      fields: card.fields.map(
        (f: RequirementCardField): ParamField => ({
          key: f.key,
          label: f.label,
          value: f.normalized ?? f.value,
          unit: f.unit,
          confidence: f.confidence,
          source: f.source,
          evidence: f.evidence,
          requiredForMatch: f.required_for_match,
          requiredForQuote: f.required_for_quote,
          group: f.group,
        }),
      ),
    }
  }

  // 旧版 { params: [{key, value, unit, confidence}] }
  if (Array.isArray(card.params)) {
    return {
      card,
      fields: card.params.map(
        (p): ParamField => ({
          key: p.key,
          label: p.key,
          value: p.value,
          unit: p.unit,
          confidence: p.confidence,
          source: 'ai',
        }),
      ),
    }
  }

  return { fields: [], card }
}

export default function RequirementDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  /**
   * 导出需求识别确认单。
   * 走后端生成（PDF 用内嵌中文字体、Word 用表格），带鉴权所以要 fetch + blob，
   * <a href> 不会带 Authorization 头。
   */
  const exportIdentification = async (format: 'pdf' | 'docx') => {
    if (!id) return
    const base = import.meta.env.VITE_API_BASE_URL || '/api'
    const token = localStorage.getItem('accessToken')
    try {
      const res = await fetch(`${base}/requirements/${id}/identification-${format}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error('导出失败')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `需求识别文件.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      toast.error(e.message || '导出失败')
    }
  }

  const [tab, setTab] = useState('basic')
  const [draftOpen, setDraftOpen] = useState(false)
  const [draft, setDraft] = useState<FollowUpDraft | null>(null)
  const [draftTab, setDraftTab] = useState<'wechat' | 'email'>('wechat')
  const [copied, setCopied] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [logForm, setLogForm] = useState<{
    type: RequirementLogType
    content: string
    changes: RequirementChangeItem[]
  }>({ type: 'communication', content: '', changes: [] })
  const [calcOpen, setCalcOpen] = useState(false)
  const [calcCode, setCalcCode] = useState('line_capacity')
  // 需求识别文件导出菜单（PDF / Word 收进一个下拉）
  const [exportOpen, setExportOpen] = useState(false)
  // 导出预览弹窗：预览所见 = 导出所得，参数值可在预览里直接改
  const [previewOpen, setPreviewOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  // 点击菜单外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    if (exportOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [exportOpen])

  const detailQuery = useQuery({
    queryKey: ['requirement', id],
    queryFn: () => requirementApi.get(id!),
    enabled: !!id,
    // 资料挂上来后系统会自动识别：识别中、或有资料但还没识别时轮询，结果出来自动显示
    refetchInterval: (q: any) => {
      const d = q.state.data as any
      if (!d) return false
      if (d.specStatus === 'analyzing') return 4000
      if ((!d.specStatus || d.specStatus === 'pending') && awaitingAuto.current) return 6000
      return false
    },
  })
  /** 本页刚上传过资料：等待自动识别（最多 3 分钟） */
  const awaitingAuto = useRef(false)

  const detail = detailQuery.data

  const logsQuery = useQuery({
    queryKey: ['requirement-logs', id],
    queryFn: () => requirementApi.logs(id!),
    enabled: !!id,
  })

  const docsQuery = useQuery({
    queryKey: ['documents', 'requirement', id],
    queryFn: () => documentApi.byEntity('requirement', id!),
    enabled: !!id,
  })

  // 资料数变多 = 刚上传了资料：开始等自动识别（3 分钟后停止轮询）
  const docCount = (docsQuery.data as any[] | undefined)?.length ?? -1
  const prevDocCount = useRef(-1)
  useEffect(() => {
    if (prevDocCount.current >= 0 && docCount > prevDocCount.current) {
      awaitingAuto.current = true
      detailQuery.refetch()
      const t = setTimeout(() => { awaitingAuto.current = false }, 180_000)
      prevDocCount.current = docCount
      return () => clearTimeout(t)
    }
    prevDocCount.current = docCount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docCount])

  const proposalsQuery = useQuery({
    queryKey: ['proposals', 'by-requirement', id],
    queryFn: () => proposalApi.list({ requirementId: id }),
    enabled: !!id && tab === 'proposals',
  })

  const calcQuery = useQuery({
    queryKey: ['calc-records', 'requirement', id],
    queryFn: () => calcRecordApi.list({ relatedRequirementId: id }),
    enabled: !!id && tab === 'calc',
  })

  const matchQuery = useQuery({
    queryKey: ['requirement-match', id],
    queryFn: () =>
      matchingApi.findSimilar(
        `${detail?.title || ''} ${detail?.description || ''}`,
        ['proposal', 'solution'],
        8,
        detail?.customerId,
      ),
    enabled: !!detail && tab === 'proposals',
  })

  /*
   * 页面助手上下文。
   *
   * 需求详情页最常问的是"还缺哪些参数""能不能复用历史方案"，
   * 所以结构化参数（structuredSpec.card）必须逐条展开送进去 ——
   * 只给标题和描述，助手答不出"板宽填了没有"。
   */
  useRegisterPageAssistant({
    key: `requirement-detail-${id || ''}`,
    label: detail?.title ? `需求 · ${detail.title}` : '需求详情',
    sourceTypes: ['requirement', 'solution', 'proposal', 'product', 'customer'],
    questions: [
      '这条需求还缺哪些关键参数？',
      '按现有参数，有哪些历史方案可以复用？',
      '给客户列一份待确认事项清单',
      '这条需求对应哪类产品和模板？',
      '当前进展到哪一步了？',
    ],
    context: (() => {
      if (!detail) return '页面：需求详情（数据加载中）'
      const d: any = detail
      const lines = [
        `页面：需求详情（${d.requirementNo || ''} ${d.title || ''}）`,
        `客户 ${d.customer?.name || d.customerName || '—'}｜类型 ${d.requirementType || '—'}｜来源 ${d.source || '—'}` +
          `｜优先级 ${d.priority || '—'}｜状态 ${d.status || '—'}`,
        d.templateCategory || d.category ? `对应模板分类：${d.templateCategory || d.category}` : '',
        d.description ? `需求描述：${d.description}` : '',
        d.aiAnalysis ? `AI 分析：${d.aiAnalysis}` : '',
      ]
      try {
        const spec = typeof d.structuredSpec === 'string' ? JSON.parse(d.structuredSpec) : d.structuredSpec
        const card = spec?.card ?? spec
        if (card?.params && typeof card.params === 'object') {
          const entries = Object.entries(card.params).slice(0, 50)
          if (entries.length) {
            lines.push('已确认的技术参数：')
            lines.push(
              ...entries.map(([k, v]: [string, any], i) => {
                const val = v && typeof v === 'object' ? `${v.value ?? ''}${v.unit || ''}` : String(v)
                return `  ${i + 1}. ${k} = ${val}`
              }),
            )
          }
        }
        if (Array.isArray(card?.missing) && card.missing.length) {
          lines.push(`待确认参数：${card.missing.join('、')}`)
        }
      } catch {
        // structuredSpec 是坏 JSON 时不影响其余上下文
      }
      const docs = docsQuery.data
      if (Array.isArray(docs) && docs.length) {
        lines.push('关联资料：' + docs.slice(0, 12).map((x: any) => x.title || x.fileName).join('、'))
      }
      return lines.filter(Boolean).join('\n').slice(0, 6000)
    })(),
  })

  // 当前正在看匹配分析的相似方案，格式 `${source_type}:${source_id}`，再次点击收起
  const [explainKey, setExplainKey] = useState<string | null>(null)
  const explainQuery = useQuery({
    queryKey: ['match-explanation', id, explainKey],
    queryFn: () => {
      const [type, targetId] = explainKey!.split(':')
      return requirementApi.matchExplanation(id!, type as 'proposal' | 'solution', targetId)
    },
    enabled: !!id && !!explainKey,
  })

  const { fields, card } = useMemo(() => toParamFields(detail?.structuredSpec), [detail?.structuredSpec])
  /** 自动识别的结果是否还等人确认；识别依据了哪些资料 */
  const specMeta = useMemo(() => {
    try {
      const sp = detail?.structuredSpec ? JSON.parse(detail.structuredSpec) : null
      return { review: sp?.review === true, sources: Array.isArray(sp?.sources) ? (sp.sources as string[]) : [] }
    } catch {
      return { review: false, sources: [] as string[] }
    }
  }, [detail?.structuredSpec])
  const confirmSpecMutation = useMutation({
    mutationFn: () => requirementApi.confirmSpec(id!),
    onSuccess: () => {
      toast.success('已确认识别结果')
      detailQuery.refetch()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '确认失败'),
  })

  const missingCritical = fields.filter(
    (f) =>
      (f.value === null || f.value === undefined || f.value === '') &&
      (f.requiredForMatch || f.requiredForQuote),
  )
  /*
   * 完整度 = 有值的参数 ÷（识别到的参数 + 引擎列出的缺失项）。
   * 原来只按"识别到的参数里有几个有值"算，识别到的几乎都有值，于是页头恒为 100%，
   * 同屏提示条却写着"还缺 5 项"——两个数字互相打架。缺失项必须计入分母。
   */
  const missingCount = Array.isArray((card as any)?.missing) ? (card as any).missing.length : 0
  const filledCount = fields.filter((f) => !(f.value == null || f.value === '')).length
  const completeness = fields.length + missingCount
    ? Math.round((filledCount / (fields.length + missingCount)) * 100)
    : 0

  const analyzeMutation = useMutation({
    mutationFn: () => requirementApi.analyzeStructured(id!),
    onSuccess: () => {
      toast.success('结构化识别完成')
      detailQuery.refetch()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '识别失败'),
  })

  const draftMutation = useMutation({
    mutationFn: () => requirementApi.followupDraft(id!),
    onSuccess: (data) => {
      setDraft(data)
      setDraftOpen(true)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '生成失败'),
  })

  const specMutation = useMutation({
    mutationFn: (nextCard: RequirementCard) => requirementApi.updateSpec(id!, nextCard),
    onSuccess: () => {
      toast.success('参数已更新')
      detailQuery.refetch()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '保存失败'),
  })

  const queryClient = useQueryClient()

  /**
   * 单个需求的商机状态流转（正式路径，不用批量改）：
   * 改状态的同时写一条需求记录留痕，列表页统计/漏斗随之变化。
   */
  const changeStatus = async (next: string) => {
    if (!id || !next || next === detail?.status) return
    const from = requirementStatusLabel(detail?.status)
    const to = requirementStatusLabel(next)
    try {
      await requirementApi.update(id, { status: next })
      await requirementApi
        .addLog(id, {
          type: 'other',
          content: `商机状态流转：${from} → ${to}`,
          changes: [{ field: '状态', from, to }],
        })
        .catch(() => {})
      toast.success(`状态已更新为「${to}」`)
      detailQuery.refetch()
      logsQuery.refetch()
      queryClient.invalidateQueries({ queryKey: ['requirements'] })
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '状态更新失败')
    }
  }

  const logMutation = useMutation({
    mutationFn: () =>
      requirementApi.addLog(id!, {
        type: logForm.type,
        content: logForm.content,
        // 变更明细仅在「需求变更」时提交，且过滤掉没填字段名的空行
        changes:
          logForm.type === 'change'
            ? logForm.changes.filter((c) => c.field.trim())
            : undefined,
      }),
    onSuccess: () => {
      toast.success('已记录')
      setLogOpen(false)
      setLogForm({ type: 'communication', content: '', changes: [] })
      logsQuery.refetch()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '记录失败'),
  })

  const openLog = () => {
    setLogForm({ type: 'communication', content: '', changes: [] })
    setLogOpen(true)
  }
  const addChangeRow = () =>
    setLogForm((f) => ({ ...f, changes: [...f.changes, { field: '', from: '', to: '' }] }))
  const setChangeRow = (i: number, key: keyof RequirementChangeItem, val: string) =>
    setLogForm((f) => ({
      ...f,
      changes: f.changes.map((c, idx) => (idx === i ? { ...c, [key]: val } : c)),
    }))
  const removeChangeRow = (i: number) =>
    setLogForm((f) => ({ ...f, changes: f.changes.filter((_, idx) => idx !== i) }))

  /** 人工修正某个参数值后写回需求卡 */
  const editField = (key: string, value: string) => {
    if (!card) return
    const next: RequirementCard = JSON.parse(JSON.stringify(card))
    if (Array.isArray(next.fields)) {
      const target = next.fields.find((f) => f.key === key)
      if (target) {
        target.value = value
        target.normalized = value
        target.source = 'manual'
        target.confidence = 1
      }
    } else if (Array.isArray(next.params)) {
      const target = next.params.find((p) => p.key === key)
      if (target) target.value = value
    }
    specMutation.mutate(next)
  }

  const copyDraft = () => {
    if (!draft) return
    navigator.clipboard.writeText(draftTab === 'wechat' ? draft.wechat : draft.email)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
    toast.success('已复制到剪贴板')
  }

  if (detailQuery.isLoading) return <PageLoader />
  if (detailQuery.isError || !detail) {
    return <ErrorState message="需求加载失败" onRetry={() => detailQuery.refetch()} />
  }

  // 需求记录 → 时间线条目。变更类型附带的改动明细从 metadata(JSON) 还原成小标签
  const logItems: TimelineItem[] = (logsQuery.data || []).map((l: RequirementLog) => {
    const meta = LOG_TYPE_META[l.type] || LOG_TYPE_META.other
    let changes: RequirementChangeItem[] = []
    if (l.metadata) {
      try {
        const parsed = JSON.parse(l.metadata)
        if (Array.isArray(parsed)) changes = parsed
      } catch {
        /* 坏数据不影响展示 */
      }
    }
    return {
      id: l.id,
      title: meta.label,
      tone: meta.tone,
      time: new Date(l.createdAt).toLocaleString('zh-CN'),
      actor: l.actorName,
      description: (
        <div className="space-y-1.5">
          <div className="whitespace-pre-wrap text-ink-soft">{l.content}</div>
          {changes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {changes.map((c, i) => (
                <span
                  key={i}
                  className="text-caption px-2 py-0.5 rounded bg-warning-bg text-warning-fg"
                >
                  {c.field}：{c.from?.trim() || '—'} → {c.to?.trim() || '—'}
                </span>
              ))}
            </div>
          )}
        </div>
      ),
    }
  })

  return (
    <>
      <DetailLayout
        backTo="/requirements"
        backLabel="返回需求列表"
        code={detail.requirementNo}
        title={detail.title}
        badges={
          <>
            <StatusBadge status={detail.status} label={requirementStatusLabel(detail.status)} />
            {/* 商机状态单个流转入口：选择即保存并写入需求记录 */}
            <select
              value={detail.status || ''}
              onChange={(e) => changeStatus(e.target.value)}
              className="eo-input !w-auto !py-0.5 !text-caption"
              title="流转商机状态"
              aria-label="流转商机状态"
            >
              {!REQUIREMENT_STATUS_OPTIONS.some((o) => o.value === detail.status) && (
                <option value={detail.status || ''}>{detail.status || '未指定'}</option>
              )}
              {REQUIREMENT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {/* 产品分类是需求的主标识，留在标题旁；需求来源移到下方元信息行 */}
            {card?.product_category && (
              <span className="text-caption px-2 py-0.5 rounded bg-accent-50 text-accent-700">
                {card.product_category}
              </span>
            )}
          </>
        }
        meta={
          <>
            {detail.customer?.name && (
              <button
                onClick={() => navigate(`/customers/${detail.customerId}`)}
                className="hover:text-accent-600 transition-colors"
              >
                客户：{detail.customer.name}
              </button>
            )}
            {detail.category && (
              <span>来源：{SOURCE_CATEGORY_LABELS[detail.category] || detail.category}</span>
            )}
            <span>优先级：{PRIORITY_LABELS[detail.priority || ''] || '中'}</span>
            <span className="font-mono">{new Date(detail.createdAt).toLocaleString('zh-CN')}</span>
            {fields.length > 0 && (
              <span className={completeness < 60 ? 'text-warning-fg' : ''}>
                参数完整度 {completeness}%
              </span>
            )}
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => analyzeMutation.mutate()} loading={analyzeMutation.isPending}>
              <Sparkles size={15} className="mr-1" /> 结构化识别
            </Button>
            <Button
              variant="secondary"
              onClick={() => draftMutation.mutate()}
              loading={draftMutation.isPending}
              disabled={!detail.structuredSpec}
              title={detail.structuredSpec ? undefined : '请先执行结构化识别'}
            >
              <MessageSquare size={15} className="mr-1" /> 生成客户回复
            </Button>
            <Button variant="secondary" onClick={() => setCalcOpen(true)}>
              <Calculator size={15} className="mr-1" /> 计算工具
            </Button>
            <Button variant="secondary" onClick={openLog}>
              <ClipboardList size={15} className="mr-1" /> 需求记录
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate('/ai-assistant', {
                state: {
                  initialQuery: `请基于知识库分析需求“${detail.title}”，梳理关键参数、缺失信息，并生成一段可直接回复客户的文字。需求描述：${detail.description || '未填写'}`,
                },
              })}
            >
              <Bot size={15} className="mr-1" /> AI 分析与回复
            </Button>
            {/*
              需求识别文件：按需求模板的字段定义逐项列出，未填项留空并画线，
              发给客户核对。空白项本身就是在提示「这里还需要你确认」。
              PDF 与 Word 由后端同一份数据生成，内容完全一致，仅格式不同 ——
              所以收进一个按钮，点开再选导出格式。
            */}
            <div className="relative" ref={exportRef}>
              <Button
                variant="secondary"
                onClick={() => setExportOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={exportOpen}
              >
                <FileDown size={15} className="mr-1" /> 需求识别文件
                <ChevronDown size={14} className="ml-1" />
              </Button>
              {exportOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 w-40 eo-card shadow-pop overflow-hidden z-50 py-1"
                >
                  <button
                    role="menuitem"
                    onClick={() => { setExportOpen(false); setPreviewOpen(true) }}
                    className="w-full text-left px-3 py-2 text-sm text-ink-soft hover:bg-canvas hover:text-ink transition-colors flex items-center gap-2"
                  >
                    <FileDown size={14} /> 预览
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => { setExportOpen(false); exportIdentification('pdf') }}
                    className="w-full text-left px-3 py-2 text-sm text-ink-soft hover:bg-canvas hover:text-ink transition-colors flex items-center gap-2"
                  >
                    <FileDown size={14} /> 导出 PDF
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => { setExportOpen(false); exportIdentification('docx') }}
                    className="w-full text-left px-3 py-2 text-sm text-ink-soft hover:bg-canvas hover:text-ink transition-colors flex items-center gap-2"
                  >
                    <FileDown size={14} /> 导出 Word
                  </button>
                </div>
              )}
            </div>
            <Button onClick={() => navigate(`/proposals?requirementId=${detail.id}`)}>
              <Layers size={15} className="mr-1" /> 新建方案
            </Button>
          </>
        }
        tabs={[
          { value: 'basic', label: '基本信息', icon: FileText },
          { value: 'params', label: '结构化参数', icon: Sparkles, count: fields.length },
          { value: 'proposals', label: '关联方案', icon: Layers },
          { value: 'docs', label: '关联资料', icon: Paperclip, count: docsQuery.data?.length },
          { value: 'calc', label: '计算记录', icon: Calculator },
          { value: 'logs', label: '需求记录', icon: ClipboardList, count: logsQuery.data?.length },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      >
        {/* 自动识别状态：识别中 / 待人确认 */}
        {(detail as any).specStatus === 'analyzing' && (
          <div className="eo-card p-4 border-l-4 border-l-info-fg flex items-center gap-3">
            <Sparkles size={17} className="text-info-fg animate-pulse flex-shrink-0" />
            <div className="text-sm text-ink">AI 正在阅读需求资料、识别技术参数（通常 30–60 秒），完成后自动显示，无需刷新</div>
          </div>
        )}
        {specMeta.review && (detail as any).specStatus === 'done' && (
          <div className="eo-card p-4 border-l-4 border-l-accent-500 flex items-start gap-3 flex-wrap">
            <Sparkles size={17} className="text-accent-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-[220px] text-sm">
              <div className="font-medium text-ink">
                AI 已根据 {specMeta.sources.length || '上传的'} 份资料自动识别出 {fields.length} 个参数
                {Array.isArray((card as any)?.missing) && (card as any).missing.length > 0 && `，还缺 ${(card as any).missing.length} 项`}，请核对
              </div>
              {specMeta.sources.length > 0 && (
                <div className="text-caption text-muted mt-0.5 truncate" title={specMeta.sources.join('、')}>依据：{specMeta.sources.join('、')}</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setTab('params')}>去核对</Button>
              <Button size="sm" onClick={() => confirmSpecMutation.mutate()} loading={confirmSpecMutation.isPending}>确认无误</Button>
            </div>
          </div>
        )}

        {/* 缺失关键参数提示 —— 这些正是要向客户补充确认的字段 */}
        {tab !== 'params' && missingCritical.length > 0 && (
          <div className="eo-card p-4 border-l-4 border-l-warning-fg flex items-start gap-3">
            <AlertTriangle size={17} className="text-warning-fg mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-body-sm font-semibold text-ink">
                缺少 {missingCritical.length} 项关键参数
              </div>
              <div className="text-label text-muted mt-0.5">
                {missingCritical.slice(0, 6).map((f) => f.label).join('、')}
                {missingCritical.length > 6 && ` 等 ${missingCritical.length} 项`}
                —— 影响方案匹配与报价准确性
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => draftMutation.mutate()} loading={draftMutation.isPending}>
              <MessageSquare size={13} className="mr-1" /> 生成客户回复
            </Button>
          </div>
        )}

        {tab === 'basic' && (
          <div className="eo-card p-5 space-y-5">
            <KeyValueList
              items={[
                { label: '需求编号', value: detail.requirementNo, mono: true },
                { label: '客户', value: detail.customer?.name },
                { label: '需求类型', value: (detail as any).requirementType || '—' },
                { label: '需求来源', value: SOURCE_CATEGORY_LABELS[detail.category || ''] || detail.category || '—' },
                { label: '联系人', value: [(detail as any).contactName, (detail as any).contactPhone].filter(Boolean).join(' · ') || '—' },
                { label: '产品类型', value: (detail as any).templateCategory || card?.product_category || '—' },
                { label: '优先级', value: PRIORITY_LABELS[detail.priority || ''] || '中' },
                { label: '状态', value: <StatusBadge status={detail.status} /> },
                {
                  label: '解析状态',
                  value: (
                    <StatusBadge
                      status={detail.specStatus}
                      label={SPEC_STATUS_LABELS[detail.specStatus || 'pending']}
                    />
                  ),
                },
                { label: '版本', value: `V${detail.version || 1}`, mono: true },
                {
                  label: '解析时间',
                  value: detail.analyzedAt ? new Date(detail.analyzedAt).toLocaleString('zh-CN') : undefined,
                  mono: true,
                },
                { label: '需求描述', value: detail.description, full: true },
                { label: '变更原因', value: detail.changeReason, full: true },
              ]}
            />
            {detail.aiAnalysis && (
              <div>
                <h4 className="text-body-sm font-semibold text-ink mb-2 flex items-center gap-1.5">
                  <Wand2 size={14} className="text-accent-500" /> AI 分析摘要
                </h4>
                <p className="text-body-sm text-ink-soft bg-subtle rounded-md p-3 whitespace-pre-wrap">
                  {detail.aiAnalysis}
                </p>
              </div>
            )}
          </div>
        )}

        {tab === 'params' && (
          <div className="eo-card p-5">
            {fields.length === 0 ? (
              <EmptyState
                bare
                icon={Sparkles}
                title="尚未结构化解析"
                description="把客户的技术附件上传到「关联资料」，系统会自动识别技术参数并标出缺失项（也可点「结构化识别」立即识别）"
                action={
                  <Button onClick={() => analyzeMutation.mutate()} loading={analyzeMutation.isPending}>
                    <Sparkles size={15} className="mr-1" /> 结构化识别
                  </Button>
                }
              />
            ) : (
              <>
                <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="eo-label mb-1">参数完整度</div>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-32 rounded-full bg-border overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              completeness >= 80 ? 'bg-success-fg' : completeness >= 60 ? 'bg-warning-fg' : 'bg-danger-fg'
                            }`}
                            style={{ width: `${completeness}%` }}
                          />
                        </div>
                        <span className="eo-num text-body-sm text-ink">{completeness}%</span>
                      </div>
                    </div>
                    {card?.product_category && (
                      <div>
                        <div className="eo-label mb-1">识别大类</div>
                        <div className="text-body-sm text-ink">{card.product_category}</div>
                      </div>
                    )}
                  </div>
                  {missingCritical.length > 0 && (
                    <span className="text-label text-warning-fg bg-warning-bg px-2.5 py-1 rounded-md">
                      缺 {missingCritical.length} 项关键参数
                    </span>
                  )}
                </div>
                <ParamTable fields={fields} onEdit={editField} />
              </>
            )}
          </div>
        )}

        {tab === 'proposals' && (
          <div className="space-y-4">
            <div className="eo-card p-5">
              <h4 className="text-body-sm font-semibold text-ink mb-3">该需求下的方案</h4>
              {(proposalsQuery.data as any[])?.length ? (
                <div className="space-y-1.5">
                  {((proposalsQuery.data as any[]) || []).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => navigate(`/proposals?highlight=${p.id}`)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-md bg-subtle hover:bg-canvas transition-colors text-left"
                    >
                      <span className="font-mono text-caption text-muted">{p.proposalNo}</span>
                      <span className="text-body-sm text-ink flex-1 truncate">{p.title}</span>
                      <StatusBadge status={p.status} />
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState bare icon={Layers} title="还没有方案" description="点击右上角「新建方案」开始" />
              )}
            </div>

            <div className="eo-card p-5">
              <h4 className="text-body-sm font-semibold text-ink mb-1">历史相似方案</h4>
              <p className="text-label text-muted mb-3">
                基于参数相似度 + 语义检索，从历史方案里找可复用的参考
              </p>
              {matchQuery.isLoading ? (
                <PageLoader />
              ) : ((matchQuery.data as any)?.results || (matchQuery.data as any) || []).length === 0 ? (
                <EmptyState bare title="暂无相似历史方案" description="随着方案沉淀，这里会给出可复用的参考" />
              ) : (
                <div className="space-y-1.5">
                  {(((matchQuery.data as any)?.results || (matchQuery.data as any) || []) as any[]).map(
                    (m, i) => {
                      const explainable = (m.source_type === 'proposal' || m.source_type === 'solution') && !!m.source_id
                      const mKey = `${m.source_type}:${m.source_id}`
                      const active = explainKey === mKey
                      return (
                        <div key={i} className="px-3 py-2.5 rounded-md bg-subtle">
                          <div className="flex items-start gap-3">
                            <span
                              className={`font-mono text-caption px-1.5 py-0.5 rounded flex-shrink-0 ${
                                m.score >= 0.8
                                  ? 'bg-success-bg text-success-fg'
                                  : m.score >= 0.6
                                    ? 'bg-warning-bg text-warning-fg'
                                    : 'bg-neutral-bg text-neutral-fg'
                              }`}
                            >
                              {Math.round((m.score || 0) * 100)}%
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-body-sm text-ink line-clamp-2">{m.content}</div>
                              <div className="text-caption text-muted mt-0.5 font-mono">
                                {m.source_type} · {String(m.source_id).slice(0, 8)}
                              </div>
                            </div>
                            {explainable && (
                              <button
                                onClick={() => setExplainKey(active ? null : mKey)}
                                className="flex-shrink-0 text-caption text-accent-600 hover:text-accent-700"
                              >
                                {active ? '收起分析' : 'AI 分析'}
                              </button>
                            )}
                          </div>
                          {/* 匹配解释：为什么推荐这条方案，3 亮点 + 3 风险，帮售前快速判断可复用性 */}
                          {active && (
                            <div className="mt-2 pt-2 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {explainQuery.isLoading ? (
                                <p className="text-caption text-muted">分析中…</p>
                              ) : (
                                <>
                                  <div>
                                    <div className="text-caption font-medium text-success-fg mb-1">推荐亮点</div>
                                    <ul className="space-y-0.5">
                                      {((explainQuery.data as any)?.highlights || []).map((h: string, hi: number) => (
                                        <li key={hi} className="text-caption text-ink-soft">· {h}</li>
                                      ))}
                                    </ul>
                                  </div>
                                  <div>
                                    <div className="text-caption font-medium text-warning-fg mb-1">风险/关注点</div>
                                    <ul className="space-y-0.5">
                                      {((explainQuery.data as any)?.risks || []).map((r: string, ri: number) => (
                                        <li key={ri} className="text-caption text-ink-soft">· {r}</li>
                                      ))}
                                    </ul>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    },
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'docs' && (
          <div className="eo-card p-5">
            <div className="mb-3">
              <h4 className="text-body-sm font-semibold text-ink">关联资料</h4>
              <p className="text-caption text-muted mt-0.5">
                客户提供的输入资料与我方产出的输出资料，可直接上传，无需再去资料中心关联
              </p>
            </div>
            {/*
              直接复用通用文件组件：上传时区分「客户给你的（输入）/ 提交给客户的（输出）」，
              下方按输入/输出分组展示已上传资料，支持下载与移除。
            */}
            <EntityFileUpload
              entityType="requirement"
              entityId={id}
              entityNo={detail.requirementNo}
              customerId={detail.customerId}
              category="需求资料"
            />
          </div>
        )}

        {tab === 'calc' && (
          <div className="space-y-4">
            {/* 计算记录 */}
            <div className="eo-card p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-body-sm font-semibold text-ink">计算记录</h4>
                <Button variant="secondary" size="sm" onClick={() => setCalcOpen(true)}>
                  <Calculator size={13} className="mr-1" /> 使用计算工具
                </Button>
              </div>
              {(calcQuery.data || []).length === 0 ? (
                <EmptyState
                  bare
                  icon={Calculator}
                  title="尚无计算记录"
                  description="用计算工具算完后保存，结果会挂到本需求下供后续回查"
                />
              ) : (
                <div className="space-y-1.5">
                  {(calcQuery.data || []).map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-3 py-2 rounded-md bg-subtle">
                      <Calculator size={14} className="text-muted flex-shrink-0" />
                      <span className="text-body-sm text-ink flex-1 truncate">{r.title}</span>
                      <span className="text-caption text-muted">{r.templateName}</span>
                      <span className="font-mono text-caption text-muted">
                        {new Date(r.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 计算表 */}
            <div className="eo-card p-5">
              <CalcSheetList
                filters={{ relatedRequirementId: id }}
                context={{
                  relatedRequirementId: id,
                  customerId: detail.customerId,
                }}
              />
            </div>
          </div>
        )}

        {tab === 'logs' && (
          <div className="eo-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-body-sm font-semibold text-ink">需求记录</h4>
                <p className="text-caption text-muted mt-0.5">
                  记录与客户往来的沟通、需求变更与确认，始终围绕本条需求累加，不再另起版本
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={openLog}>
                <Plus size={13} className="mr-1" /> 新增记录
              </Button>
            </div>
            {logsQuery.isLoading ? (
              <p className="text-body-sm text-muted py-6 text-center">加载中…</p>
            ) : (
              <Timeline items={logItems} empty="还没有记录，点「新增记录」记下第一条沟通/变更" />
            )}
          </div>
        )}
      </DetailLayout>

      {/* 客户回复草稿 */}
      <Drawer open={draftOpen} onClose={() => setDraftOpen(false)} title="客户回复草稿" width="w-[620px]">
        {draft && (
          <div className="space-y-4">
            {(draft.missing || []).length > 0 && (
              <div className="bg-warning-bg rounded-md p-3">
                <div className="text-body-sm font-medium text-ink mb-1.5">待补充字段</div>
                <div className="flex flex-wrap gap-1.5">
                  {(draft.missing || []).map((m) => (
                    <span key={m.key} className="text-caption px-2 py-0.5 rounded bg-surface text-ink-soft">
                      {m.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <Tabs
              tabs={[
                { value: 'wechat', label: '即时消息' },
                { value: 'email', label: '邮件模板' },
              ]}
              value={draftTab}
              onChange={(v) => setDraftTab(v as any)}
            />

            <textarea
              value={draftTab === 'wechat' ? draft.wechat : draft.email}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, [draftTab]: e.target.value } : d))
              }
              rows={draftTab === 'wechat' ? 14 : 18}
              className="eo-input font-sans text-body-sm leading-relaxed"
              aria-label="客户回复草稿内容"
            />

            <Button onClick={copyDraft} className="w-full">
              {copied ? <Check size={15} className="mr-1" /> : <Copy size={15} className="mr-1" />}
              {copied ? '已复制' : `复制${draftTab === 'wechat' ? '即时消息' : '邮件正文'}`}
            </Button>
          </div>
        )}
      </Drawer>

      {/* 需求记录 */}
      <Modal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title="新增需求记录"
        onConfirm={() => logMutation.mutate()}
        loading={logMutation.isPending}
        confirmDisabled={!logForm.content.trim()}
        confirmText="保存记录"
      >
        <div className="space-y-4">
          {/* 记录类型 */}
          <div>
            <span className="eo-label">记录类型</span>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {LOG_TYPE_ORDER.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setLogForm((f) => ({ ...f, type: t }))}
                  className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                    logForm.type === t
                      ? 'border-accent-500 bg-accent-50 text-accent-700'
                      : 'border-border text-ink-soft hover:bg-canvas'
                  }`}
                >
                  {LOG_TYPE_META[t].label}
                </button>
              ))}
            </div>
          </div>

          <FormTextarea
            label="记录内容"
            value={logForm.content}
            onChange={(e) => setLogForm((f) => ({ ...f, content: e.target.value }))}
            rows={4}
            required
            placeholder={
              logForm.type === 'change'
                ? '如：客户将带钢最大宽度由 1850 调整为 2080，交期顺延两周'
                : '如：与客户电话确认了工作辊材质与热处理要求'
            }
          />

          {/* 变更明细：仅「需求变更」时出现，选填，用于留痕 */}
          {logForm.type === 'change' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="eo-label">改动明细（选填）</span>
                <button
                  type="button"
                  onClick={addChangeRow}
                  className="flex items-center gap-1 text-caption text-accent-600 hover:text-accent-700"
                >
                  <Plus size={12} /> 添加一项
                </button>
              </div>
              {logForm.changes.length === 0 ? (
                <p className="text-caption text-muted">可逐项记录「字段：原值 → 新值」，方便日后追溯举证</p>
              ) : (
                <div className="space-y-2">
                  {logForm.changes.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        className="eo-input flex-1"
                        placeholder="字段，如 带钢宽度"
                        value={c.field}
                        onChange={(e) => setChangeRow(i, 'field', e.target.value)}
                        aria-label="字段"
                      />
                      <input
                        className="eo-input w-24"
                        placeholder="原值"
                        value={c.from || ''}
                        onChange={(e) => setChangeRow(i, 'from', e.target.value)}
                        aria-label="原值"
                      />
                      <span className="text-muted flex-shrink-0">→</span>
                      <input
                        className="eo-input w-24"
                        placeholder="新值"
                        value={c.to || ''}
                        onChange={(e) => setChangeRow(i, 'to', e.target.value)}
                        aria-label="新值"
                      />
                      <button
                        type="button"
                        onClick={() => removeChangeRow(i)}
                        className="text-muted hover:text-danger-fg flex-shrink-0"
                        title={"删除该项"}
                        aria-label="删除该项"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* 行内计算工具 —— 不离开需求页 */}
      <Drawer open={calcOpen} onClose={() => setCalcOpen(false)} title="计算工具" width="w-[720px]">
        <div className="space-y-3">
          <select
            value={calcCode}
            onChange={(e) => setCalcCode(e.target.value)}
            className="eo-input py-2"
            aria-label="选择计算工具"
          >
            <option value="line_capacity">产能计算</option>
            <option value="straightener_config">矫直机配置计算</option>
            <option value="disc_shear_config">圆盘剪配置计算</option>
            <option value="hydraulic_nut_design">液压螺母设计计算</option>
            <option value="coupling_selection">联轴器选型计算</option>
          </select>
          <CalcRunner
            key={calcCode}
            code={calcCode}
            context={{
              relatedRequirementId: id,
              customerId: detail.customerId,
              contextLabel: '本需求',
            }}
            onSaved={() => {
              calcQuery.refetch()
              toast.success('计算记录已挂到本需求')
            }}
          />
        </div>
      </Drawer>

      {/* 导出预览：按文档版式预览、改值后再导出 PDF/Word */}
      <IdentificationPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        requirementId={id || null}
      />
    </>
  )
}

