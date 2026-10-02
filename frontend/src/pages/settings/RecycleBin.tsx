import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trash2, RotateCcw, Search, Info } from 'lucide-react'
import Button from '../../components/Button'
import ConfirmDialog from '../../components/ConfirmDialog'
import EmptyState from '../../components/EmptyState'
import PageLoader from '../../components/PageLoader'
import ErrorState from '../../components/ErrorState'
import { documentApi, type RecycledDocument } from '../../api/services'

function formatSize(bytes?: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 距到期还有几天：到期后由后台任务自动清除，提前把倒计时摆出来 */
function daysLeft(expiresAt?: string): number | null {
  if (!expiresAt) return null
  const ms = new Date(expiresAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 86400000))
}

/**
 * 系统回收站。
 *
 * 资料删除是软删：记录做快照、文件移到 uploads/.trash，保留 30 天。
 * 原来这个入口只藏在业务资料页顶栏的一个按钮里 —— 从知识资料页删掉的东西，
 * 用户根本想不到要去业务资料页找。放进系统设置，就有了一个和「删除」无关、
 * 按位置就能找到的固定去处。
 *
 * 注意：目前只有资料（业务资料 / 客户资料 / 知识资料）走回收站，
 * 客户、项目、报价这类主数据仍是直接删除，所以这里不会有它们的记录。
 */
export default function RecycleBin() {
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [purging, setPurging] = useState<RecycledDocument | null>(null)
  const [restoring, setRestoring] = useState<RecycledDocument | null>(null)

  const { data = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['documents-recycled'],
    queryFn: () => documentApi.recycled(),
  })

  const items = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return data
    return data.filter((it) =>
      `${it.title || ''} ${it.fileName || ''} ${it.category || ''}`.toLowerCase().includes(kw),
    )
  }, [data, keyword])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['documents-recycled'] })
    // 资料回到列表/分类计数里，相关缓存一并作废
    queryClient.invalidateQueries({ queryKey: ['documents'] })
    queryClient.invalidateQueries({ queryKey: ['knowledge-docs'] })
    queryClient.invalidateQueries({ queryKey: ['document-category-counts'] })
  }

  const restoreMutation = useMutation({
    mutationFn: (recycleId: string) => documentApi.restoreRecycled(recycleId),
    onSuccess: () => {
      invalidate()
      setRestoring(null)
      toast.success('已还原，正在重建 AI 索引')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || '还原失败'),
  })

  const purgeMutation = useMutation({
    mutationFn: (recycleId: string) => documentApi.purgeRecycled(recycleId),
    onSuccess: () => {
      invalidate()
      setPurging(null)
      toast.success('已彻底删除')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || '删除失败'),
  })

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-lg border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Trash2 size={20} className="text-accent-600 shrink-0" />
            <h2 className="text-lg font-semibold">回收站</h2>
            <span className="text-sm text-muted shrink-0">{data.length} 项</span>
          </div>
          <div className="relative sm:ml-auto">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索文件名 / 分类…"
              className="w-full sm:w-56 pl-8 pr-3 py-1.5 text-sm border border-border rounded-md bg-surface focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500"
            />
          </div>
        </div>

        <div className="px-6 py-3 border-b border-border bg-subtle flex gap-2">
          <Info size={15} className="text-muted shrink-0 mt-0.5" />
          <p className="text-sm text-muted">
            删除的资料在这里保留 <strong className="text-ink-soft">30 天</strong>，到期自动清除。
            还原会把文件放回原位、恢复原有关联并重建 AI 索引。
            <span className="block mt-0.5">
              客户、项目、报价等主数据的删除不经过回收站，删除前请看清确认提示。
            </span>
          </p>
        </div>

        {isLoading ? (
          <div className="p-6">
            <PageLoader />
          </div>
        ) : isError ? (
          <div className="p-6">
            <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            bare
            icon={Trash2}
            title={keyword ? '没有匹配的记录' : '回收站是空的'}
            description={
              keyword ? '换个关键词试试' : '在资料页面删除的文件会先放到这里，30 天内可以还原'
            }
          />
        ) : (
          <div className="divide-y divide-border">
            {items.map((it) => {
              const left = daysLeft(it.expiresAt)
              return (
                <div key={it.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate" title={it.title || it.fileName}>
                      {it.title || it.fileName || '（未命名文件）'}
                    </p>
                    <p className="text-sm text-muted mt-0.5">
                      {it.category || '未分类'} · {formatSize(it.fileSize)} · 删除于{' '}
                      {it.deletedAt ? new Date(it.deletedAt).toLocaleString('zh-CN') : '—'}
                    </p>
                  </div>
                  {left !== null && (
                    <span
                      className={`text-caption px-1.5 py-0.5 rounded border shrink-0 ${
                        left <= 7
                          ? 'bg-warning-bg text-warning-fg border-warning-line'
                          : 'bg-canvas text-muted border-border'
                      }`}
                      title={it.expiresAt ? `${new Date(it.expiresAt).toLocaleString('zh-CN')} 自动清除` : undefined}
                    >
                      {left === 0 ? '即将清除' : `剩 ${left} 天`}
                    </span>
                  )}
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="secondary" size="sm" onClick={() => setRestoring(it)}>
                      <RotateCcw size={15} className="mr-1.5" />
                      还原
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setPurging(it)} title="彻底删除">
                      <Trash2 size={15} className="text-danger-fg" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 还原也确认一下：会把文件写回原路径，撞上同名新文件时要让用户心里有数 */}
      <ConfirmDialog
        open={!!restoring}
        onClose={() => setRestoring(null)}
        onConfirm={() => restoring && restoreMutation.mutate(restoring.id)}
        loading={restoreMutation.isPending}
        danger={false}
        title="确认还原"
        confirmText="还原"
        message={<>确定还原「{restoring?.title || restoring?.fileName}」吗？</>}
        detail="文件会放回原位置，原有的业务关联一并恢复，AI 索引在后台重建。"
      />

      <ConfirmDialog
        open={!!purging}
        onClose={() => setPurging(null)}
        onConfirm={() => purging && purgeMutation.mutate(purging.id)}
        loading={purgeMutation.isPending}
        title="彻底删除"
        confirmText="彻底删除"
        message={<>确定彻底删除「{purging?.title || purging?.fileName}」吗？</>}
        detail="这一步会把文件从磁盘上真正删掉，之后无法再还原。"
      />
    </div>
  )
}
