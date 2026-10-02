import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, FileText, DollarSign, Briefcase, Link2 } from 'lucide-react'
import apiClient from '../api/client'

type Origin = 'requirement' | 'proposal' | 'quotation' | 'project'

interface ChainItem {
  id: string
  no: string
  status?: string
  dealStage?: string
}

interface Chain {
  requirement: { id: string; no: string; title: string } | null
  proposals: ChainItem[]
  quotations: ChainItem[]
  projects: ChainItem[]
}

interface Props {
  origin: Origin
  id?: string
  /** 当前这一张单据的 id，用来把自己标出来 */
  currentId?: string
}

/**
 * 关联单据编号。
 *
 * 需求 → 方案 → 报价 → 项目 是同一单生意的四个阶段，但界面上分散在四个页面。
 * 之前看着一张报价想找它对应的需求，只能照编号尾号猜，或者挨个页面去搜。
 * 这里把整条链路摆出来，点一下直接跳过去。
 */
export default function RelatedChain({ origin, id, currentId }: Props) {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['chain', origin, id],
    queryFn: () => apiClient.get<Chain>(`/numbering/chain/${origin}/${id}`).then((r) => r.data),
    enabled: !!id,
  })

  if (!id || isLoading || !data) return null

  if (!data.requirement) {
    return (
      <div className="flex gap-2 bg-warning-bg border border-warning-line rounded-md p-2.5 text-xs text-warning-fg">
        <Link2 size={14} className="shrink-0 mt-0.5" />
        <span>这张单据未关联需求，无法追溯所属业务线。</span>
      </div>
    )
  }

  const groups = [
    {
      label: '需求',
      icon: ClipboardList,
      to: (i: ChainItem) => `/requirements/${i.id}`,
      items: [{ id: data.requirement.id, no: data.requirement.no }] as ChainItem[],
    },
    {
      label: '方案',
      icon: FileText,
      to: (i: ChainItem) => `/proposals?highlight=${i.id}`,
      items: data.proposals,
    },
    {
      label: '报价',
      icon: DollarSign,
      to: (i: ChainItem) => `/quotations?highlight=${i.id}`,
      items: data.quotations,
    },
    {
      label: '项目',
      icon: Briefcase,
      to: (i: ChainItem) => `/projects?highlight=${i.id}`,
      items: data.projects,
    },
  ]

  return (
    <div className="eo-card p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Link2 size={14} className="text-accent-600" />
        <span className="text-xs font-semibold text-ink">关联单据</span>
        <span className="text-xs text-muted">· {data.requirement.title}</span>
      </div>

      {/*
        横向排列：四个阶段并排成一行，占的是宽度而不是高度 ——
        详情抽屉本来就窄且长，竖着堆四行会把下面的正文挤出屏幕。
      */}
      <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
        {groups.map((g) => (
          <div key={g.label} className="flex items-center gap-1.5 min-w-0">
            <span className="flex items-center gap-1 text-xs text-muted shrink-0">
              <g.icon size={12} /> {g.label}
            </span>
            <div className="flex flex-wrap gap-1 min-w-0">
              {g.items.length === 0 ? (
                <span className="text-xs text-muted">—</span>
              ) : (
                g.items.map((i) => {
                  const isSelf = i.id === currentId
                  return (
                    <button
                      key={i.id}
                      onClick={() => !isSelf && navigate(g.to(i))}
                      disabled={isSelf}
                      className={`px-2 py-0.5 rounded text-xs font-mono border transition-colors ${
                        isSelf
                          ? // 当前这张单据不做成链接，避免点了没反应让人以为坏了
                            'bg-accent-500 text-white border-accent-500 cursor-default'
                          : 'bg-surface border-border text-accent-700 hover:border-accent-400 hover:bg-accent-50'
                      }`}
                      title={isSelf ? '当前单据' : `跳转到 ${i.no}`}
                    >
                      {i.no}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
