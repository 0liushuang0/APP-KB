import { useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import Button from './Button'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  onConfirm?: () => void
  confirmText?: string
  cancelText?: string
  loading?: boolean
  confirmDisabled?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** 确认按钮样式：删除类操作传 'danger'，按钮变红，点之前多看一眼 */
  confirmVariant?: 'primary' | 'danger'
}

const sizeClass = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  onConfirm,
  confirmText = '确定',
  cancelText = '取消',
  loading = false,
  confirmDisabled = false,
  size = 'md',
  confirmVariant = 'primary',
}: ModalProps) {
  const [render, setRender] = useState(open)
  const [show, setShow] = useState(false)
  /*
   * 弹窗可拖动。
   *
   * 业务场景里经常要「一边填弹窗、一边看后面表格里的数」——
   * 比如照着列表核对报价、比对供应商交期。弹窗钉死在正中央就只能
   * 关掉再打开来回切，填一半的内容还得重来。
   *
   * 只按住标题栏拖，内容区照常选中文字。
   */
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      const previousFocus = document.activeElement as HTMLElement | null
      const previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      setRender(true)
      const timer = setTimeout(() => setShow(true), 10)
      const focusTimer = setTimeout(() => closeRef.current?.focus(), 30)
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') onClose()
        // Enter 提交：焦点在 textarea 里换行不触发；无 onConfirm（纯展示弹窗）不触发；
        // 提交中/禁用态不重复触发。原先只能 Tab 到按钮再 Enter，高频操作很磨人。
        if (event.key === 'Enter' && onConfirm && !loading && !confirmDisabled) {
          const el = document.activeElement
          const tag = el?.tagName?.toLowerCase()
          if (tag !== 'textarea' && !(el as HTMLElement)?.isContentEditable) {
            event.preventDefault()
            onConfirm()
          }
        }
      }
      document.addEventListener('keydown', onKeyDown)
      return () => {
        clearTimeout(timer)
        clearTimeout(focusTimer)
        document.removeEventListener('keydown', onKeyDown)
        document.body.style.overflow = previousOverflow
        previousFocus?.focus()
      }
    } else {
      setShow(false)
      setDragging(false)
      // 复位：下次打开回到正中，否则用户会以为弹窗"跑丢了"
      setOffset({ x: 0, y: 0 })
      const timer = setTimeout(() => setRender(false), 200)
      return () => clearTimeout(timer)
    }
  }, [open])

  const onDragStart = (e: React.MouseEvent) => {
    // 标题栏上的按钮（关闭）不触发拖动
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      // 留出边距，别让弹窗被拖到完全看不见
      const maxX = window.innerWidth / 2
      const maxY = window.innerHeight / 2
      setOffset({
        x: Math.max(-maxX, Math.min(maxX, d.ox + ev.clientX - d.sx)),
        y: Math.max(-maxY, Math.min(maxY, d.oy + ev.clientY - d.sy)),
      })
    }
    const onUp = () => {
      dragRef.current = null
      setDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  if (!render) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${show ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative w-[calc(100%-1.5rem)] ${sizeClass[size]} bg-surface rounded-xl shadow-pop flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh] ${
          dragging ? '' : 'transition-all duration-200'
        } ${show ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'}`}
        style={offset.x || offset.y ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div
          onMouseDown={onDragStart}
          className="flex items-center justify-between px-5 py-4 border-b border-border cursor-move select-none"
          title="按住可拖动"
        >
          <h3 id={titleId} className="font-serif text-lg font-medium text-ink">{title}</h3>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="text-muted hover:text-ink"
            title={"关闭"}
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-3 sm:p-5 overflow-y-auto flex-1">{children}</div>
        {onConfirm && (
          <div className="flex justify-end gap-3 px-5 py-4 border-t border-border bg-subtle rounded-b-lg">
            <Button variant="secondary" onClick={onClose}>
              {cancelText}
            </Button>
            <Button variant={confirmVariant} onClick={onConfirm} loading={loading} disabled={confirmDisabled}>
              {confirmText}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
