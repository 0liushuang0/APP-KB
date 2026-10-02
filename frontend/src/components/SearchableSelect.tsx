import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export interface SearchableOption {
  value: string
  label: string
  /** 显式分组名（如「大类 / 子类」）。给了就按它分组的展示，不再从 value 的斜杠推断 */
  group?: string
}

interface Props {
  label?: string
  value: string
  onChange: (value: string) => void
  options: SearchableOption[]
  placeholder?: string
  helper?: string
  error?: string
  required?: boolean
  disabled?: boolean
  /**
   * 允许提交列表以外的新值。
   * 目录名这类"边填边建"的字段要开；产品分类不能开 —— 分类必须来自需求模板，
   * 随手打一个新名字只会造出一个没有参数定义的空分类。
   */
  allowCustom?: boolean
  /** 按 value 里 '/' 前的第一段分组，还原分类树的观感 */
  groupBySlash?: boolean
  /** allowCustom 时，输入了列表里没有的值给出的提示 */
  newValueHint?: (typed: string) => string
  emptyText?: string
  className?: string
  ariaLabel?: string
}

/**
 * 可搜索下拉（combobox）。
 *
 * 取代原生 <select>：分类/目录这类候选项动辄几十条且带层级，原生下拉只能靠滚，
 * 首字母跳转对中文也不管用。这里输入即筛选、点选即填入，观感与「需求模板」页
 * 的分类选择器一致（那套交互先在那里跑通，这里抽成组件复用）。
 */
export default function SearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder = '输入以筛选，或点击展开选择',
  helper,
  error,
  required,
  disabled,
  allowCustom = false,
  groupBySlash = false,
  newValueHint,
  emptyText = '没有匹配项',
  className = '',
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  /** 收起时显示选中项的名字；列表里没有（历史值/自定义值）就直接显示原值 */
  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? value ?? '',
    [options, value],
  )

  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase()
    if (!kw) return options
    return options.filter(
      (o) => o.value.toLowerCase().includes(kw) || o.label.toLowerCase().includes(kw),
    )
  }, [options, query])

  /** 分组只影响展示，扁平列表 flat 才是键盘导航的顺序来源 */
  const buildGroups = (items: SearchableOption[]): [string, SearchableOption[]][] => {
    const hasExplicitGroup = items.some((o) => o.group)
    if (!hasExplicitGroup && !groupBySlash) return [['', items]]
    const map = new Map<string, SearchableOption[]>()
    for (const o of items) {
      const top =
        o.group ||
        (groupBySlash && o.value.includes('/') ? o.value.split('/')[0] : '')
      const list = map.get(top)
      if (list) list.push(o)
      else map.set(top, [o])
    }
    return [...map.entries()]
  }

  const groups = useMemo(() => buildGroups(filtered), [filtered, groupBySlash])
  const flat = useMemo(() => groups.flatMap(([, items]) => items), [groups])

  const typed = query.trim()
  const showNewHint =
    allowCustom && typed !== '' && !options.some((o) => o.value === typed)

  // 点面板外关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, query, allowCustom])

  // 高亮项滚进可视区，键盘翻到底部时不会"翻丢"
  useEffect(() => {
    if (!open) return
    const hl = listRef.current?.querySelector('[data-hl="1"]')
    // jsdom 没有 scrollIntoView，纯装饰性行为不值得让组件在测试环境里崩掉
    hl?.scrollIntoView?.({ block: 'nearest' })
  }, [highlight, open])

  const openPanel = () => {
    if (disabled) return
    // 展开时清空关键词（显示全部），高亮落在当前选中项上 ——
    // 按 flat 的顺序算，否则分组后索引与渲染顺序对不上，键盘导航会跳错行
    const all = buildGroups(options).flatMap(([, items]) => items)
    setQuery('')
    setHighlight(Math.max(0, all.findIndex((o) => o.value === value)))
    setOpen(true)
  }

  /** 关闭面板：allowCustom 时把还没落地的输入提交为新值，否则丢弃输入 */
  const close = () => {
    if (allowCustom && typed !== '' && typed !== value) onChange(typed)
    setOpen(false)
    setQuery('')
  }

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return openPanel()
      const dir = e.key === 'ArrowDown' ? 1 : -1
      setHighlight((h) => (flat.length ? (h + dir + flat.length) % flat.length : 0))
      return
    }
    if (e.key === 'Enter') {
      if (!open) return
      e.preventDefault()
      const hit = flat[highlight]
      if (hit) pick(hit.value)
      else if (allowCustom && typed !== '') pick(typed)
      return
    }
    if (e.key === 'Escape' && open) {
      // 只收面板，不把外层弹窗一起关掉
      e.stopPropagation()
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div className={className}>
      {label && (
        <label className="block eo-label mb-1.5">
          {label}
          {required && <span className="text-accent-500 ml-0.5">*</span>}
        </label>
      )}
      <div className="relative" ref={wrapRef}>
        <div className="relative">
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel || label}
            autoComplete="off"
            disabled={disabled}
            value={open ? query : selectedLabel}
            placeholder={open ? selectedLabel || placeholder : placeholder}
            onChange={(e) => {
              setQuery(e.target.value)
              setHighlight(0)
              if (!open) setOpen(true)
            }}
            onFocus={openPanel}
            onKeyDown={onKeyDown}
            className={`eo-input !pr-8 ${error ? '!border-danger-fg !ring-danger-fg/20' : ''}`}
          />
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => (open ? close() : (inputRef.current?.focus(), openPanel()))}
            title={open ? '收起' : '展开选择'}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-muted hover:text-ink hover:bg-canvas disabled:opacity-40"
          >
            <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {open && (
          <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
            <div ref={listRef} className="max-h-60 overflow-y-auto p-1.5">
              {showNewHint && (
                <div className="px-2.5 py-1.5 mb-1 text-xs text-accent-600 bg-accent-50 rounded">
                  {newValueHint ? newValueHint(typed) : `列表中没有「${typed}」，保存后将新建`}
                </div>
              )}
              {flat.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted text-center">{emptyText}</p>
              ) : (
                groups.map(([top, items]) => (
                  <div key={top || '__flat__'} className="mb-1 last:mb-0">
                    {top && (
                      <p className="px-2 pt-1 pb-0.5 text-caption text-muted font-medium">{top}</p>
                    )}
                    {items.map((o) => {
                      const idx = flat.indexOf(o)
                      const hl = idx === highlight
                      const selected = o.value === value
                      const depth = o.group ? 1 : groupBySlash ? o.value.split('/').length - 1 : 0
                      const text =
                        o.group ? o.label
                        : groupBySlash && top ? o.label.slice(top.length + 1) || o.label
                        : o.label
                      return (
                        <button
                          key={o.value}
                          type="button"
                          data-hl={hl ? '1' : undefined}
                          onMouseEnter={() => setHighlight(idx)}
                          onClick={() => pick(o.value)}
                          style={{ paddingLeft: `${8 + depth * 14}px` }}
                          className={`w-full text-left pr-2 py-1 text-sm rounded transition-colors ${
                            selected
                              ? 'bg-accent-50 text-accent-600 font-medium'
                              : hl
                                ? 'bg-canvas text-ink'
                                : 'text-ink-soft hover:bg-canvas hover:text-ink'
                          }`}
                        >
                          {text}
                        </button>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      {error ? (
        <p className="mt-1 text-xs text-danger-fg">{error}</p>
      ) : (
        helper && <p className="mt-1 text-xs text-muted">{helper}</p>
      )}
    </div>
  )
}
