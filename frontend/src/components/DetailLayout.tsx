import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Tabs, { type TabDef } from './Tabs'

interface DetailLayoutProps {
  /** 返回目标路由 */
  backTo: string
  backLabel: string
  /** 编号等 mono 标识，显示在标题前 */
  code?: string
  title: string
  /** 标题右侧的徽标区（状态、优先级、分类等） */
  badges?: ReactNode
  /** 标题下方的元信息行 */
  meta?: ReactNode
  /** 右上角操作按钮组 */
  actions?: ReactNode
  tabs?: TabDef[]
  activeTab?: string
  onTabChange?: (v: string) => void
  children: ReactNode
}

/**
 * 详情页统一外壳。
 *
 * 用独立路由而不是分栏：博亚的需求卡片有 40+ 参数字段，
 * 左列表+右详情会把参数表挤成两列小字。全宽 + 标签页分面才放得下。
 */
export default function DetailLayout({
  backTo,
  backLabel,
  code,
  title,
  badges,
  meta,
  actions,
  tabs,
  activeTab,
  onTabChange,
  children,
}: DetailLayoutProps) {
  const navigate = useNavigate()

  return (
    <div className="space-y-5">
      <button
        onClick={() => navigate(backTo)}
        className="flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors"
      >
        <ArrowLeft size={16} /> {backLabel}
      </button>

      <div className="eo-card">
        {/*
          页头固定两段式：上段标题+元信息（各自整行），下段操作按钮独占一行。
          不做「标题左、按钮右」的并排——本页有 7 个按钮，并排时是否放得下
          取决于视口宽度，而切换标签时右侧滚动条的出现/消失会让宽度差约 15px，
          正好在临界点上反复横跳（一会 2 行、一会 3 行）。拆成上下两段后，
          无论有没有滚动条，排版都完全一致。
        */}
        <div className="p-5 space-y-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              {code && <span className="font-mono text-label text-muted">{code}</span>}
              <h1 className="font-serif text-heading-lg font-medium text-ink leading-tight">{title}</h1>
              {badges}
            </div>
            {meta && (
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-label text-muted">{meta}</div>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </div>

        {tabs && activeTab && onTabChange && (
          <Tabs tabs={tabs} value={activeTab} onChange={onTabChange} className="px-3" />
        )}
      </div>

      {children}
    </div>
  )
}

