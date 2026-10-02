import { useState, useRef, useEffect } from 'react'
import { Bot, X, Send, Sparkles, Trash2, Loader2, ExternalLink, Square, RotateCcw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { usePageAssistantInfo } from '../contexts/PageAssistantContext'
import ConfirmDialog from './ConfirmDialog'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  sources?: { sourceType?: string; sourceId?: string; content?: string }[]
  /** 回答依据是否来自当前页面（而非全库检索） */
  fromPage?: boolean
  /** 请求失败时记录原问题，便于"重试" */
  retryQuestion?: string
}

const SOURCE_LABELS: Record<string, string> = {
  customer: '客户',
  requirement: '需求',
  proposal: '方案',
  solution: '标准方案',
  quotation: '报价',
  contract: '合同',
  project: '项目',
  product: '产品',
  supplier: '供应商',
  ticket: '售后',
  document: '业务资料',
  knowledge: '知识资料',
}

function sourcePath(s: { sourceType?: string; sourceId?: string }): string | null {
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
    case 'contract': return `/contracts?highlight=${s.sourceId}`
    case 'ticket': return `/after-sales?highlight=${s.sourceId}`
    case 'document': return `/documents?highlight=${s.sourceId}`
    case 'knowledge': return `/knowledge?highlight=${s.sourceId}`
    default: return null
  }
}

const storageKey = (pageKey: string) => `aikb-page-assistant-${pageKey}`

/**
 * 把正文里的 [1][2] 角标改写成可点链接（与「智能问答」页同一套做法）。
 * 代码块内的方括号跳过，避免把示例代码里的 [0] 也变成链接。
 */
const CITE_SCHEME = 'cite:'
function linkifyCitations(markdown: string): string {
  return markdown.replace(/(```[\s\S]*?```|`[^`]*`)|\[(\d{1,2})\]/g, (m, code, n) =>
    code ? m : `[[${n}]](${CITE_SCHEME}${n})`,
  )
}

/**
 * 页面内 AI 助手（悬浮球）。
 *
 * 与「智能问答」页的区别：这里只回答**当前页面**的事 —— 页面通过
 * useRegisterPageAssistant 把"用户此刻看到什么"注册进来，提问时一并送给后端，
 * 模型优先据此作答。改造前这个组件只是按模块换了几句建议语，请求里没有任何页面信息，
 * 所以"只回答本页内容"根本无从谈起。
 *
 * 会话按页面 key 存 localStorage：关掉再打开还在，不同页面互不干扰，可一键清空。
 */
export default function AssistantWidget() {
  const info = usePageAssistantInfo()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(false)
  /** 流式阶段：检索中 → 正在作答。空正文期间只显示思考态，别让空气泡带着"依据"先亮出来 */
  const [phase, setPhase] = useState<'retrieving' | 'answering' | null>(null)
  // 清空对话的二次确认：垃圾桶就在关闭按钮旁边，点错等于把整段问答抹掉
  const [confirmClear, setConfirmClear] = useState(false)
  // 可中断：与智能问答页对齐，生成中可"停止"
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const pageKey = info?.key || ''

  // 切换页面时载入该页自己的历史
  useEffect(() => {
    if (!pageKey) return
    try {
      setMessages(JSON.parse(localStorage.getItem(storageKey(pageKey)) || '[]'))
    } catch {
      setMessages([])
    }
  }, [pageKey])

  useEffect(() => {
    if (!pageKey) return
    localStorage.setItem(storageKey(pageKey), JSON.stringify(messages.slice(-40)))
  }, [messages, pageKey])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  // 页面没注册上下文（登录页、设置页等）就不显示
  if (!info) return null

  const suggestions = info.questions?.length
    ? info.questions
    : ['这一页的数据有什么值得注意的？', '帮我总结当前列表的关键信息']

  /**
   * 提问（流式）。
   *
   * 改流式的原因：原来走非流式的 /search/assistant，一个问题要干等 10~30 秒，
   * 期间只有一行"正在读取本页数据并作答…"，用户不知道它是卡住了还是在想。
   * 现在与「智能问答」页共用 /search/stream，先推送检索到的来源（立刻能看到
   * "找到了几条依据"），再逐字输出正文。
   */
  const ask = async (question: string) => {
    if (!question.trim() || loading) return
    const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }))
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: question },
      // 空的 assistant 消息用于流式填充
      { role: 'assistant', content: '', sources: [], fromPage: !!info.context },
    ])
    setInput('')
    setLoading(true)
    setPhase('retrieving')

    // 可中断：切页/关闭/停止时 abort，读流循环会抛 AbortError
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const patchLast = (patch: Partial<Msg>) =>
      setMessages((prev) => {
        const next = [...prev]
        const i = next.length - 1
        if (i >= 0 && next[i].role === 'assistant') next[i] = { ...next[i], ...patch }
        return next
      })

    try {
      const base = import.meta.env.VITE_API_BASE_URL || '/api'
      const res = await fetch(`${base}/search/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          query: question,
          sourceTypes: info.sourceTypes,
          pageContext: info.context,
          history,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reader = res.body?.getReader()
      if (!reader) throw new Error('无法读取响应流')

      const decoder = new TextDecoder()
      let buffer = ''
      let answer = ''
      let sources: Msg['sources'] = []
      let done = false

      while (!done) {
        const { done: finished, value } = await reader.read()
        if (finished) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(trimmed.slice(6))
            if (ev.type === 'sources') {
              sources = ev.sources || []
              setPhase('answering')
              patchLast({ sources })
            } else if (ev.type === 'token') {
              answer += ev.content || ''
              setPhase('answering')
              patchLast({ content: answer, sources })
            } else if (ev.type === 'error') {
              answer += ev.message || ''
              patchLast({ content: answer })
            } else if (ev.type === 'done') {
              done = true
              break
            }
          } catch {
            // 非 JSON 行跳过
          }
        }
      }

      if (!answer) patchLast({ content: '未获得回答，请重试。' })
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        // 用户主动停止：保留半截内容并标注，与智能问答页行为一致
        setMessages((prev) => {
          const next = [...prev]
          const i = next.length - 1
          if (i >= 0 && next[i].role === 'assistant') {
            next[i] = { ...next[i], content: (next[i].content || '') + '\n\n（已停止生成）' }
          }
          return next
        })
      } else {
        patchLast({ content: `请求失败：${e?.message || '请稍后重试'}`, retryQuestion: question })
      }
    } finally {
      setLoading(false)
      setPhase(null)
    }
  }

  const clear = () => {
    setMessages([])
    if (pageKey) localStorage.removeItem(storageKey(pageKey))
    setConfirmClear(false)
  }

  return (
    <>
      {!open && (
        /* 悬浮球：底部抬高避开分页控件（bottom-6→bottom-8），z-50 保证不被内容盖住 */
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-8 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-accent-500 to-accent-600 text-white shadow-[0_8px_24px_rgba(0,0,0,0.28)] flex items-center justify-center hover:scale-105 transition-transform z-50 ring-4 ring-accent-500/20"
          aria-label={`${info.label} AI 助手`}
          title={`${info.label} · AI 助手（只回答本页内容）`}
        >
          <span className="absolute inset-0 rounded-full bg-accent-400/40 animate-ping" />
          <Bot size={26} className="relative" />
        </button>
      )}

      {open && (
        <div className="fixed bottom-8 right-6 w-96 max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-3rem)] bg-surface rounded-xl shadow-2xl border border-border flex flex-col z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-accent-500/10 to-transparent rounded-t-xl">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent-500 to-accent-600 flex items-center justify-center shrink-0">
                <Sparkles size={15} className="text-white" />
              </div>
              <div className="min-w-0">
                <div className="font-serif text-sm font-semibold text-ink truncate">
                  {info.label} · AI 助手
                </div>
                <div className="text-caption text-muted">只回答本页内容</div>
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              {messages.length > 0 && (
                <button
                  onClick={() => setConfirmClear(true)}
                  title="清空对话"
                  className="w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-danger-fg hover:bg-danger-bg"
                >
                  <Trash2 size={15} />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted hover:text-ink hover:bg-canvas"
              >
                <X size={17} />
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-4">
                <div className="w-12 h-12 rounded-full bg-accent-50 flex items-center justify-center mx-auto mb-2">
                  <Bot size={22} className="text-accent-400" />
                </div>
                <p className="text-sm font-medium text-ink-soft">关于「{info.label}」，问我</p>
                <p className="text-xs text-muted mt-0.5">回答依据当前页面的数据</p>
                <div className="space-y-1.5 mt-3 text-left">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => ask(s)}
                      className="block w-full text-left text-xs text-ink-soft bg-subtle hover:bg-accent-50 hover:text-accent-600 p-2.5 rounded-md transition-colors"
                    >
                      <Sparkles size={11} className="inline mr-1.5 text-accent-400" />
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              // 这条正在流式生成：还没有正文时只显示思考态，
              // 否则用户会先看到一个空气泡带着"依据：…"，像是倒着来的
              const streaming = loading && i === messages.length - 1 && m.role === 'assistant'
              if (streaming && !m.content) {
                return (
                  <div key={i} className="flex justify-start">
                    <div className="bg-canvas px-3 py-2 rounded-lg rounded-bl-sm text-sm text-muted inline-flex items-center gap-2">
                      <Loader2 size={13} className="animate-spin" />
                      {phase === 'answering'
                        ? `已找到 ${m.sources?.length ?? 0} 条依据，正在作答…`
                        : '正在读取本页数据…'}
                    </div>
                  </div>
                )
              }
              return (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[88%] px-3 py-2 rounded-lg text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-accent-500 text-white rounded-br-sm'
                      : 'bg-canvas text-ink-soft rounded-bl-sm'
                  }`}
                >
                  {/*
                    助手回答按 Markdown 渲染。
                    原来是 whitespace-pre-wrap 纯文本直出 —— 模型返回的
                    **加粗**、- 列表、# 标题会原样露出符号，用户看到的是一堆 ** 和 #。
                    （提示词已同时约束不要用标题和表格，这里负责把剩下的
                     加粗与列表渲染成人看的样子。）
                  */}
                  {m.role === 'assistant' ? (
                    <div className="markdown-body markdown-compact">
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
                            const src = m.sources?.[n - 1]
                            const path = src ? sourcePath(src) : null
                            return (
                              <button
                                type="button"
                                title={
                                  src
                                    ? `${SOURCE_LABELS[src.sourceType || ''] || src.sourceType || '来源'}：${(src.content || '').slice(0, 60)}`
                                    : '未找到对应来源'
                                }
                                onClick={() => path && navigate(path)}
                                className="align-super text-[10px] mx-0.5 px-1 rounded bg-accent-50 text-accent-700 hover:bg-accent-100 transition-colors"
                              >
                                {children}
                              </button>
                            )
                          },
                        }}
                      >
                        {linkifyCitations(m.content)}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  )}
                  {/* 请求失败的消息给"重试"入口 */}
                  {m.role === 'assistant' && m.retryQuestion && !loading && (
                    <button
                      onClick={() => ask(m.retryQuestion!)}
                      className="mt-1.5 inline-flex items-center gap-1 text-caption text-accent-600 hover:text-accent-700"
                    >
                      <RotateCcw size={12} /> 重试
                    </button>
                  )}
                  {/* 答案来源：说清是本页数据还是库里检索来的，并可点开原始记录 */}
                  {m.role === 'assistant' && (
                    <div className="mt-1.5 pt-1.5 border-t border-border/70 text-caption text-muted">
                      {/*
                        依据要说实话。
                        原来只看"这一页有没有注册上下文"就一律显示「依据：本页数据」，
                        哪怕答案完全来自全库检索也照说不误。现在按实际用了什么来标：
                        送了页面数据就算一项，检索到记录再算一项，两样都没有就直说。
                      */}
                      <span>
                        依据：
                        {[
                          m.fromPage ? '本页数据' : '',
                          m.sources?.length ? `知识库 ${m.sources.length} 条` : '',
                        ]
                          .filter(Boolean)
                          .join(' + ') || '无检索依据'}
                      </span>
                      {!!m.sources?.length && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {m.sources.slice(0, 5).map((s, k) => {
                            const path = sourcePath(s)
                            const label = SOURCE_LABELS[s.sourceType || ''] || s.sourceType || '来源'
                            return (
                              <button
                                key={k}
                                disabled={!path}
                                onClick={() => path && navigate(path)}
                                title={(s.content || '').slice(0, 80)}
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-surface border border-border hover:border-accent-300 hover:text-accent-600 disabled:opacity-60 disabled:cursor-default"
                              >
                                [{k + 1}] {label}
                                {path && <ExternalLink size={9} />}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              )
            })}
            {/*
              思考态已经画在那条正在生成的 assistant 消息里了（见上面的 streaming 分支），
              这里不能再放一个独立的加载气泡，否则会同时出现两个。
            */}
          </div>

          <div className="border-t border-border p-3 flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ask(input)
                }
              }}
              placeholder={`关于${info.label}的问题…`}
              className="eo-input flex-1"
            />
            {loading ? (
              /* 生成中给一个出口：长回答等不下去时能停，停下来的半截内容保留 */
              <button
                onClick={() => abortRef.current?.abort()}
                className="w-9 h-9 rounded-lg bg-subtle border border-border text-ink flex items-center justify-center hover:bg-canvas transition-colors shrink-0"
                title="停止生成"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                onClick={() => ask(input)}
                disabled={!input.trim()}
                className="w-9 h-9 rounded-lg bg-accent-500 text-white flex items-center justify-center hover:bg-accent-600 transition-colors disabled:opacity-40 shrink-0"
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clear}
        title="确认清空对话"
        confirmText="清空"
        message={`确定清空「${info.label}」的对话吗？`}
        detail={`当前 ${messages.length} 条问答会被删除，无法恢复。`}
      />
    </>
  )
}
