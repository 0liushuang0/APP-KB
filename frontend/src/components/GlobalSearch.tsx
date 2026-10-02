import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, CornerDownLeft, Loader2, Sparkles } from 'lucide-react'
import { searchApi } from '../api/services'
import { useDebounce } from '../hooks/useDebounce'
import type { GlobalSearchGroup, GlobalSearchHit } from '../types'

/** 行首色点：类型的辅助识别，主识别靠分组标题 */
const TYPE_DOTS: Record<string, string> = {
  customer: 'bg-info-fg',
  requirement: 'bg-viz-3',
  proposal: 'bg-success-fg',
  quotation: 'bg-warning-fg',
  project: 'bg-viz-2',
  document: 'bg-muted',
  supplier: 'bg-accent-500',
  product: 'bg-viz-4',
  solution: 'bg-viz-5',
}

/** 高亮命中的关键词片段 */
function Highlight({ text, term }: { text?: string; term: string }) {
  if (!text) return null
  const idx = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent-100 text-accent-800 rounded-sm px-0.5">
        {text.slice(idx, idx + term.length)}
      </mark>
      {text.slice(idx + term.length)}
    </>
  )
}

export default function GlobalSearch() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [cursor, setCursor] = useState(0)
  const debounced = useDebounce(term, 250)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => searchApi.global(debounced),
    enabled: open && debounced.trim().length > 0,
    staleTime: 30_000,
  })

  // 拍平成一维列表，方便上下键在分组之间连续移动
  const flat: GlobalSearchHit[] = useMemo(
    () => (data?.groups || []).flatMap((g: GlobalSearchGroup) => g.hits),
    [data],
  )

  useEffect(() => setCursor(0), [debounced])

  // ⌘K / Ctrl+K 唤起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
        setTimeout(() => inputRef.current?.focus(), 0)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 点击外部关闭
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const clearInput = () => {
    setTerm('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const go = (hit: GlobalSearchHit) => {
    navigate(hit.path)
    setOpen(false)
    clearInput()
  }

  const askAi = () => {
    const question = term.trim()
    if (!question) return
    navigate('/ai-assistant', { state: { initialQuery: question } })
    setOpen(false)
    clearInput()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && flat[cursor]) {
      e.preventDefault()
      go(flat[cursor])
    }
  }

  let runningIndex = -1

  return (
    <div ref={boxRef} className="relative w-full max-w-[280px]">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        {/* 非受控：受控 value 在中文 IME 组字时会被重渲染回写、打断拼音（出现重复乱码）。
            term 状态仍由 onChange 维护，下拉/高亮照常工作；清空走 inputRef。 */}
        <input
          ref={inputRef}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="搜索客户、需求、方案、报价、资料…"
          aria-label="全局搜索"
          className="w-full pl-9 pr-16 py-1.5 text-body-sm text-ink bg-canvas border border-border rounded-lg outline-none
            transition-colors placeholder:text-muted
            focus:bg-surface focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
        />
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-caption text-muted
          border border-border rounded px-1.5 py-0.5 bg-surface pointer-events-none hidden sm:block">
          Ctrl K
        </kbd>
      </div>

      {open && term.trim().length > 0 && (
        <div className="absolute top-full mt-2 w-full bg-surface border border-border rounded-xl shadow-pop
          max-h-[70vh] overflow-y-auto z-50 py-2">
          <button
            type="button"
            onClick={askAi}
            className="w-full px-4 py-2.5 mb-1 flex items-center gap-2 text-left text-body-sm text-accent-700 bg-accent-50 hover:bg-accent-100 transition-colors"
          >
            <Sparkles size={14} />
            <span className="truncate">向 AI 提问：{term}</span>
            <CornerDownLeft size={13} className="ml-auto flex-shrink-0" />
          </button>
          {isFetching && flat.length === 0 && (
            <div className="flex items-center gap-2 px-4 py-6 text-body-sm text-muted justify-center">
              <Loader2 size={14} className="animate-spin" /> 搜索中…
            </div>
          )}

          {!isFetching && flat.length === 0 && (
            <div className="px-4 py-6 text-center text-body-sm text-muted">
              未找到与「{term}」相关的内容
              <div className="mt-2 font-mono text-caption">
                可用前缀：c: 客户 · r: 需求 · p: 方案 · q: 报价 · d: 资料 · s: 供应商
              </div>
            </div>
          )}

          {(data?.groups || []).map((group: GlobalSearchGroup) => (
            <div key={group.type} className="mb-1 last:mb-0">
              <div className="px-4 py-1 flex items-center justify-between">
                <span className="eo-label">{group.label}</span>
                {group.total > group.hits.length && (
                  <span className="font-mono text-caption text-muted">
                    共 {group.total} 条
                  </span>
                )}
              </div>
              {group.hits.map((hit) => {
                runningIndex += 1
                const active = runningIndex === cursor
                return (
                  <button
                    key={`${hit.type}-${hit.id}`}
                    onClick={() => go(hit)}
                    onMouseEnter={() => setCursor(flat.indexOf(hit))}
                    className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${
                      active ? 'bg-accent-50' : 'hover:bg-canvas'
                    }`}
                  >
                    {/* 类型用色点表示即可 —— 组标题已经写了类型名，每行再重复一遍是冗余 */}
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        TYPE_DOTS[hit.type] || 'bg-muted'
                      }`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body-sm text-ink truncate">
                        <Highlight text={hit.title} term={term} />
                      </span>
                      {(hit.subtitle || hit.meta) && (
                        <span className="block text-caption text-muted truncate">
                          {hit.meta && <span className="font-mono mr-2">{hit.meta}</span>}
                          {hit.subtitle}
                        </span>
                      )}
                    </span>
                    {active && <CornerDownLeft size={13} className="text-muted flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

