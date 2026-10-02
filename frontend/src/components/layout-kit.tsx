import type { ReactNode } from 'react'
import type { LucideProps } from 'lucide-react'

/**
 * 业务页面的统一布局构件。
 *
 * 起因：客户中心、客户需求、技术方案、报价管理、项目跟踪五个模块，
 * 各自手写了一套弹窗和详情抽屉 —— 字段平铺成一长串没有分组，
 * 详情是「标签 : 值」的均质堆叠，关键数字（金额、状态、编号）和
 * 备注混在一起，看不出主次；五个页面的间距、标题层级还各不相同。
 *
 * 这里把重复出现的几种版式抽成构件，五个页面共用：
 *   FormSection   编辑弹窗里的分区（基本信息 / 关联关系 / 明细…）
 *   FieldGrid     分区内的字段网格，自动两列、可跨列
 *   DetailHeader  详情抽屉顶部：标题 + 编号 + 状态 + 关键指标
 *   DetailSection 详情内容分区
 *   DescList      「标签 / 值」列表，取代满屏的 flex justify-between
 *   Stat          单个关键指标
 *
 * 好处不只是好看：以后新增模块直接套同一套，不会再长出第六种排版。
 */

/* ── 编辑弹窗 ───────────────────────────────────────────── */

interface FormSectionProps {
  title: string
  /** 一句话说明这一组是干什么的，可省略 */
  hint?: string
  icon?: React.ComponentType<LucideProps>
  children: ReactNode
  /** 分区右上角的操作，例如「添加一行」 */
  action?: ReactNode
}

export function FormSection({ title, hint, icon: Icon, children, action }: FormSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        {Icon && <Icon size={15} className="text-accent-600 shrink-0" />}
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {hint && <span className="text-xs text-muted truncate">{hint}</span>}
        {action && <div className="ml-auto shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  )
}

/** 字段网格：默认两列，窄屏单列。用 <div className="md:col-span-2"> 让某个字段独占整行 */
export function FieldGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  const map = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3' }
  return <div className={`grid grid-cols-1 ${map[cols]} gap-x-4 gap-y-3.5`}>{children}</div>
}

/** 让子元素横跨整行 —— 备注、明细表这类内容用它 */
export function FullRow({ children }: { children: ReactNode }) {
  return <div className="md:col-span-2 lg:col-span-3">{children}</div>
}

/* ── 详情抽屉 ───────────────────────────────────────────── */

interface DetailHeaderProps {
  /** 主标题，通常是项目名称 */
  title?: string
  /** 单据编号，等宽字体显示 */
  code?: string
  /** 状态徽章等 */
  badge?: ReactNode
  /** 顶部关键指标，一般 2–4 个 */
  stats?: { label: string; value: ReactNode; emphasis?: boolean }[]
}

/**
 * 详情抽屉的头部。
 *
 * 把「这是什么单、什么状态、几个关键数字」集中在顶部一屏内 ——
 * 之前这些信息和备注、描述平铺在同一个列表里，找金额得逐行扫。
 */
export function DetailHeader({ title, code, badge, stats }: DetailHeaderProps) {
  return (
    <div className="pb-4 mb-4 border-b border-border">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-ink leading-snug break-words">
            {title || <span className="text-muted font-normal">未命名</span>}
          </h2>
          {code && <p className="eo-num text-xs text-muted mt-1">{code}</p>}
        </div>
        {badge && <div className="shrink-0 pt-0.5">{badge}</div>}
      </div>

      {stats && stats.length > 0 && (
        <div className={`grid gap-3 mt-4 ${stats.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {stats.map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} emphasis={s.emphasis} />
          ))}
        </div>
      )}
    </div>
  )
}

export function Stat({
  label,
  value,
  emphasis,
}: {
  label: string
  value: ReactNode
  emphasis?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="eo-label mb-1">{label}</div>
      <div
        className={`truncate ${
          emphasis ? 'eo-num text-lg font-semibold text-ink' : 'text-sm text-ink'
        }`}
      >
        {value ?? <span className="text-muted">—</span>}
      </div>
    </div>
  )
}

export function DetailSection({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string
  icon?: React.ComponentType<LucideProps>
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon size={14} className="text-accent-600 shrink-0" />}
        <h4 className="text-sm font-semibold text-ink">{title}</h4>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  )
}

/**
 * 标签/值列表。
 *
 * 用固定宽度的标签列而不是 justify-between —— 后者在值长短不一时，
 * 标签会跟着左右浮动，一列字读起来像楼梯。
 */
export function DescList({
  items,
}: {
  items: { label: string; value: ReactNode; full?: boolean }[]
}) {
  return (
    <dl className="divide-y divide-border/60 border border-border rounded-lg overflow-hidden">
      {items.map((it) => (
        <div
          key={it.label}
          className={it.full ? 'px-3 py-2.5' : 'flex gap-3 px-3 py-2.5 items-baseline'}
        >
          <dt className={`text-xs text-muted shrink-0 ${it.full ? 'mb-1' : 'w-20'}`}>{it.label}</dt>
          <dd className="text-sm text-ink min-w-0 flex-1 break-words">
            {it.value === null || it.value === undefined || it.value === '' ? (
              <span className="text-muted">—</span>
            ) : (
              it.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
