import { FileText, ScanLine, Ruler, Sparkles, User, HelpCircle } from 'lucide-react'

/**
 * 数据来源徽标。
 *
 * 技术领导审核结构化结果时，第一件事是问"这个值哪来的"——
 * 原文摘录和 AI 推断的可信度完全不同，必须一眼可辨。
 */
export type FieldSource = 'text' | 'ocr' | 'dxf' | 'ai' | 'manual' | string

const META: Record<string, { label: string; icon: typeof FileText; cls: string }> = {
  text: { label: '原文', icon: FileText, cls: 'bg-success-bg text-success-fg' },
  ocr: { label: 'OCR', icon: ScanLine, cls: 'bg-info-bg text-info-fg' },
  dxf: { label: '图纸', icon: Ruler, cls: 'bg-viz-3/10 text-viz-3' },
  ai: { label: 'AI 推断', icon: Sparkles, cls: 'bg-warning-bg text-warning-fg' },
  manual: { label: '人工', icon: User, cls: 'bg-neutral-bg text-neutral-fg' },
}

interface SourceBadgeProps {
  source?: FieldSource
  /** 只显示图标，用于密集表格 */
  iconOnly?: boolean
}

export default function SourceBadge({ source, iconOnly = false }: SourceBadgeProps) {
  if (!source) return null
  const meta = META[source] || { label: source, icon: HelpCircle, cls: 'bg-neutral-bg text-neutral-fg' }
  const Icon = meta.icon

  return (
    <span
      title={`来源：${meta.label}`}
      className={`inline-flex items-center gap-1 rounded font-mono text-caption ${meta.cls} ${
        iconOnly ? 'p-1' : 'px-1.5 py-0.5'
      }`}
    >
      <Icon size={11} />
      {!iconOnly && meta.label}
    </span>
  )
}

