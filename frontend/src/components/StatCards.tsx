import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Skeleton from './Skeleton'

export interface StatCardItem {
  label: string
  value: string | number
  /** 数值后缀，如「元」「天」 */
  suffix?: string
  icon: LucideIcon
  /** 环比百分比；null 表示上期为 0 算不出来 */
  delta?: number | null
  /** 该指标"涨了是好事"吗 —— 只决定 delta 的着色，不影响数值本身 */
  upIsGood?: boolean
  /** 点了跳哪去；不传就是纯展示 */
  onClick?: () => void
  title?: string
  /** 作为筛选时：当前是否选中 */
  active?: boolean
  /** 需要关注（>0 时数字着警示色） */
  alert?: boolean
}

interface Props {
  items: StatCardItem[]
  loading?: boolean
  /** 骨架屏张数，默认按 items 长度 */
  skeletonCount?: number
  className?: string
}

/** 金额紧凑显示：万 / 亿 */
export function compactMoney(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`
  if (n >= 1e4) return `${(n / 10000).toFixed(1)} 万`
  return (n || 0).toLocaleString('zh-CN')
}

/**
 * 列表页顶部的统计卡片行。
 *
 * 样式来自业务概览（工作台）顶部那一排卡片，抽出来共用是为了让各模块
 * "长得一样高、一样的配色" —— 之前每个页面各写各的，售后管理那排明显比工作台厚一截，
 * 在模块之间来回切时视觉会跳一下。
 *
 * 用 flex + flex-1 而不是 grid：卡片带不带环比行高度不同，flex 的等高拉伸
 * 能让同一行始终齐平，不必给每张卡写死高度。
 */
export default function StatCards({ items, loading, skeletonCount, className = '' }: Props) {
  if (loading) {
    return (
      <div className={`flex gap-2 flex-wrap ${className}`}>
        {Array.from({ length: skeletonCount ?? items.length ?? 6 }).map((_, i) => (
          <div key={i} className="eo-card p-3 flex-1 min-w-[110px]">
            <Skeleton className="h-3 w-12 mb-2" />
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={`flex gap-2 flex-nowrap overflow-x-auto pb-1 -mb-1 sm:flex-wrap sm:overflow-visible ${className}`}>
      {items.map((item) => {
        const Icon = item.icon
        const hasDelta = item.delta !== undefined && item.delta !== null
        const up = (item.delta ?? 0) >= 0
        const good = item.upIsGood === false ? !up : up
        const Tag = item.onClick ? 'button' : 'div'
        // title 兜底为 label：标签被 truncate 截断时，悬停是唯一能看全的地方
        const attrs = item.onClick
          ? { onClick: item.onClick, type: 'button' as const, title: item.title || item.label }
          : { title: item.title || item.label }
        return (
          <Tag
            key={item.label}
            {...attrs}
            aria-pressed={item.onClick && item.active !== undefined ? !!item.active : undefined}
            className={`eo-card p-3 flex-1 min-w-[110px] text-left ${
              item.onClick ? 'hover:shadow-pop hover:border-accent-300 transition-all' : ''
            } ${item.active ? 'ring-2 ring-accent-500 border-accent-300' : ''}`}
          >
            {/*
              min-w-0 是必需的：flex item 默认 min-width:auto，标签一长（「本月报价额」）
              整张卡就撑过 flex-1 的分配宽度，被挤到下一行去、还横着铺满一整行。
              有了 min-w-0，truncate 才真的能截断。
            */}
            <div className="flex items-center gap-1.5 mb-1 min-w-0">
              <Icon size={12} className="text-muted shrink-0" />
              <span className="text-caption text-muted truncate">{item.label}</span>
            </div>
            {/*
              后缀也要 leading-none：text-caption 自带的行高比 text-lg 的 leading-none 高 2px，
              带「元」的卡片会比不带的高一点点，各模块之间来回切就能看出来错位。
            */}
            <div className="flex items-baseline gap-0.5 min-w-0 whitespace-nowrap">
              <span className={`text-lg font-bold leading-none ${item.alert && Number(item.value) > 0 ? 'text-danger-fg' : 'text-ink'}`}>{item.value}</span>
              {item.suffix && (
                <span className="text-caption text-muted leading-none">{item.suffix}</span>
              )}
            </div>
            {hasDelta && (
              <div
                className={`mt-0.5 text-caption flex items-center gap-0.5 ${
                  good ? 'text-success-fg' : 'text-danger-fg'
                }`}
              >
                {up ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                {Math.abs(item.delta!)}%
              </div>
            )}
          </Tag>
        )
      })}
    </div>
  )
}
