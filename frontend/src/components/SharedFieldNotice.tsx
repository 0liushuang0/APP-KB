import { useQuery } from '@tanstack/react-query'
import { Share2 } from 'lucide-react'
import apiClient from '../api/client'

type Origin = 'requirement' | 'proposal' | 'quotation' | 'project'

interface Props {
  origin: Origin
  /** 当前单据 id；新建时为空，此时不提示 */
  id?: string
}

const ORIGIN_LABEL: Record<Origin, string> = {
  requirement: '需求',
  proposal: '方案',
  quotation: '报价',
  project: '项目',
}

/**
 * 共享字段的影响范围提示。
 *
 * 客户和项目名称只存一份（在需求上），四个模块读的都是它 ——
 * 好处是永远一致、在哪儿改都行；代价是**改一次会动一串单据**。
 * 用户在方案里改项目名称，不会想到同需求下的另外两个方案和三份报价也变了，
 * 所以改之前必须把数字摆出来。
 */
export default function SharedFieldNotice({ origin, id }: Props) {
  const { data } = useQuery({
    queryKey: ['shared-impact', origin, id],
    queryFn: () =>
      apiClient
        .get<{ requirementId: string | null; proposals: number; quotations: number }>(
          `/numbering/impact/${origin}/${id}`,
        )
        .then((r) => r.data),
    enabled: !!id,
  })

  if (!id || !data) return null

  if (!data.requirementId) {
    return (
      <div className="flex gap-2 bg-warning-bg border border-warning-line rounded-md p-2.5 text-xs text-warning-fg">
        <Share2 size={14} className="shrink-0 mt-0.5" />
        <span>
          这条{ORIGIN_LABEL[origin]}没有关联需求，客户与项目名称无处可存，修改不会被保留。
          请先关联一条需求。
        </span>
      </div>
    )
  }

  // 自己这一张不算在"其他受影响"里
  const others =
    data.proposals + data.quotations - (origin === 'proposal' || origin === 'quotation' ? 1 : 0)

  if (others <= 0) {
    return (
      <div className="flex gap-2 bg-canvas border border-border rounded-md p-2.5 text-xs text-muted">
        <Share2 size={14} className="shrink-0 mt-0.5" />
        <span>客户与项目名称存在关联需求上，此处修改会同步到需求。目前没有其他单据引用。</span>
      </div>
    )
  }

  return (
    <div className="flex gap-2 bg-accent-50 border border-accent-200 rounded-md p-2.5 text-xs text-accent-700">
      <Share2 size={14} className="shrink-0 mt-0.5" />
      <span>
        客户与项目名称在四个模块间共用一份。此处修改会同步到关联需求，并影响
        <strong className="mx-0.5">同一需求下的 {data.proposals} 个方案、{data.quotations} 份报价</strong>
        （含本单）。
      </span>
    </div>
  )
}
