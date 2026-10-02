/**
 * 左侧导航翻页条：上一页 / 页码 / 下一页。
 * 各页面（业务资料/客户资料/知识资料/需求模板/工程计算/供应比价）
 * 左侧导航统一用它翻页，样式与面板内的分隔线保持一致。
 */
interface NavPagerProps {
  page: number
  totalPages: number
  onChange: (page: number) => void
  /** 翻页按钮的 title 前缀，如「公司」「分类」 */
  label?: string
}

export default function NavPager({ page, totalPages, onChange, label = '' }: NavPagerProps) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between pt-2 mt-2 border-t border-border text-caption text-muted">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="hover:text-ink disabled:opacity-40"
        title={`上一页${label}`}
      >
        ← 上一页
      </button>
      <span>
        {page} / {totalPages}
      </span>
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="hover:text-ink disabled:opacity-40"
        title={`下一页${label}`}
      >
        下一页 →
      </button>
    </div>
  )
}
