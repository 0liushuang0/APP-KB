import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  MessageSquare, ClipboardList, ListTodo, FileText, Paperclip, PencilLine, Plus,
  DollarSign, ScrollText, FolderKanban, Headset, Layers, Wallet,
} from 'lucide-react'
import { customerApi } from '../api/services'
import Button from './Button'
import Skeleton from './Skeleton'
import FollowUpModal from './FollowUpModal'
import type { CustomerTimelineEvent } from '../types'

const GROUPS: Array<{ key: string; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'contact', label: '沟通' },
  { key: 'log', label: '需求记录' },
  { key: 'task', label: '工作任务' },
  { key: 'doc', label: '单据' },
  { key: 'file', label: '资料' },
  { key: 'change', label: '修改' },
]

const KIND_ICON: Record<string, any> = {
  followup: MessageSquare,
  log: ClipboardList,
  task: ListTodo,
  requirement: FileText,
  proposal: Layers,
  quotation: DollarSign,
  contract: ScrollText,
  payment: Wallet,
  project: FolderKanban,
  ticket: Headset,
  document: Paperclip,
  change: PencilLine,
}

const dayLabel = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  const y = new Date(today.getTime() - 86400000)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return '今天'
  if (same(d, y)) return '昨天'
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}

/**
 * 客户统一时间线：沟通、需求记录、工作任务、单据（需求/方案/报价/合同/项目/售后/回款）、资料上传、单据修改，
 * 按时间倒序一条线看完；「修改」默认不显示（噪音多），点筛选可看。
 */
export default function CustomerTimeline({
  customerId,
  requirements,
}: {
  customerId: string
  requirements?: Array<{ id: string; requirementNo?: string; title?: string }>
}) {
  const navigate = useNavigate()
  const [group, setGroup] = useState('all')
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['customer-timeline', customerId],
    queryFn: () => customerApi.timeline(customerId),
    enabled: !!customerId,
  })

  const events = useMemo(() => {
    const all = data?.events || []
    if (group === 'all') return all.filter((e) => e.group !== 'change')
    return all.filter((e) => e.group === group)
  }, [data, group])

  const byDay = useMemo(() => {
    const map = new Map<string, CustomerTimelineEvent[]>()
    for (const e of events) {
      const k = new Date(e.at).toDateString()
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(e)
    }
    return [...map.values()]
  }, [events])

  const counts = data?.counts || {}
  const total = Object.entries(counts).reduce((s, [k, v]) => (k === 'change' ? s : s + v), 0)

  return (
    <div className="bg-surface rounded-xl border border-border p-5 shadow-card">
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {GROUPS.map((g) => {
          const n = g.key === 'all' ? total : counts[g.key] || 0
          return (
            <button
              key={g.key}
              onClick={() => setGroup(g.key)}
              className={`px-2.5 py-1 rounded-full text-caption border transition-colors ${
                group === g.key ? 'border-accent-500 bg-accent-50 text-accent-700' : 'border-border text-muted hover:text-ink'
              }`}
            >
              {g.label}
              {n ? ` ${n}` : ''}
            </button>
          )
        })}
        <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}>
          <Plus size={14} className="mr-1" /> 记一笔沟通
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-40" />
      ) : !events.length ? (
        <div className="py-12 text-center text-sm text-muted">
          {group === 'all' ? '还没有任何互动。点右上「记一笔沟通」，可直接粘贴邮件或微信聊天记录' : '这一类还没有记录'}
        </div>
      ) : (
        <div className="space-y-5">
          {byDay.map((list) => (
            <div key={list[0].at.slice(0, 10)}>
              <div className="text-caption text-muted mb-2">{dayLabel(list[0].at)}</div>
              <ol className="relative border-l border-border ml-2 space-y-3">
                {list.map((e) => {
                  const Icon = KIND_ICON[e.kind] || FileText
                  const isOpen = expanded === e.id
                  return (
                    <li key={e.id} className="ml-4">
                      <span className="absolute -left-[11px] mt-0.5 flex items-center justify-center w-[22px] h-[22px] rounded-full bg-surface border border-border">
                        <Icon size={12} className={e.group === 'contact' ? 'text-accent-600' : 'text-muted'} />
                      </span>
                      <div className="flex items-start gap-2">
                        <button
                          className={`text-sm text-left ${e.link ? 'text-ink hover:text-accent-600' : 'text-ink'} ${e.detail ? 'cursor-pointer' : ''}`}
                          onClick={() => (e.detail ? setExpanded(isOpen ? null : e.id) : e.link && navigate(e.link))}
                        >
                          {e.title}
                        </button>
                        {e.entryDate && (
                          <span className="text-[11px] px-1.5 rounded bg-subtle text-muted whitespace-nowrap" title="没填业务日期，按录入时间排">
                            补录
                          </span>
                        )}
                        <span className="ml-auto text-caption text-muted whitespace-nowrap">
                          {e.actor ? `${e.actor} · ` : ''}
                          {new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {e.detail && isOpen && (
                        <div className="mt-1 text-caption text-ink-soft whitespace-pre-wrap bg-subtle rounded-md p-2">
                          {e.detail}
                          {e.link && (
                            <button className="block mt-1 text-accent-600 hover:underline" onClick={() => navigate(e.link!)}>
                              打开 →
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            </div>
          ))}
        </div>
      )}

      <FollowUpModal open={open} onClose={() => setOpen(false)} customerId={customerId} requirements={requirements} />
    </div>
  )
}
