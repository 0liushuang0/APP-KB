import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { RotateCcw, Trash2, Undo2 } from 'lucide-react'
import Button from './Button'
import ConfirmDialog from './ConfirmDialog'
import EmptyState from './EmptyState'
import PageLoader from './PageLoader'
import { recycleBinApi } from '../api/services'

/**
 * 业务记录回收站：客户、需求、方案、报价、合同、项目、售后工单、产品。
 *
 * 原来这些删了就是物理删除。现在删除前整条（含明细、阶段、关联）拍快照，保留 30 天；
 * 还原按原 id 写回 —— 下游单据里的引用随之恢复（例如删掉的报价还原后，项目重新挂上它）。
 */
export default function BusinessRecycleBin() {
  const qc = useQueryClient()
  const [restoring, setRestoring] = useState<any>(null)
  const [purging, setPurging] = useState<any>(null)
  const { data, isLoading } = useQuery({ queryKey: ['recycle-business'], queryFn: () => recycleBinApi.business() })
  const items: any[] = data || []

  const restore = useMutation({
    mutationFn: (id: string) => recycleBinApi.restore(id),
    onSuccess: (r: any) => {
      toast.success(`已还原（${r?.restoredRows ?? 0} 条记录），原有关联已恢复`)
      setRestoring(null)
      qc.invalidateQueries({ queryKey: ['recycle-business'] })
      for (const k of ['customers', 'requirements', 'proposals', 'quotations', 'contracts', 'projects', 'after-sales', 'products', 'module-stats', 'dashboard-stats']) {
        qc.invalidateQueries({ queryKey: [k] })
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '还原失败'),
  })
  const purge = useMutation({
    mutationFn: (id: string) => recycleBinApi.purge(id),
    onSuccess: () => {
      toast.success('已彻底删除')
      setPurging(null)
      qc.invalidateQueries({ queryKey: ['recycle-business'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '删除失败'),
  })

  const daysLeft = (iso?: string) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)) : null)

  return (
    <div className="eo-card overflow-hidden mb-4">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="text-base font-semibold text-ink flex items-center gap-1.5">
          <Undo2 size={16} className="text-accent-600" /> 业务记录
        </h2>
        <p className="text-caption text-muted mt-0.5">客户、需求、方案、报价、合同、项目、售后工单、产品删除后在这里保留 30 天，还原时原有关联一并恢复</p>
      </div>
      {isLoading ? (
        <div className="p-6"><PageLoader /></div>
      ) : items.length === 0 ? (
        <EmptyState bare icon={Trash2} title="没有删除的业务记录" description="删除的客户、单据会先放到这里，30 天内可以还原" />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((it) => {
            const d = daysLeft(it.expiresAt)
            return (
              <li key={it.id} className="px-6 py-3 flex items-center gap-3">
                <span className="text-caption px-1.5 py-0.5 rounded bg-canvas border border-border text-ink-soft shrink-0">{it.typeLabel}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink truncate" title={it.title}>{it.title || '（无标题）'}</p>
                  <p className="text-caption text-muted">
                    {new Date(it.deletedAt).toLocaleString('zh-CN')} 删除 · 含 {it.rows} 条记录
                    {d !== null && <span className={d <= 3 ? ' text-warning-fg' : ''}> · {d} 天后自动清除</span>}
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => setRestoring(it)}>
                  <RotateCcw size={13} className="mr-1" /> 还原
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPurging(it)} title="彻底删除">
                  <Trash2 size={14} />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmDialog
        open={!!restoring}
        onClose={() => setRestoring(null)}
        onConfirm={() => restoring && restore.mutate(restoring.id)}
        loading={restore.isPending}
        danger={false}
        title="确认还原"
        confirmText="还原"
        message={<>确定还原{restoring?.typeLabel}「{restoring?.title}」吗？</>}
        detail="按原编号写回，下游单据里的关联随之恢复；已存在的同一条记录会跳过。"
      />
      <ConfirmDialog
        open={!!purging}
        onClose={() => setPurging(null)}
        onConfirm={() => purging && purge.mutate(purging.id)}
        loading={purge.isPending}
        title="彻底删除"
        confirmText="彻底删除"
        message={<>确定彻底删除{purging?.typeLabel}「{purging?.title}」的快照吗？</>}
        detail="之后无法再还原。"
      />
    </div>
  )
}
