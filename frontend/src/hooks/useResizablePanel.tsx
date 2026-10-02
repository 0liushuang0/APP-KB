import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

/**
 * 左侧面板拖拽调宽：宽度存 localStorage，右侧内容随 flex 布局自动伸缩。
 * 仅在大屏（≥1024px）生效——小屏布局是上下堆叠，侧栏占满全宽，拖拽无意义。
 */
export function useResizablePanel(
  storageKey: string,
  defaultWidth: number,
  { min = 160, max = 480 }: { min?: number; max?: number } = {},
) {
  const [width, setWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem(storageKey))
    return v >= min && v <= max ? v : defaultWidth
  })
  const [dragging, setDragging] = useState(false)
  const [large, setLarge] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024)
  const startRef = useRef({ x: 0, w: 0 })

  useEffect(() => {
    const onResize = () => setLarge(window.innerWidth >= 1024)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const prevUserSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const onMove = (e: MouseEvent) => {
      const next = Math.min(max, Math.max(min, startRef.current.w + (e.clientX - startRef.current.x)))
      setWidth(next)
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      document.body.style.userSelect = prevUserSelect
      document.body.style.cursor = prevCursor
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, min, max])

  useEffect(() => {
    localStorage.setItem(storageKey, String(width))
  }, [width, storageKey])

  const startDrag = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      startRef.current = { x: e.clientX, w: width }
      setDragging(true)
    },
    [width],
  )

  return {
    /** 当前生效宽度；小屏返回 null（由响应式 class 接管） */
    width: large ? width : null,
    dragging,
    large,
    /** 挂在拖拽手柄上的 onMouseDown */
    startDrag,
    /** 直接给侧栏用：<aside style={panelStyle}> */
    panelStyle: large ? { width: `${width}px` } : undefined,
  }
}

/** 拖拽手柄：放在侧栏与主内容之间，hover 时出现强调线 */
export function ResizeHandle({ onMouseDown }: { onMouseDown: (e: ReactMouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="hidden lg:block w-1 flex-shrink-0 cursor-col-resize group/resize relative"
      title="拖动调整宽度"
    >
      <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover/resize:bg-accent-400 group-hover/resize:w-0.5 transition-all" />
    </div>
  )
}
