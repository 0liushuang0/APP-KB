import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react'
import { useDebounce } from '../hooks/useDebounce'

export interface PickerOption {
  value: string
  label: string
  /** 次要信息，例如客户所属行业、需求编号 —— 同名客户全靠它区分 */
  hint?: string
}

interface EntityPickerProps {
  label?: string
  value: string
  onChange: (value: string, option?: PickerOption) => void
  /** 按关键词到服务端查，空关键词返回首屏候选 */
  search: (keyword: string) => Promise<PickerOption[]>
  /** 编辑态回显：列表里可能没有当前选中项（它在第 8 页） */
  resolve?: (value: string) => Promise<PickerOption | null>
  queryKey: string
  placeholder?: string
  error?: string
  required?: boolean
  helper?: string
  disabled?: boolean
  className?: string
}

/**
 * 实体选择器。
 *
 * 为什么不用原生 `<select>`：
 *   · 服务端分页后一次只回 20 条，而客户有 195 个 —— 原生下拉会把
 *     "选项不全"伪装成"没有这个客户"，用户根本不知道被截断了
 *   · 几百个选项的原生下拉本来也没法用，必须能搜
 *
 * 所以这里走服务端搜索：输入即查，选中项单独解析回显。
 */
export default function EntityPicker({
  label,
  value,
  onChange,
  search,
  resolve,
  queryKey,
  placeholder = '输入关键词搜索…',
  error,
  required,
  helper,
  disabled,
  className = '',
}: EntityPickerProps) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [selected, setSelected] = useState<PickerOption | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounced = useDebounce(keyword, 250)

  const { data: options = [], isFetching } = useQuery({
    queryKey: [queryKey, 'picker', debounced],
    queryFn: () => search(debounced),
    enabled: open,
    staleTime: 30_000,
  })

  // 编辑既有记录时，选中项多半不在首屏结果里，得单独取一次
  useEffect(() => {
    let cancelled = false
    if (!value) {
      setSelected(null)
      return
    }
    if (selected?.value === value) return

    const fromList = options.find((o) => o.value === value)
    if (fromList) {
      setSelected(fromList)
      return
    }
    if (resolve) {
      resolve(value)
        .then((opt) => {
          if (!cancelled && opt) setSelected(opt)
        })
        .catch(() => {
          /* 解析不出来就先显示 id，总好过显示空白 */
        })
    }
    return () => {
      cancelled = true
    }
     
  }, [value, options])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  useEffect(() => {
    setActiveIdx(0)
  }, [debounced, open])

  const displayText = useMemo(() => {
    if (selected) return selected.label
    if (value) return value // 解析失败的兜底
    return ''
  }, [selected, value])

  const pick = (opt: PickerOption) => {
    setSelected(opt)
    onChange(opt.value, opt)
    setOpen(false)
    setKeyword('')
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSelected(null)
    onChange('')
    setKeyword('')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true)
      return
    }
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = options[activeIdx]
      if (opt) pick(opt)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={className} ref={rootRef}>
      {label && (
        <label className="block eo-label mb-1.5">
          {label}
          {required && <span className="text-accent-500 ml-0.5">*</span>}
        </label>
      )}

      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (disabled) return
            setOpen((o) => !o)
            setTimeout(() => inputRef.current?.focus(), 0)
          }}
          onKeyDown={onKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`eo-input flex items-center gap-2 text-left ${
            error ? '!border-danger-fg !ring-danger-fg/20' : ''
          } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          <span className={`flex-1 truncate ${displayText ? 'text-ink' : 'text-muted'}`}>
            {displayText || '请选择'}
          </span>
          {value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="清除"
              onClick={clear}
              className="text-muted hover:text-ink shrink-0"
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={15} className="text-muted shrink-0" />
        </button>

        {open && (
          <div className="absolute z-30 mt-1 w-full bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
            <div className="relative border-b border-border">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                ref={inputRef}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                className="w-full pl-8 pr-8 py-2 text-sm focus:outline-none"
              />
              {isFetching && (
                <Loader2
                  size={14}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted animate-spin"
                />
              )}
            </div>

            <ul role="listbox" className="max-h-60 overflow-y-auto eo-scroll py-1">
              {options.length === 0 && !isFetching && (
                <li className="px-3 py-6 text-center text-sm text-muted">
                  {keyword ? '没有匹配的结果' : '暂无可选项'}
                </li>
              )}
              {options.map((opt, idx) => (
                <li key={opt.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={opt.value === value}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => pick(opt)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                      idx === activeIdx ? 'bg-accent-50' : ''
                    }`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-ink">{opt.label}</span>
                      {opt.hint && <span className="block truncate text-xs text-muted">{opt.hint}</span>}
                    </span>
                    {opt.value === value && <Check size={15} className="text-accent-600 shrink-0" />}
                  </button>
                </li>
              ))}
            </ul>

            {/*
              结果可能被服务端截断。不说清楚的话，用户搜不到就会以为
              系统里没有这条记录，转头去新建一个重复的客户。
            */}
            {options.length >= 50 && (
              <div className="px-3 py-2 border-t border-border text-xs text-muted">
                仅显示前 {options.length} 条，请输入更精确的关键词
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="mt-1 text-xs text-danger-fg">{error}</p>}
      {helper && !error && <p className="mt-1 text-xs text-muted">{helper}</p>}
    </div>
  )
}
