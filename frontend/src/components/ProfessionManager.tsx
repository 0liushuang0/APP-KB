import { useEffect, useMemo, useState } from 'react'
import { ArrowUp, ArrowDown, Trash2, Plus, RotateCcw } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'
import { useProfessions } from '../hooks/useProfessions'
import { useEquipmentBom, useSpareBom, rowPart, type StoredBom } from '../hooks/useSupplyData'
import { DEFAULT_PROFESSIONS, fallbackProfession, parseKeywords, resolveProfession, type ProfessionDef } from '../utils/profession'

interface Draft extends ProfessionDef {
  /** 关键词输入框原文（保存时再拆分） */
  kwText: string
}

const toDraft = (d: ProfessionDef): Draft => ({ ...d, kwText: d.keywords.join('、') })

/** 两份清单里每个分类现有多少行（手动归入的行数单列：删除该分类会影响它们） */
function countUsage(defs: ProfessionDef[], boms: Array<StoredBom | undefined>) {
  const total = new Map<string, number>()
  const manual = new Map<string, number>()
  for (const bom of boms) {
    for (const items of Object.values(bom || {})) {
      for (const it of Array.isArray(items) ? items : []) {
        const row = typeof it === 'string' ? { part: it } : { part: rowPart(it), profession: (it.profession as string) || '' }
        const k = resolveProfession(row, defs)
        total.set(k, (total.get(k) || 0) + 1)
        if (row.profession && row.profession === k) manual.set(k, (manual.get(k) || 0) + 1)
      }
    }
  }
  return { total, manual }
}

/**
 * 管理专业分类：新增 / 改名 / 删除 / 调顺序 / 改自动归类关键词。设备配套与备件管理共用一份。
 * 删除某类：手动归入它的行改按名称自动归类（数据不丢）；改名只改显示，行里存的键不变。
 */
export default function ProfessionManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { defs, save } = useProfessions()
  const { data: eqBom } = useEquipmentBom()
  const { data: spareBom } = useSpareBom()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [newName, setNewName] = useState('')
  const [newKw, setNewKw] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setDrafts(defs.map(toDraft))
      setNewName('')
      setNewKw('')
    }
  }, [open, defs])

  const usage = useMemo(() => countUsage(defs, [eqBom, spareBom]), [defs, eqBom, spareBom])
  const fallback = fallbackProfession(drafts.length ? drafts : defs)

  const patch = (i: number, p: Partial<Draft>) => setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...p } : d)))
  const move = (i: number, dir: -1 | 1) =>
    setDrafts((ds) => {
      const j = i + dir
      if (j < 0 || j >= ds.length) return ds
      const next = [...ds]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const add = () => {
    const name = newName.trim()
    if (!name) return
    if (drafts.some((d) => d.name === name)) return
    setDrafts((ds) => [...ds, { key: '', name, keywords: [], kwText: newKw }])
    setNewName('')
    setNewKw('')
  }

  const submit = async () => {
    setSaving(true)
    const ok = await save(drafts.map((d) => ({ key: d.key, name: d.name, keywords: parseKeywords(d.kwText) })))
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="管理专业分类" size="lg" onConfirm={submit} confirmText="保存" loading={saving} cancelText="取消">
      <p className="text-body-sm text-muted mb-3">
        设备配套与备件管理共用这份分类。配件名含某类的关键词即自动归入该类（新增的分类优先匹配）；都不命中的归「{drafts.find((d) => d.key === fallback)?.name || fallback}」。
      </p>
      <div className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
        <div className="grid grid-cols-[3.5rem_9rem_1fr_6rem_2rem] gap-2 text-caption text-muted px-1">
          <span>顺序</span>
          <span>分类名称</span>
          <span>自动归类关键词（顿号或逗号分隔）</span>
          <span className="text-right">现有行数</span>
          <span />
        </div>
        {drafts.map((d, i) => {
          const total = d.key ? usage.total.get(d.key) || 0 : 0
          const manual = d.key ? usage.manual.get(d.key) || 0 : 0
          return (
            <div key={d.key || `new-${i}`} className="grid grid-cols-[3.5rem_9rem_1fr_6rem_2rem] gap-2 items-center">
              <span className="flex items-center gap-0.5">
                <button className="p-1 text-muted hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`上移 ${d.name}`}>
                  <ArrowUp size={14} />
                </button>
                <button className="p-1 text-muted hover:text-ink disabled:opacity-30" disabled={i === drafts.length - 1} onClick={() => move(i, 1)} aria-label={`下移 ${d.name}`}>
                  <ArrowDown size={14} />
                </button>
              </span>
              <input value={d.name} onChange={(e) => patch(i, { name: e.target.value })} className="eo-input !py-1 !text-sm" aria-label="分类名称" />
              <input
                value={d.kwText}
                onChange={(e) => patch(i, { kwText: e.target.value })}
                className="eo-input !py-1 !text-sm"
                placeholder={d.key === fallback ? '兜底分类，可不填' : '如：气缸、电磁阀'}
                aria-label={`${d.name} 关键词`}
              />
              <span className="text-right text-caption text-muted tabular-nums" title={manual ? `其中 ${manual} 行是手动归入` : undefined}>
                {d.key ? `${total} 行` : '新增'}
              </span>
              <button
                className="p-1 text-muted hover:text-danger-fg disabled:opacity-30"
                disabled={drafts.length <= 1}
                onClick={() => {
                  if (manual && !window.confirm(`「${d.name}」有 ${manual} 行是手动归入的，删除后这些行改按名称自动归类。确定删除？`)) return
                  setDrafts((ds) => ds.filter((_, j) => j !== i))
                }}
                title={total ? `删除后，这 ${total} 行改按名称自动归入其它分类（数据不丢）` : '删除该分类'}
                aria-label={`删除 ${d.name}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-[3.5rem_9rem_1fr_6rem_2rem] gap-2 items-center mt-3 pt-3 border-t border-divider">
        <span className="text-caption text-muted">新增</span>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          className="eo-input !py-1 !text-sm"
          placeholder="如：气动"
          aria-label="新分类名称"
        />
        <input
          value={newKw}
          onChange={(e) => setNewKw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          className="eo-input !py-1 !text-sm"
          placeholder="如：气缸、电磁阀、气源处理"
          aria-label="新分类关键词"
        />
        <span />
        <button className="p-1 text-accent-600 hover:text-accent-700 disabled:opacity-30" onClick={add} disabled={!newName.trim()} aria-label="添加分类">
          <Plus size={16} />
        </button>
      </div>
      <div className="flex items-center justify-between mt-3">
        <p className="text-caption text-muted">改名只改显示；删除分类不删数据，手动归入的行改为自动归类。保存后两个页签立即生效。</p>
        <Button variant="secondary" size="sm" onClick={() => setDrafts(DEFAULT_PROFESSIONS.map(toDraft))} title="恢复内置的 机械/液压/电气/仪表/其他（保存后生效）">
          <RotateCcw size={13} className="mr-0.5" /> 恢复内置
        </Button>
      </div>
    </Modal>
  )
}
