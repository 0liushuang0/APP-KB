import { Paperclip } from 'lucide-react'

interface Props {
  /** 输入/输出双数字模式（业务单据：source=客户提交，deliverable=我方提交） */
  counts?: { input: number; output: number }
  /** 单数字模式（客户附件：没有输入/输出语义，只显示总数） */
  total?: number
  onClick?: () => void
}

/**
 * 列表操作列的附件计数徽标，两种形态：
 * · counts —— 「输入/输出」两个数字，方案/报价/项目/需求等业务单据用；
 * · total  —— 单个数字，客户附件用（客户资料不区分方向，业务环节同步
 *   进来的文件也不算在内，挂各单据自己的徽标里数）。
 */
export default function AttachmentBadge({ counts, total, onClick }: Props) {
  const dual = counts ? counts.input + counts.output : 0
  const n = total !== undefined ? total : dual
  const label =
    counts !== undefined
      ? `附件：输入 ${counts.input} 份 / 输出 ${counts.output} 份（点击编辑查看）`
      : `客户附件 ${n} 份（点击编辑查看/上传）`
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-xs tabular-nums transition-colors ${
        n ? 'text-ink-soft hover:text-accent-600' : 'text-muted/50 hover:text-muted'
      }`}
      title={n ? label : '暂无附件（点击编辑可上传）'}
      aria-label={counts !== undefined ? `附件 输入${counts.input}份 输出${counts.output}份` : `附件 ${n} 份`}
    >
      <Paperclip size={15} />
      <span className={n ? '' : 'opacity-60'}>
        {counts !== undefined ? `${counts.input}/${counts.output}` : n}
      </span>
    </button>
  )
}
