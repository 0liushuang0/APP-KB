import { useEffect, useRef, useState } from 'react'

export interface CandidateItem {
  id: string
  name: string
  hint?: string
}
export interface CandidateGroup {
  /** 分组标题，如「同名配件用过」「同品类」「其他」 */
  label: string
  items: CandidateItem[]
}

interface Props {
  groups: CandidateGroup[]
  placeholder: string
  /** 点选候选，或输入后按 Enter / 失焦提交自由文本（名册里没有的新厂家） */
  onPick: (name: string) => void
  className?: string
}

/**
 * 配件行的供应商候选输入框。
 *
 * 原来是原生 `<input list> + <datalist>`：候选确实按「同名配件用过的 → 同品类 → 其余」
 * 排过序，但原生 datalist 只有一个浏览器自己画的平铺下拉，排序依据完全不可见——
 * 用户看到一串厂家名，猜不出"为什么是这几个"。换成这个轻量下拉后，候选按分组
 * 标题展示依据，命中原因一目了然；原生的"输入新名字直接提交"也保留。
 */
export default function SupplierCandidateInput({ groups, placeholder, onPick }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const pickingRef = useRef(false)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const q = query.trim().toLowerCase()
  const filteredGroups = groups
    .map((g) => ({ ...g, items: q ? g.items.filter((it) => it.name.toLowerCase().includes(q)) : g.items.slice(0, 8) }))
    .filter((g) => g.items.length > 0)
  const hasAny = filteredGroups.some((g) => g.items.length > 0)

  const pick = (name: string) => {
    pickingRef.current = true
    onPick(name)
    setQuery('')
    setOpen(false)
  }

  const submitQuery = () => {
    const v = query.trim()
    if (v) pick(v)
  }

  return (
    <div className="relative flex-1 min-w-28" ref={rootRef}>
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submitQuery() }
          if (e.key === 'Escape') setOpen(false)
        }}
        onBlur={() => {
          // 点击候选项时 mousedown 已在 blur 前标记 picking，避免先 blur 提交了原始输入再 pick 重复添加
          if (pickingRef.current) { pickingRef.current = false; return }
          submitQuery()
        }}
        placeholder={placeholder}
        className="eo-input !py-0.5 !text-caption !border-transparent hover:!border-border focus:!border-accent-400 w-full"
      />
      {open && hasAny && (
        <div className="absolute z-20 mt-1 w-64 max-w-[80vw] bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
          <ul role="listbox" className="max-h-64 overflow-y-auto eo-scroll py-1">
            {filteredGroups.map((g) => (
              <li key={g.label}>
                <div className="px-3 pt-1.5 pb-0.5 text-[11px] font-medium text-muted">{g.label}</div>
                {g.items.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    role="option"
                    onMouseDown={() => { pickingRef.current = true }}
                    onClick={() => pick(it.name)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent-50 transition-colors"
                  >
                    <span className="truncate text-ink">{it.name}</span>
                    {it.hint && <span className="shrink-0 text-xs text-muted truncate max-w-[40%]">{it.hint}</span>}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
