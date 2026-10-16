import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Bookmark, Columns3, ChevronDown, Trash2, Users, Star, Check } from 'lucide-react'
import apiClient from '../api/client'
import Modal from './Modal'
import FormInput from './FormInput'

export interface ListViewState {
  filters: Record<string, any>
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
  hidden?: string[]
}

interface SavedViewRow {
  id: string
  name: string
  shared: boolean
  isDefault: boolean
  mine: boolean
  state: ListViewState
}

export const savedViewApi = {
  list: (page: string) => apiClient.get<SavedViewRow[]>('/saved-views', { params: { page } }).then((r) => r.data),
  create: (dto: { page: string; name: string; state: ListViewState; shared?: boolean; isDefault?: boolean }) =>
    apiClient.post<SavedViewRow>('/saved-views', dto).then((r) => r.data),
  update: (id: string, dto: Partial<{ name: string; state: ListViewState; shared: boolean; isDefault: boolean }>) =>
    apiClient.patch<SavedViewRow>(`/saved-views/${id}`, dto).then((r) => r.data),
  remove: (id: string) => apiClient.delete(`/saved-views/${id}`).then((r) => r.data),
}

/** URL 里的「正在看」筛选（工作台直达）也算视图的一部分 */
const URL_KEYS = ['focus', 'owner']

/**
 * 列表「保存的视图」与列配置。
 *
 * 一个视图 = 页面上的结构化筛选（状态/客户/阶段…，含工作台直达的 focus/owner）+ 排序 + 显示哪些列。
 * 个人视图只自己看得到；勾「团队共享」所有人可选用；「设为默认」打开列表时自动套用（每人每页一个）。
 * 搜索框的关键词不存进视图（临时性的，存了反而让人困惑为什么列表少了）。
 */
export function useSavedViews(opts: {
  page: string
  filters: Record<string, any>
  applyFilters: (f: Record<string, any>) => void
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
  setSort?: (by?: string, order?: 'ASC' | 'DESC') => void
}) {
  const { page } = opts
  const [sp, setSp] = useSearchParams()
  const storageKey = `aikb-cols:${page}`
  const [hidden, setHiddenState] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '[]')
    } catch {
      return []
    }
  })
  const setHidden = (h: string[]) => {
    setHiddenState(h)
    try {
      localStorage.setItem(storageKey, JSON.stringify(h))
    } catch {
      /* 存不了就只在本次生效 */
    }
  }
  const [activeId, setActiveId] = useState<string | null>(null)
  const query = useQuery({ queryKey: ['saved-views', page], queryFn: () => savedViewApi.list(page), staleTime: 60_000 })

  const urlFilters = () => Object.fromEntries(URL_KEYS.map((k) => [k, sp.get(k) || undefined]).filter(([, v]) => v))
  const current = (): ListViewState => ({
    filters: { ...Object.fromEntries(Object.entries(opts.filters).filter(([, v]) => v !== '' && v != null)), ...urlFilters() },
    sortBy: opts.sortBy,
    sortOrder: opts.sortOrder,
    hidden,
  })

  const applyState = (s: ListViewState) => {
    const f = s.filters || {}
    opts.applyFilters(Object.fromEntries(Object.entries(f).filter(([k]) => !URL_KEYS.includes(k))))
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const k of URL_KEYS) {
          if (f[k]) next.set(k, String(f[k]))
          else next.delete(k)
        }
        next.delete('page')
        return next
      },
      { replace: true },
    )
    opts.setSort?.(s.sortBy, s.sortOrder)
    setHidden(s.hidden || [])
  }

  const apply = (v: SavedViewRow) => {
    applyState(v.state || { filters: {} })
    setActiveId(v.id)
  }
  const reset = () => {
    applyState({ filters: {}, hidden: [] })
    setActiveId(null)
  }

  // 打开列表时自动套用「我的默认视图」；从工作台/全局搜索带着筛选或定位进来时不套，免得把人家要看的冲掉
  const applied = useRef(false)
  useEffect(() => {
    if (applied.current || !query.data) return
    applied.current = true
    if (sp.get('focus') || sp.get('highlight') || [...sp.keys()].some((k) => k.startsWith('from'))) return
    const d = query.data.find((v) => v.mine && v.isDefault)
    if (d) apply(d)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data])

  return { page, views: query.data || [], activeId, setActiveId, apply, reset, current, hidden, setHidden, refetch: query.refetch }
}

export default function SavedViewsBar({
  sv,
  columns,
}: {
  sv: ReturnType<typeof useSavedViews>
  columns: Array<{ key: string; title: string }>
}) {
  const [menu, setMenu] = useState<'views' | 'cols' | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [isDefault, setIsDefault] = useState(false)
  const [saving, setSaving] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  const active = sv.views.find((v) => v.id === sv.activeId)
  const mine = sv.views.filter((v) => v.mine)
  const team = sv.views.filter((v) => !v.mine)

  const save = async () => {
    if (!name.trim()) {
      toast.error('给视图起个名字')
      return
    }
    setSaving(true)
    try {
      const v = await savedViewApi.create({ page: sv.page, name: name.trim(), state: sv.current(), shared, isDefault })
      toast.success(`已保存视图「${v.name}」`)
      sv.setActiveId(v.id)
      setSaveOpen(false)
      sv.refetch()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const overwrite = async () => {
    if (!active?.mine) return
    try {
      await savedViewApi.update(active.id, { state: sv.current() })
      toast.success(`已更新视图「${active.name}」`)
      sv.refetch()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '更新失败')
    }
    setMenu(null)
  }

  const toggleDefault = async (v: SavedViewRow) => {
    try {
      await savedViewApi.update(v.id, { isDefault: !v.isDefault })
      sv.refetch()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '设置失败')
    }
  }

  const remove = async (v: SavedViewRow) => {
    if (!window.confirm(`删除视图「${v.name}」？`)) return
    try {
      await savedViewApi.remove(v.id)
      if (sv.activeId === v.id) sv.setActiveId(null)
      sv.refetch()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '删除失败')
    }
  }

  const item = (v: SavedViewRow) => (
    <div key={v.id} className="group flex items-center gap-1 px-2 py-1.5 rounded hover:bg-subtle">
      <button className="flex-1 text-left text-sm text-ink truncate flex items-center gap-1.5" onClick={() => { sv.apply(v); setMenu(null) }}>
        {sv.activeId === v.id ? <Check size={13} className="text-accent-600" /> : <span className="w-[13px]" />}
        {v.name}
        {v.shared && <Users size={12} className="text-muted" />}
      </button>
      {v.mine && (
        <>
          <button title={v.isDefault ? '取消默认' : '设为默认（打开列表时自动套用）'} onClick={() => toggleDefault(v)}>
            <Star size={13} className={v.isDefault ? 'text-warning-fg fill-current' : 'text-muted opacity-0 group-hover:opacity-100'} />
          </button>
          <button title="删除" onClick={() => remove(v)} className="text-muted hover:text-danger-fg opacity-0 group-hover:opacity-100">
            <Trash2 size={13} />
          </button>
        </>
      )}
    </div>
  )

  return (
    <div ref={box} className="relative flex items-center gap-2 mb-2 text-caption">
      <button
        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:border-accent-400 text-ink-soft"
        onClick={() => setMenu(menu === 'views' ? null : 'views')}
      >
        <Bookmark size={13} /> 视图：<span className="text-ink">{active?.name || '全部'}</span>
        <ChevronDown size={12} />
      </button>
      <button
        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:border-accent-400 text-ink-soft"
        onClick={() => setMenu(menu === 'cols' ? null : 'cols')}
      >
        <Columns3 size={13} /> 列{sv.hidden.length ? `（隐藏 ${sv.hidden.length}）` : ''}
        <ChevronDown size={12} />
      </button>

      {menu === 'views' && (
        <div className="absolute left-0 top-full mt-1 z-30 w-64 eo-card shadow-pop p-1.5">
          <button className="w-full text-left px-2 py-1.5 rounded hover:bg-subtle text-sm" onClick={() => { sv.reset(); setMenu(null) }}>
            {sv.activeId ? <span className="inline-block w-[13px]" /> : <Check size={13} className="inline text-accent-600" />} 全部（清空筛选与列设置）
          </button>
          {mine.length > 0 && <div className="px-2 pt-2 pb-1 text-muted">我的视图</div>}
          {mine.map(item)}
          {team.length > 0 && <div className="px-2 pt-2 pb-1 text-muted">团队视图</div>}
          {team.map(item)}
          <div className="border-t border-border mt-1.5 pt-1.5 space-y-0.5">
            {active?.mine && (
              <button className="w-full text-left px-2 py-1.5 rounded hover:bg-subtle text-sm text-accent-700" onClick={overwrite}>
                用当前筛选更新「{active.name}」
              </button>
            )}
            <button
              className="w-full text-left px-2 py-1.5 rounded hover:bg-subtle text-sm text-accent-700"
              onClick={() => { setName(''); setShared(false); setIsDefault(false); setSaveOpen(true); setMenu(null) }}
            >
              + 把当前筛选存为视图…
            </button>
          </div>
        </div>
      )}

      {menu === 'cols' && (
        <div className="absolute left-24 top-full mt-1 z-30 w-56 eo-card shadow-pop p-2 max-h-80 overflow-y-auto">
          <div className="text-muted px-1 pb-1">显示哪些列</div>
          {columns.map((c) => {
            const on = !sv.hidden.includes(c.key)
            return (
              <label key={c.key} className="flex items-center gap-2 px-1 py-1 text-sm text-ink cursor-pointer hover:bg-subtle rounded">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => sv.setHidden(on ? [...sv.hidden, c.key] : sv.hidden.filter((k) => k !== c.key))}
                />
                {c.title}
              </label>
            )
          })}
          {sv.hidden.length > 0 && (
            <button className="mt-1 text-accent-600 hover:underline px-1" onClick={() => sv.setHidden([])}>
              全部显示
            </button>
          )}
        </div>
      )}

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="保存为视图" onConfirm={save} loading={saving} confirmText="保存">
        <div className="space-y-3">
          <FormInput label="视图名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：我负责的海外报价、超期未跟进" autoFocus />
          <p className="text-caption text-muted">会保存：当前的筛选条件、排序、显示的列（搜索框里的关键词不保存）</p>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> 团队共享（所有人可选用，只有我能改）
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> 设为我的默认视图（打开列表时自动套用）
          </label>
        </div>
      </Modal>
    </div>
  )
}
