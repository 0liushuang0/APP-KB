/**
 * 状态徽标。
 *
 * 所有业务状态收敛到 5 个语义 token（success/warning/danger/info/neutral），
 * 不再为每个状态挑一种颜色 —— 颜色表达"这是好是坏"，不表达"这是哪个阶段"。
 * 阶段信息由文案承担。这样也不再需要 tailwind safelist。
 */
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-success-bg text-success-fg ring-success-line',
  warning: 'bg-warning-bg text-warning-fg ring-warning-line',
  danger: 'bg-danger-bg text-danger-fg ring-danger-line',
  info: 'bg-info-bg text-info-fg ring-info-line',
  neutral: 'bg-neutral-bg text-neutral-fg ring-neutral-line',
}

const TONE_DOT: Record<Tone, string> = {
  success: 'bg-success-fg',
  warning: 'bg-warning-fg',
  danger: 'bg-danger-fg',
  info: 'bg-info-fg',
  neutral: 'bg-neutral-fg',
}

const statusMap: Record<string, { label: string; tone: Tone }> = {
  // 业务单据（需求/方案/报价/合同/售后）审批态。资料、产品等库内容用 kind="library" 显示「可用/待整理/已停用」
  approved: { label: '已审核', tone: 'success' },
  pending: { label: '待审核', tone: 'warning' },
  rejected: { label: '已驳回', tone: 'danger' },
  draft: { label: '草稿', tone: 'neutral' },

  // 标准方案生命周期
  published: { label: '已发布', tone: 'success' },
  disabled: { label: '已停用', tone: 'neutral' },

  // 客户
  active: { label: '合作中', tone: 'success' },
  potential: { label: '潜在客户', tone: 'info' },
  inactive: { label: '已停用', tone: 'neutral' },

  // 项目 / 任务
  ongoing: { label: '进行中', tone: 'info' },
  completed: { label: '已完成', tone: 'success' },
  paused: { label: '已暂停', tone: 'neutral' },
  planning: { label: '规划中', tone: 'warning' },

  // 需求解析
  analyzing: { label: '解析中', tone: 'info' },
  analyzed: { label: '已解析', tone: 'success' },
  done: { label: '已完成', tone: 'success' },

  // 成交阶段
  quoted: { label: '已报价', tone: 'warning' },
  requirement_registered: { label: '需求登记', tone: 'neutral' },
  requirement_analyzed: { label: '需求识别', tone: 'info' },
  solution_drafting: { label: '方案编制', tone: 'info' },
  quotation_drafting: { label: '报价编制', tone: 'warning' },
  quotation_reviewed: { label: '报价定稿', tone: 'warning' },
  submitted: { label: '已提交', tone: 'info' },
  won: { label: '已成交', tone: 'success' },
  lost: { label: '已流失', tone: 'danger' },

  // 合同状态（draft/completed 已在上方定义，此处补齐合同专属状态）
  signed: { label: '已签订', tone: 'info' },
  executing: { label: '执行中', tone: 'warning' },
  terminated: { label: '已终止', tone: 'danger' },

  // 售后工单状态
  open: { label: '待处理', tone: 'warning' },
  assigned: { label: '已派单', tone: 'info' },
  in_progress: { label: '处理中', tone: 'info' },
  resolved: { label: '已解决', tone: 'success' },
  closed: { label: '已关闭', tone: 'neutral' },
  converted: { label: '已转需求', tone: 'success' },

  // 供应商合作等级
  strategic: { label: '战略供应商', tone: 'success' },
  qualified: { label: '合格供应商', tone: 'info' },
  candidate: { label: '备选供应商', tone: 'neutral' },
  blacklist: { label: '黑名单', tone: 'danger' },
}

/**
 * 同一个状态码在不同对象上的说法不同：approved 对报价是「已审核」、对资料是「可用」、对项目是「已立项」。
 * 原来全系统统一显示「可用」，报价单上写着"可用"让人摸不着头脑。
 */
const KIND_LABELS: Record<string, Record<string, string>> = {
  library: { approved: '可用', pending: '待整理', rejected: '已停用' },
  project: { approved: '已立项', active: '进行中' },
}

interface StatusBadgeProps {
  status?: string
  /** 覆盖默认文案，用于状态码相同但语境不同的场景 */
  label?: string
  /** 对象类别：library（资料/产品/模板等库内容）、project；不传 = 业务单据 */
  kind?: 'library' | 'project'
}

export default function StatusBadge({ status, label, kind }: StatusBadgeProps) {
  const base = status ? statusMap[status] : undefined
  const kindLabel = kind && status ? KIND_LABELS[kind]?.[status] : undefined
  const item = kindLabel ? { label: kindLabel, tone: base?.tone ?? ('success' as Tone) } : base
  if (!item && !label) return <span className="text-xs text-muted">-</span>

  const tone = item?.tone ?? 'neutral'
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-px rounded-full text-xs font-medium
        ring-1 ring-inset whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      <span className={`w-1 h-1 rounded-full flex-shrink-0 ${TONE_DOT[tone]}`} />
      {label ?? item?.label ?? status}
    </span>
  )
}
