import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, Undo2 } from 'lucide-react'
import { recycleBinApi } from '../api/services'

/**
 * 删除确认框里的影响提示：被哪些单据引用 + 可在回收站还原。
 *
 * 原来报价删了，挂着它的项目就成了"指向不存在的报价"，工作台成交额因此算成 0，
 * 而确认框只写着「删除后无法恢复」。现在删除前列出引用，删除进回收站，30 天内可还原，
 * 还原后引用随之恢复。
 */
export default function DeleteImpact({ type, id, refs = true }: { type: string; id: string | null | undefined; refs?: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['delete-impact', type, id],
    queryFn: () => recycleBinApi.impact(type, id!),
    enabled: !!id && refs,
    staleTime: 0,
  })
  const items = data || []
  return (
    <div className="mt-2 space-y-1.5">
      {refs && isLoading && <p className="text-caption text-muted">正在检查引用…</p>}
      {refs && items.length > 0 && (
        <p className="text-sm text-warning-fg flex items-start gap-1.5">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            它还被 {items.map((i) => `${i.count} 个${i.label}`).join('、')}引用；删除后这些单据里的关联会暂时显示为空，还原后自动恢复。
          </span>
        </p>
      )}
      <p className="text-caption text-muted flex items-start gap-1.5">
        <Undo2 size={13} className="mt-0.5 shrink-0" />
        <span>
          删除后进入 <Link to="/settings/recycle-bin" className="text-accent-600 hover:underline">回收站</Link>，30 天内可一键还原。
        </span>
      </p>
    </div>
  )
}
