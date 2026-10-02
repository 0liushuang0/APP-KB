import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * 左侧导航自适应每页条数。
 *
 * 导航是翻页结构：每页条数定小了大屏底部留白，定小屏又放不下。
 * 干脆按视口高度动态算 —— 窗口拉高（如最大化）每页多显示几条，
 * 保证面板始终被内容填满。挂载时记一次顶部偏移（此时页面未滚动），
 * 之后只随 window.innerHeight 变化重算。
 */
export function useNavPageSize(opts: {
  /** 每条导航项的大致高度（px），含行间距 */
  rowHeight: number
  min?: number
  max?: number
  /** 导航上方内容占高：页头 + 统计卡片 + 间距（无统计卡的页面传小值） */
  reserve?: number
  /**
   * 列表容器。传了就**实测**它到视口底部的可用高度，不再用 reserve 估算。
   *
   * 估算方式的问题：reserve 是个写死的经验值（230），页面有没有统计卡、
   * 卡片几行、导航上方还有没有别的东西，各页都不一样。估多了就白白少显示几行 ——
   * 客户资料页 1080p 下只能显示 5~6 家公司，下面大片空白，就是这么来的。
   * 实测则天然适应全屏、窗口缩放、统计卡换行等各种情况。
   */
  containerRef?: RefObject<HTMLElement | null>
  /** 容器下方还要留出的高度（翻页器等），仅在 containerRef 模式下生效 */
  footer?: number
}): number {
  const { rowHeight, min = 5, max = 60, reserve = 230, containerRef, footer = 44 } = opts
  const [pageSize, setPageSize] = useState(min)
  const topRef = useRef(0)

  useEffect(() => {
    const compute = () => {
      const el = containerRef?.current
      let avail: number
      if (el) {
        // 实测：容器顶部到视口底部，再减去翻页器和一点边距
        const top = el.getBoundingClientRect().top
        avail = window.innerHeight - top - footer - 16
      } else {
        avail = window.innerHeight - topRef.current - reserve
      }
      setPageSize(Math.min(max, Math.max(min, Math.floor(avail / rowHeight))))
    }
    // 延迟一拍量顶部偏移：main 是滚动容器自身不滚，量它等价于量内容区顶部
    const raf = requestAnimationFrame(() => {
      topRef.current = Math.max(48, document.querySelector('main')?.getBoundingClientRect().top ?? 56)
      compute()
    })
    window.addEventListener('resize', compute)

    /*
     * 容器位置还会因为"内容变化"而移动（统计卡片数字变宽换行、筛选栏展开等），
     * 这些不触发 window resize。用 ResizeObserver 盯住容器本身，
     * 全屏切换时也能立刻重算。
     */
    let ro: ResizeObserver | undefined
    if (containerRef?.current && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => compute())
      ro.observe(document.body)
    }
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', compute)
      ro?.disconnect()
    }
  }, [rowHeight, min, max, reserve, containerRef, footer])

  return pageSize
}

/**
 * 把页码收敛到合法区间：条目变少 / 每页条数变大时，当前页可能已越界。
 */
export function clampNavPage(page: number, totalPages: number) {
  return Math.min(Math.max(1, page), Math.max(1, totalPages))
}
