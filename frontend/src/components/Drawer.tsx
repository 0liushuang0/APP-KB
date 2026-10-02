import { useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: string
}

export default function Drawer({ open, onClose, title, children, width = 'w-[480px]' }: DrawerProps) {
  const [render, setRender] = useState(open)
  const [show, setShow] = useState(false)
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
      const timer = setTimeout(() => setRender(false), 200)
      return () => clearTimeout(timer)
    }
  }, [open])

  if (!render) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${show ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative ${width} max-w-full h-full bg-surface shadow-xl flex flex-col transition-transform duration-200 ease-out ${
          show ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
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
        <div className="flex-1 overflow-y-auto p-3 sm:p-5">{children}</div>
      </div>
    </div>
  )
}
