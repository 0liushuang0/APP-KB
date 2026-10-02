import { useState, useRef, useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Send,
  Bot,
  User,
  MessageSquare,
  Download,
  Database,
  Plus,
  Trash2,
  Quote,
  ArrowUpRight,
  PanelRightClose,
  PanelRight,
  Sparkles,
  Copy,
  ClipboardPlus,
  RotateCcw,
  Loader2,
  Square,
} from 'lucide-react'
import AIFeedback from '../components/AIFeedback'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { aiConfigApi, aiIndexApi, requirementApi } from '../api/services'
import { notifyIfPermitted } from '../utils/notifications'
import Button from '../components/Button'
import EmptyState from '../components/EmptyState'
import ConfirmDialog from '../components/ConfirmDialog'

interface Source {
  sourceType?: string
  sourceId?: string
  content?: string
  score?: number
  documentId?: string
  title?: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  createdAt: number
}

interface Session {
  id: string
  title: string
  messages: Message[]
  updatedAt: number
}

const scopes = [
  { value: '', label: '全部' },
  { value: 'customer', label: '客户' },
  { value: 'requirement', label: '需求' },
  { value: 'proposal', label: '方案' },
  { value: 'quotation', label: '报价' },
  { value: 'product', label: '产品' },
  { value: 'supplier', label: '供应商' },
  { value: 'project', label: '项目' },
  { value: 'document', label: '文档' },
]

/**
 * 预设问题按场景分组。
 *
 * 挑选标准：每一条都必须是系统里真有数据、且能答出具体结论的问法。
 * 之前那四条（「整理客户需求…」「查找相似历史方案…」）没有主语，
 * 用户点了也不知道该补什么条件，回答自然是空泛的。
 */
const PRESET_GROUPS: Array<{ label: string; icon: typeof Bot; questions: string[] }> = [
  {
    label: '客户与商机',
    icon: User,
    questions: [
      '宝钢湛江这个客户的在手需求和最近跟进情况',
      '哪些 A 类客户超过 90 天没有跟进？',
    ],
  },
  {
    label: '方案与选型',
    icon: Sparkles,
    questions: [
      '拉矫机有哪些历史方案，关键参数差异在哪？',
      '这条需求还缺哪些参数才能出方案？',
    ],
  },
  {
    label: '报价与成本',
    icon: Database,
    questions: [
      '拉矫机历史成交价区间是多少？',
      '按现有报价明细，这个产品的成本构成是什么？',
    ],
  },
  {
    label: '供应链',
    icon: Quote,
    questions: [
      '液压件有哪些一线品牌的合格供应商？',
      '哪些供应商能供气动件，交期分别多久？',
    ],
  },
]

const SOURCE_LABELS: Record<string, string> = {
  customer: '客户',
  requirement: '需求',
  proposal: '方案',
  solution: '方案模板',
  quotation: '报价',
  product: '产品',
  supplier: '供应商',
  project: '项目',
  document: '资料',
}

/** 引用来源 → 可跳转的页面路径 */
function sourcePath(s: Source): string | null {
  if (!s.sourceId) return null
  switch (s.sourceType) {
    case 'customer': return `/customers/${s.sourceId}`
    case 'requirement': return `/requirements/${s.sourceId}`
    case 'proposal': return `/proposals?highlight=${s.sourceId}`
    case 'quotation': return `/quotations?highlight=${s.sourceId}`
    case 'product': return `/products?highlight=${s.sourceId}`
    case 'supplier': return `/suppliers?highlight=${s.sourceId}`
    case 'project': return `/projects?highlight=${s.sourceId}`
    case 'solution': return `/solutions?highlight=${s.sourceId}`
    case 'document': return `/documents?highlight=${s.sourceId}`
    case 'contract': return `/contracts?highlight=${s.sourceId}`
    case 'ticket': return `/after-sales?highlight=${s.sourceId}`
    case 'knowledge': return `/knowledge?highlight=${s.sourceId}`
    default: return null
  }
}

/**
 * 把正文里的 [1][2] 角标变成可点的链接。
 *
 * 模型按提示词会在结论后标 [n]，但那只是纯文本 —— 用户看到"依据 [3]"却点不动，
 * 还得自己去右侧引用栏数第几条。这里先把 [n] 改写成 markdown 链接，
 * 再由自定义的 a 渲染器拦下 cite: 协议跳到对应来源。
 */
const CITE_SCHEME = 'cite:'
function linkifyCitations(markdown: string): string {
  // 跳过代码块内的方括号，避免把示例代码里的 [0] 也变成链接
  return markdown.replace(/(```[\s\S]*?```|`[^`]*`)|\[(\d{1,2})\]/g, (m, code, n) =>
    code ? m : `[[${n}]](${CITE_SCHEME}${n})`,
  )
}

const STORAGE_KEY = 'aikb-assistant-sessions'

export default function AIAssistant() {
  const navigate = useNavigate()
  const location = useLocation()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('')
  const [loading, setLoading] = useState(false)
  /**
   * 流式阶段：检索中 → 正在作答。
   *
   * 之前一提问就先插入一条空的 assistant 消息，而气泡底部的「复制客户回复」是
   * 无条件渲染的 —— 于是用户先看到"复制客户回复"，正文才慢慢流进来，像是倒着来的。
   * 现在空消息期间只显示思考态，操作栏等有正文且流结束后才出现。
   */
  const [phase, setPhase] = useState<'retrieving' | 'answering' | null>(null)
  const [sourceCount, setSourceCount] = useState(0)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  // 待确认删除的对话（删除图标 hover 才出现，就在标题右边，很容易蹭到）
  const [deletingSession, setDeletingSession] = useState<Session | null>(null)
  /*
   * 进行中流式请求的中止句柄。
   *
   * 之前没有它：切走会话、切路由、甚至再问一个问题，上一条流都还在后台跑，
   * 且回调里按 sessionId 往 setSessions 里写 —— 内容会追加到已经切走的那条
   * 会话上（"串话"），离开页面后还在改状态。
   */
  const abortRef = useRef<AbortController | null>(null)
  /** 引用栏展示哪条消息的来源；null 表示跟随最后一条回答 */
  const [pinnedMsgIdx, setPinnedMsgIdx] = useState<number | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(true)
  const [savingMessage, setSavingMessage] = useState<number | null>(null)
  const healthQuery = useQuery({
    queryKey: ['ai-health'],
    queryFn: () => aiConfigApi.health(),
    refetchInterval: 30_000,
    retry: false,
  })
  const aiOnline = healthQuery.data?.online === true

  /*
   * 首屏说明用真实索引数据生成，而不是写死一句"会检索客户、需求、…、供应商"。
   * 之前那句话把没进索引的类型也一并承诺了，用户按它提问却什么也查不到。
   */
  const indexQuery = useQuery({
    queryKey: ['ai-index-health'],
    queryFn: () => aiIndexApi.health(),
    staleTime: 60_000,
    retry: false,
  })
  const indexSummary = useMemo(() => {
    const rows = (indexQuery.data?.rows || []).filter((r) => (r.indexed ?? 0) > 0)
    if (!rows.length) return ''
    const top = [...rows].sort((a, b) => (b.indexed ?? 0) - (a.indexed ?? 0)).slice(0, 6)
    const parts = top.map((r) => `${r.label} ${r.indexed}`).join(' · ')
    return `当前可检索：${parts}，回答附可核对的引用依据。`
  }, [indexQuery.data])

  useEffect(() => {
    const initialQuery = (location.state as { initialQuery?: string } | null)?.initialQuery
    if (!initialQuery) return
    setQuery(initialQuery)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        setSessions(parsed)
        if (parsed.length && !activeSessionId) setActiveSessionId(parsed[0].id)
      }
    } catch {
      // 本地缓存损坏时静默重来，不阻断使用
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  }, [sessions])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    setPinnedMsgIdx(null)
  }, [activeSession?.messages.length])

  // 离开页面时掐掉进行中的流：否则读循环还在跑，回调继续 setState，
  // React 会报 "unmounted component" 且下次进来会看到半截内容突然冒出来
  useEffect(() => () => abortRef.current?.abort(), [])

  // 引用栏内容：优先显示被点选的那条，否则跟随最后一条有来源的回答
  const shownSources = useMemo(() => {
    const msgs = activeSession?.messages || []
    if (pinnedMsgIdx != null && msgs[pinnedMsgIdx]) {
      return { sources: msgs[pinnedMsgIdx].sources || [], question: msgs[pinnedMsgIdx - 1]?.content }
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant' && msgs[i].sources?.length) {
        return { sources: msgs[i].sources || [], question: msgs[i - 1]?.content }
      }
    }
    return { sources: [] as Source[], question: undefined as string | undefined }
  }, [activeSession, pinnedMsgIdx])

  const createSession = () => {
    const s: Session = { id: Date.now().toString(), title: '新对话', messages: [], updatedAt: Date.now() }
    setSessions((prev) => [s, ...prev])
    setActiveSessionId(s.id)
  }

  /** 导出当前对话为 Markdown 文件（含引用来源，方便归档与同事分享） */
  const exportMarkdown = () => {
    if (!activeSession?.messages.length) return
    const lines: string[] = [
      `# ${activeSession.title || 'AI 对话'}`,
      '',
      `> 导出时间：${new Date().toLocaleString('zh-CN')}`,
      '',
    ]
    for (const m of activeSession.messages) {
      if (m.role === 'user') {
        lines.push(`## 🙋 ${m.content}`, '')
      } else {
        lines.push(m.content || '', '')
        if (m.sources?.length) {
          lines.push('**引用来源：**')
          for (const s of m.sources) {
            lines.push(`- [${s.sourceType}] ${s.content?.slice(0, 80) || ''}`)
          }
          lines.push('')
        }
      }
      lines.push('---', '')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `AI对话-${(activeSession.title || '未命名').replace(/[\\/:*?"<>|]/g, '_')}-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  /** 删除对话：整段问答记录一次性消失且没有回收站，删之前必须确认 */
  const deleteSession = (id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      if (activeSessionId === id) setActiveSessionId(next[0]?.id || null)
      return next
    })
    setDeletingSession(null)
  }

  const copyReply = async (content: string) => {
    await navigator.clipboard.writeText(content)
    toast.success('回复已复制，可直接发送给客户')
  }

  const saveAsRequirement = async (content: string, messageIndex: number) => {
    try {
      setSavingMessage(messageIndex)
      const requirement = await requirementApi.create({
        title: content.slice(0, 40) + (content.length > 40 ? '…' : ''),
        description: content,
        category: 'customer_inquiry',
        priority: 'medium',
      })
      toast.success('已保存为客户需求')
      navigate(`/requirements/${requirement.id}`)
    } catch (error: any) {
      toast.error(error?.response?.data?.message || '保存需求失败')
    } finally {
      setSavingMessage(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim() || loading) return
    const userMessage = query.trim()
    setQuery('')
    setLoading(true)

    let sessionId = activeSessionId
    let isFirst = false
    if (!sessionId) {
      const s: Session = { id: Date.now().toString(), title: '新对话', messages: [], updatedAt: Date.now() }
      setSessions((prev) => [s, ...prev])
      sessionId = s.id
      setActiveSessionId(s.id)
      isFirst = true
    } else {
      isFirst = (activeSession?.messages.length ?? 0) === 0
    }

    // 检索还没回来之前先进入"思考"阶段，别让空气泡带着操作栏先亮出来
    setPhase('retrieving')
    setSourceCount(0)

    const userMsg: Message = { role: 'user', content: userMessage, createdAt: Date.now() }
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              title: isFirst ? userMessage.slice(0, 20) + (userMessage.length > 20 ? '…' : '') : s.title,
              messages: [...s.messages, userMsg],
              updatedAt: Date.now(),
            }
          : s,
      ),
    )

    // 添加空的 assistant 消息用于流式填充
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? { ...s, messages: [...s.messages, { role: 'assistant' as const, content: '', sources: [], createdAt: Date.now() }], updatedAt: Date.now() }
          : s,
      ),
    )

    // 上一条还在跑就先掐掉：同一个页面同时跑两条流，两边都往各自的
    // sessionId 里写，用户看到的就是内容互相插队
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const base = import.meta.env.VITE_API_BASE_URL || '/api'
      const res = await fetch(`${base}/search/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          query: userMessage,
          sourceTypes: scope ? [scope] : undefined,
          history: (activeSession?.messages || [])
            .slice(-13, -1) // 排除刚添加的空 assistant 消息
            .map(({ role, content }) => ({ role, content })),
        }),
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('无法读取响应流')

      const decoder = new TextDecoder()
      let buffer = ''
      let sources: Source[] = []
      let answer = ''

      // 流的长度由服务端决定，只能靠 reader.read() 返回 done 来收尾
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)

          try {
            const event = JSON.parse(data)
            if (event.type === 'sources') {
              sources = event.sources || []
              // 依据到手 → 进入"正在作答"，用户能看出它是先查了再答
              setSourceCount(sources.length)
              setPhase('answering')
            } else if (event.type === 'token') {
              if (!answer) setPhase('answering')
              answer += event.content || ''
              // 实时更新 assistant 消息
              setSessions((prev) =>
                prev.map((s) => {
                  if (s.id !== sessionId) return s
                  const msgs = [...s.messages]
                  msgs[msgs.length - 1] = {
                    ...msgs[msgs.length - 1],
                    content: answer,
                    sources,
                  }
                  return { ...s, messages: msgs, updatedAt: Date.now() }
                }),
              )
            } else if (event.type === 'error') {
              answer += event.message || ''
            } else if (event.type === 'done') {
              break
            }
          } catch {
            // 非 JSON 行，跳过
          }
        }
      }

      // 如果流式没有返回内容，标记失败
      if (!answer) {
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s
            const msgs = [...s.messages]
            msgs[msgs.length - 1] = {
              ...msgs[msgs.length - 1],
              content: '未收到 AI 回复，请稍后重试。',
            }
            return { ...s, messages: msgs }
          }),
        )
      } else {
        // Notify on successful AI response
        const preview = answer.length > 60 ? answer.slice(0, 60) + '…' : answer
        notifyIfPermitted('AI 回答完成', preview)
      }
    } catch (err: any) {
      // 主动中止不是错误：把已经吐出来的半截留住，标一句"已停止"就行，
      // 别把用户自己按的停止渲染成"请求失败"
      if (err?.name === 'AbortError') {
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s
            const msgs = [...s.messages]
            const last = msgs[msgs.length - 1]
            msgs[msgs.length - 1] = {
              ...last,
              content: (last?.content || '') + (last?.content ? '\n\n（已停止生成）' : '已停止生成'),
            }
            return { ...s, messages: msgs }
          }),
        )
        return
      }
      const msg = err?.message || '请求失败，请稍后重试。'
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s
          const msgs = [...s.messages]
          msgs[msgs.length - 1] = {
            ...msgs[msgs.length - 1],
            content: msg,
          }
          return { ...s, messages: msgs }
        }),
      )
    } finally {
      // 已经被新请求顶替时不要动状态，否则会把新流的 loading 关掉
      if (abortRef.current === controller) {
        abortRef.current = null
        setLoading(false)
        setPhase(null)
      }
    }
  }

  /** 用户主动停止生成 */
  const stopGenerating = () => abortRef.current?.abort()

  return (
    <div className="flex h-full gap-3">
      {/* 对话历史 */}
      <aside className="w-52 eo-card p-3 hidden xl:flex flex-col flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <MessageSquare size={15} className="text-accent-600" />
            <h2 className="text-body-sm font-semibold text-ink">对话历史</h2>
          </div>
          <button onClick={createSession} className="text-accent-600 hover:text-accent-700" title={"新建对话"}
          aria-label="新建对话">
            <Plus size={16} />
          </button>
        </div>
        <div className="space-y-0.5 flex-1 overflow-y-auto">
          {sessions.length === 0 && <p className="text-label text-muted px-2">暂无对话</p>}
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => setActiveSessionId(s.id)}
              className={`group flex items-center justify-between px-2.5 py-1.5 rounded-md text-body-sm cursor-pointer ${
                activeSessionId === s.id
                  ? 'bg-accent-50 text-accent-700 font-medium'
                  : 'text-ink-soft hover:bg-subtle'
              }`}
            >
              <span className="truncate flex-1">{s.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); setDeletingSession(s) }}
                className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger-fg flex-shrink-0"
                title={"删除对话"}
                aria-label="删除对话"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* 对话区 */}
      <div className="flex-1 eo-card flex flex-col overflow-hidden min-w-0">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Bot size={18} className="text-accent-600 flex-shrink-0" />
            <h1 className="font-serif text-heading-sm font-medium text-ink truncate">智能问答</h1>
            <span className={`hidden sm:inline-flex items-center gap-1 text-caption ${aiOnline ? 'text-success-fg' : 'text-danger-fg'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${aiOnline ? 'bg-success-fg' : 'bg-danger-fg'}`} />
              {healthQuery.isLoading ? '检测中' : aiOnline ? 'AI 在线' : 'AI 离线'}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={exportMarkdown}
              disabled={!activeSession || activeSession.messages.length === 0}
              className="w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-accent-600 hover:bg-accent-50 disabled:opacity-30 disabled:cursor-not-allowed"
              title={"导出对话为 Markdown"}
              aria-label="导出对话为 Markdown"
            >
              <Download size={15} />
            </button>
            <button
              onClick={createSession}
              className="xl:hidden w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-accent-600 hover:bg-accent-50"
              title={"新建对话"}
              aria-label="新建对话"
            >
              <Plus size={15} />
            </button>
            <Database size={13} className="text-muted" />
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="border border-border rounded-md px-2 py-1 text-label bg-surface"
              aria-label="检索范围"
            >
              {scopes.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <button
              onClick={() => setSourcesOpen((o) => !o)}
              className="lg:flex hidden w-7 h-7 items-center justify-center rounded-md text-muted hover:text-ink hover:bg-canvas"
              aria-label={sourcesOpen ? '收起引用来源' : '展开引用来源'}
            >
              {sourcesOpen ? <PanelRightClose size={15} /> : <PanelRight size={15} />}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4">
          {(!activeSession || activeSession.messages.length === 0) && (
            <div className="h-full flex items-center justify-center">
              <div className="w-full max-w-2xl text-center px-2">
                {/*
                  文案与预设问题必须与真实能力对齐。
                  原来的标题「汇总信息，快速响应客户」和四条泛泛的预设问题，
                  说的是"能干什么"，但用户拿它提问时并不知道该给什么条件；
                  这里改成直接可用的具体问法，每条都对应索引里真实存在的数据。
                */}
                <EmptyState
                  bare
                  icon={Bot}
                  title="问业务数据，不用自己翻"
                  description={
                    indexSummary ||
                    '回答基于系统内已索引的客户、需求、方案、报价、合同、项目、产品、供应商与资料，并附可核对的引用依据。'
                  }
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4 text-left">
                  {PRESET_GROUPS.map((g) => (
                    <div key={g.label} className="rounded-lg border border-border bg-surface p-2.5">
                      <div className="eo-label mb-1.5 flex items-center gap-1.5">
                        <g.icon size={12} className="text-accent-500" /> {g.label}
                      </div>
                      <div className="space-y-1">
                        {g.questions.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => setQuery(prompt)}
                            className="block w-full text-left text-label leading-relaxed px-2 py-1.5 rounded-md text-ink-soft hover:bg-accent-50 hover:text-accent-700 transition-colors"
                          >
                            <Sparkles size={11} className="inline mr-1.5 text-accent-400" />
                            {prompt}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeSession?.messages.map((msg, idx) => {
            const isLast = idx === activeSession!.messages.length - 1
            // 这条正处在流式生成中：还没有正文，或有正文但流还没结束
            const streaming = loading && isLast && msg.role === 'assistant'
            const showActions = msg.role !== 'assistant' || (!!msg.content && !streaming)
            return (
            <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-accent-50 flex items-center justify-center flex-shrink-0">
                  <Bot size={14} className="text-accent-600" />
                </div>
              )}
              <div
                className={`max-w-[calc(100%-2.5rem)] sm:max-w-[80%] rounded-lg px-3 sm:px-4 py-2.5 text-body-sm ${
                  msg.role === 'user'
                    ? 'bg-accent-600 text-white'
                    : 'bg-subtle text-ink border border-border'
                }`}
              >
                {/* 思考态：正文出来之前显示检索进度，而不是一个带操作栏的空气泡 */}
                {streaming && !msg.content ? (
                  <div className="flex items-center gap-2 text-muted">
                    <Loader2 size={13} className="animate-spin" />
                    <span>
                      {phase === 'answering'
                        ? `已找到 ${sourceCount} 条依据，正在作答…`
                        : '正在检索客户、需求、方案、报价、产品、供应商与资料…'}
                    </span>
                  </div>
                ) : (
                <div className={msg.role === 'assistant' ? 'markdown-body' : 'whitespace-pre-wrap'}>
                  {msg.role === 'assistant' ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children, ...rest }) => {
                          if (!href?.startsWith(CITE_SCHEME)) {
                            return (
                              <a href={href} target="_blank" rel="noreferrer" {...rest}>
                                {children}
                              </a>
                            )
                          }
                          const n = Number(href.slice(CITE_SCHEME.length))
                          const src = msg.sources?.[n - 1]
                          const path = src ? sourcePath(src) : null
                          return (
                            <button
                              type="button"
                              title={
                                src
                                  ? `${SOURCE_LABELS[src.sourceType || ''] || src.sourceType || '来源'}：${(src.content || '').slice(0, 60)}`
                                  : '未找到对应来源'
                              }
                              onClick={() => {
                                setPinnedMsgIdx(idx)
                                setSourcesOpen(true)
                                if (path) navigate(path)
                              }}
                              className="align-super text-[10px] mx-0.5 px-1 rounded bg-accent-50 text-accent-700 hover:bg-accent-100 transition-colors"
                            >
                              {children}
                            </button>
                          )
                        },
                      }}
                    >
                      {linkifyCitations(msg.content)}
                    </ReactMarkdown>
                  ) : (
                    msg.content
                  )}
                </div>
                )}
                {showActions && (
                <div className={`mt-2 flex items-center gap-3 text-caption ${msg.role === 'user' ? 'text-white/80' : 'text-muted'}`}>
                  {msg.role === 'assistant' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => copyReply(msg.content)}
                        className="inline-flex items-center gap-1 hover:text-accent-600 transition-colors"
                      >
                        <Copy size={11} /> 复制客户回复
                      </button>
                      {isLast && !loading && (
                        <button
                          type="button"
                          onClick={() => {
                            const prevUserMsg = activeSession!.messages[idx - 1]
                            if (prevUserMsg?.role === 'user') {
                              setQuery(prevUserMsg.content)
                            }
                          }}
                          className="inline-flex items-center gap-1 hover:text-accent-600 transition-colors"
                        >
                          <RotateCcw size={11} /> 重试
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => saveAsRequirement(msg.content, idx)}
                      disabled={savingMessage === idx}
                      className="inline-flex items-center gap-1 hover:text-white transition-colors disabled:opacity-50"
                    >
                      <ClipboardPlus size={11} /> {savingMessage === idx ? '保存中…' : '保存为需求'}
                    </button>
                  )}
                </div>
                )}
                {msg.role === 'assistant' && !!msg.content && !loading && (
                  <div className="mt-2 pt-2 border-t border-border">
                    <AIFeedback
                      messageId={`${activeSessionId}-${idx}`}
                      sessionId={activeSessionId || ''}
                      module="ai-assistant"
                      // 带上问答原文：高分回答可一键沉淀为知识库 FAQ
                      question={activeSession!.messages[idx - 1]?.role === 'user' ? activeSession!.messages[idx - 1].content : undefined}
                      answer={msg.content}
                    />
                  </div>
                )}
                {msg.role === 'assistant' && !!msg.sources?.length && (
                  <>
                    <button
                      onClick={() => setPinnedMsgIdx(idx)}
                      className={`mt-2 hidden lg:inline-flex items-center gap-1 text-caption transition-colors ${
                        pinnedMsgIdx === idx ? 'text-accent-600 font-medium' : 'text-muted hover:text-accent-600'
                      }`}
                    >
                      <Quote size={11} /> {msg.sources.length} 条引用
                    </button>
                    <details className="lg:hidden mt-2 border-t border-border pt-2">
                      <summary className="cursor-pointer text-caption text-accent-600">
                        查看 {msg.sources.length} 条引用依据
                      </summary>
                      <div className="space-y-2 mt-2">
                        {msg.sources.map((source, sourceIndex) => {
                          const path = sourcePath(source)
                          return (
                            <button
                              key={`${source.sourceType}-${source.sourceId}-${sourceIndex}`}
                              type="button"
                              onClick={() => path && navigate(path)}
                              className="block w-full text-left rounded-md bg-surface border border-border p-2"
                            >
                              <span className="font-mono text-caption text-accent-600">
                                [{sourceIndex + 1}] {SOURCE_LABELS[source.sourceType || ''] || source.sourceType}
                              </span>
                              <span className="block text-caption text-ink-soft mt-1 line-clamp-3">
                                {source.content || source.title || '（无摘要）'}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </details>
                  </>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-border flex items-center justify-center flex-shrink-0">
                  <User size={14} className="text-ink-soft" />
                </div>
              )}
            </div>
            )
          })}

          {/*
            这里原本还有一个独立的"三点跳动"气泡。思考态已经画在那条正在生成的
            assistant 消息里了，再留着就是同时出现两个气泡，所以去掉。
          */}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSubmit} className="p-3 border-t border-border bg-subtle">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={aiOnline ? "请输入您的问题…" : "AI 服务离线，输入问题将尝试本地模型…"}
              className="eo-input flex-1"
              disabled={loading}
              aria-label="提问"
            />
            {/* 生成中给一个出口：长回答等不下去时能停，停下来的半截内容保留 */}
            {loading ? (
              <Button type="button" variant="secondary" onClick={stopGenerating} className="px-5">
                <Square size={13} className="mr-1.5" /> 停止
              </Button>
            ) : (
              <Button type="submit" className="px-5">
                <Send size={15} className="mr-1" /> 发送
              </Button>
            )}
          </div>
          <p className="text-caption text-muted mt-1.5">
            {aiOnline
              ? `检索范围：${scopes.find((s) => s.value === scope)?.label || '全部'} · 回答基于知识库检索，关键数据请核对引用原文`
              : 'AI 云端服务不可用，将自动尝试本地模型（效果有限）。业务资料仍可正常浏览和管理。'}
          </p>
        </form>
      </div>

      {/* 引用来源栏 */}
      {sourcesOpen && (
        <aside className="w-[300px] eo-card p-4 hidden lg:flex flex-col flex-shrink-0">
          <div className="flex items-center gap-1.5 mb-1">
            <Quote size={15} className="text-accent-600" />
            <h2 className="text-body-sm font-semibold text-ink">引用来源</h2>
            {shownSources.sources.length > 0 && (
              <span className="font-mono text-caption text-muted ml-auto">
                {shownSources.sources.length}
              </span>
            )}
          </div>

          {shownSources.question && (
            <p className="text-caption text-muted mb-3 line-clamp-2">
              针对：{shownSources.question}
            </p>
          )}

          <div className="flex-1 overflow-y-auto space-y-2">
            {shownSources.sources.length === 0 ? (
              <p className="text-label text-muted py-8 text-center">
                提问后，这里会列出回答所依据的原始资料
              </p>
            ) : (
              shownSources.sources.map((s, i) => {
                const path = sourcePath(s)
                const score = s.score ?? 0
                return (
                  <div key={i} className="rounded-md border border-border overflow-hidden">
                    <div className="px-2.5 py-1.5 bg-subtle flex items-center gap-2">
                      <span className="font-mono text-caption px-1.5 py-0.5 rounded bg-surface text-ink-soft">
                        {SOURCE_LABELS[s.sourceType || ''] || s.sourceType || '未知'}
                      </span>
                      <span
                        className={`font-mono text-caption ${
                          score >= 0.8
                            ? 'text-success-fg'
                            : score >= 0.6
                              ? 'text-warning-fg'
                              : 'text-muted'
                        }`}
                        title="相关度"
                      >
                        {Math.round(score * 100)}%
                      </span>
                      {path && (
                        <button
                          onClick={() => navigate(path)}
                          className="ml-auto text-muted hover:text-accent-600 transition-colors"
                          aria-label="打开原文"
                          title="打开原文"
                        >
                          <ArrowUpRight size={13} />
                        </button>
                      )}
                    </div>
                    <p className="px-2.5 py-2 text-label text-ink-soft leading-relaxed line-clamp-5">
                      {s.content || s.title || '（无摘要）'}
                    </p>
                  </div>
                )
              })
            )}
          </div>
        </aside>
      )}

      {/* 对话删除确认：会话只存在本地，没有回收站兜底 */}
      <ConfirmDialog
        open={!!deletingSession}
        onClose={() => setDeletingSession(null)}
        onConfirm={() => deletingSession && deleteSession(deletingSession.id)}
        title="确认删除对话"
        message={<>确定删除对话「{deletingSession?.title}」吗？</>}
        detail={`这段对话的 ${deletingSession?.messages.length || 0} 条问答会一起删除，无法恢复。`}
      />
    </div>
  )
}

