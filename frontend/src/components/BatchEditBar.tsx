import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckSquare, PencilLine, Trash2, X } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'
import FormSelect from './FormSelect'

interface BatchField {
  key: string
  label: string
  options: { value: string; label: string }[]
}

interface Props {
  /** 选中的行 ID 列表 */
  selectedKeys: string[]

  /** 清空选择 */
  onClear: () => void

  /** 可批量修改的字段定义 */
  fields: BatchField[]

  /** 更新单条的 API 函数 */
  updateFn: (id: string, dto: Record<string, any>) => Promise<any>

  /** 删除单条的 API 函数；提供后显示「批量删除」按钮 */
  deleteFn?: (id: string) => Promise<any>

  /** invalidate 的 query key */
  queryKey: string[]

  /** 模块名称（用于提示文案） */
  moduleName: string

  /** 渲染位置：topbar=顶栏内联紧凑条（默认），bottom=底部固定栏（旧版） */
  placement?: 'topbar' | 'bottom'
}

/**
 * 批量操作栏 + 批量修改/删除弹窗。
 *
 * 默认（placement='topbar'）在页面顶栏操作区内联渲染紧凑条：
 * 「已选 N 条」+ 琥珀色批量修改 + 红色批量删除，一眼可见；
 * placement='bottom' 保留旧的底部固定栏样式。
 * 点击"批量修改"弹出 Modal，选择要改的字段和新值，逐条调用 updateFn；
 * 点击"批量删除"弹出确认 Modal，逐条调用 deleteFn。
 */
export default function BatchEditBar({
  selectedKeys,
  onClear,
  fields,
  updateFn,
  deleteFn,
  queryKey,
  moduleName,
  placement = 'topbar',
}: Props) {
  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [batchValues, setBatchValues] = useState<Record<string, string>>({})

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const batchMutation = useMutation({
    mutationFn: async () => {
      const dto: Record<string, any> = {}
      for (const [k, v] of Object.entries(batchValues)) {
        if (v) dto[k] = v
      }
      if (Object.keys(dto).length === 0) throw new Error('请至少选择一个要修改的字段')
      // 逐条更新，带进度：中途失败也告知成/败各多少，不再"一条失败全部白干"式提示
      const failed: string[] = []
      let done = 0
      setProgress({ done: 0, total: selectedKeys.length })
      for (const id of selectedKeys) {
        try {
          await updateFn(id, dto)
        } catch {
          failed.push(id)
        }
        done++
        setProgress({ done, total: selectedKeys.length })
      }
      return { failed }
    },
    onSuccess: ({ failed }) => {
      const ok = selectedKeys.length - failed.length
      if (failed.length === 0) {
        toast.success(`已批量更新 ${ok} 条${moduleName}`)
      } else {
        toast.error(`批量更新完成：成功 ${ok} 条，失败 ${failed.length} 条（可能是权限或数据校验问题），请检查失败记录后重试`)
      }
      queryClient.invalidateQueries({ queryKey })
      setModalOpen(false)
      setBatchValues({})
      setProgress(null)
      onClear()
    },
    onError: (e: any) => {
      setProgress(null)
      toast.error(e?.message || e?.response?.data?.message || '批量更新失败')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const failed: string[] = []
      let done = 0
      setProgress({ done: 0, total: selectedKeys.length })
      for (const id of selectedKeys) {
        try {
          await deleteFn!(id)
        } catch {
          failed.push(id)
        }
        done++
        setProgress({ done, total: selectedKeys.length })
      }
      return { failed }
    },
    onSuccess: ({ failed }) => {
      const ok = selectedKeys.length - failed.length
      if (failed.length === 0) {
        toast.success(`已删除 ${ok} 条${moduleName}`)
      } else {
        toast.error(`批量删除完成：成功 ${ok} 条，失败 ${failed.length} 条，请检查失败记录后重试`)
      }
      queryClient.invalidateQueries({ queryKey })
      setDeleteOpen(false)
      setProgress(null)
      onClear()
    },
    onError: (e: any) => {
      setProgress(null)
      toast.error(e?.message || e?.response?.data?.message || '批量删除失败')
    },
  })

  if (selectedKeys.length === 0) return null

  // 批量修改/删除弹窗（两种布局共用）
  const modals = (
    <>
      {/* 批量修改弹窗 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`批量修改 ${selectedKeys.length} 条${moduleName}`}
        onConfirm={() => batchMutation.mutate()}
        loading={batchMutation.isPending}
        confirmText="确认修改"
        size="md"
      >
        <p className="text-sm text-muted mb-4">
          只需修改想批量更新的字段，留空的字段保持原值不变。选中的 {selectedKeys.length} 条{moduleName}将统一更新。
        </p>
        {progress && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-caption text-muted mb-1">
              <span>正在更新…</span>
              <span>{progress.done} / {progress.total}</span>
            </div>
            <div className="h-1.5 bg-canvas rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-500 transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
        <div className="space-y-3">
          {fields.map((f) => (
            <FormSelect
              key={f.key}
              label={f.label}
              options={[{ value: '', label: '— 不修改 —' }, ...f.options]}
              value={batchValues[f.key] || ''}
              onChange={(e) => setBatchValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
          ))}
        </div>
      </Modal>

      {/* 批量删除确认弹窗 */}
      {deleteFn && (
        <Modal
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          title={`批量删除 ${selectedKeys.length} 条${moduleName}`}
          onConfirm={() => deleteMutation.mutate()}
          loading={deleteMutation.isPending}
          confirmText="确认删除"
          confirmVariant="danger"
          size="md"
        >
          <p className="text-sm text-muted mb-4">
            确定要删除选中的 {selectedKeys.length} 条{moduleName}吗？此操作不可撤销，请谨慎确认。
          </p>
          {progress && (
            <div>
              <div className="flex items-center justify-between text-caption text-muted mb-1">
                <span>正在删除…</span>
                <span>{progress.done} / {progress.total}</span>
              </div>
              <div className="h-1.5 bg-canvas rounded-full overflow-hidden">
                <div
                  className="h-full bg-danger-fg transition-all"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  )

  if (placement === 'bottom') {
    return (
      <>
        {/* 底部固定操作栏。mb-14 给右下角 AI 悬浮球让位，避免重叠 */}
        <div className="fixed bottom-14 left-0 right-0 z-40 bg-surface border-t border-border shadow-lg px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <CheckSquare size={16} className="text-accent-600" />
              已选 {selectedKeys.length} 条
            </span>
            <button onClick={onClear} title="取消批量选择" className="text-muted hover:text-ink">
              <X size={15} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setModalOpen(true)}>
              批量修改
            </Button>
            {deleteFn && (
              <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)}>
                批量删除
              </Button>
            )}
          </div>
        </div>
        {modals}
      </>
    )
  }

  // 顶栏内联紧凑条：琥珀=批量修改，红=批量删除，与顶栏其它控件一眼区分
  return (
    <>
      <div className="flex items-center gap-1.5 rounded-lg border border-accent-200 bg-accent-50 pl-2 pr-1 py-1">
        <span className="flex items-center gap-1 text-label font-medium text-accent-600 whitespace-nowrap">
          <CheckSquare size={13} />
          已选 {selectedKeys.length} 条
        </span>
        <button onClick={onClear} title="取消批量选择" className="p-1 rounded text-muted hover:text-ink hover:bg-canvas transition-colors">
          <X size={13} />
        </button>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1 rounded-md bg-warning-fg text-white text-label font-medium px-2 py-1 hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          <PencilLine size={13} />
          批量修改
        </button>
        {deleteFn && (
          <button
            onClick={() => setDeleteOpen(true)}
            className="flex items-center gap-1 rounded-md bg-danger-fg text-white text-label font-medium px-2 py-1 hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            <Trash2 size={13} />
            批量删除
          </button>
        )}
      </div>
      {modals}
    </>
  )
}
