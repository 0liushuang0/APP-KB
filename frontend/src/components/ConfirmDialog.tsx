import { AlertTriangle } from 'lucide-react'
import Modal from './Modal'

/**
 * 危险操作二次确认弹窗。
 *
 * 各页面的删除原来三种写法混着来：有的用 Modal 自己拼一遍、有的用浏览器
 * 原生 confirm()、还有的点一下直接就删了。删错东西的代价不一样，提示强度
 * 却随手写随手定，这里统一成一个组件：
 *   · message —— 到底要删什么（带上名称，别让人猜）
 *   · detail  —— 删了之后会怎样：能不能还原、会不会连带删别的
 * 「能不能还原」必须写实话：资料类删除进回收站保留 30 天，其余多数是真删。
 */
interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  /** 主文案：要删的对象 */
  message: React.ReactNode
  /** 补充说明：后果与可恢复性 */
  detail?: React.ReactNode
  confirmText?: string
  loading?: boolean
  /** 危险动作（删除）用红色确认按钮；一般确认传 false */
  danger?: boolean
}

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = '确认删除',
  message,
  detail,
  confirmText = '删除',
  loading = false,
  danger = true,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      onConfirm={onConfirm}
      loading={loading}
      confirmText={confirmText}
      confirmVariant={danger ? 'danger' : 'primary'}
      size="sm"
    >
      <div className="flex gap-3">
        <AlertTriangle size={18} className={`shrink-0 mt-0.5 ${danger ? 'text-danger-fg' : 'text-warning-fg'}`} />
        <div className="space-y-1.5 min-w-0">
          <p className="text-sm text-ink-soft break-words">{message}</p>
          {detail && <p className="text-caption text-muted break-words">{detail}</p>}
        </div>
      </div>
    </Modal>
  )
}
