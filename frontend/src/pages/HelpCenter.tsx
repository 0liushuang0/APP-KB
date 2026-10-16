import { useState, useMemo, useEffect } from 'react'
import {
  HelpCircle,
  BookOpen,
  Keyboard,
  Settings,
  Database,
  Bot,
  Zap,
  Search,
  MessageCircleQuestion,
  ChevronDown,
  X,
  Briefcase,
  Wrench,
  ShieldCheck,
} from 'lucide-react'
import { usePageActions } from '../contexts/PageActionsContext'
import { useResizablePanel, ResizeHandle } from '../hooks/useResizablePanel'
import EmptyState from '../components/EmptyState'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'

interface FaqItem {
  q: string
  a: string
}

interface FaqSection {
  id: string
  title: string
  icon: typeof HelpCircle
  items: FaqItem[]
}

const faqSections: FaqSection[] = [
  {
    id: 'getting-started',
    title: '快速开始',
    icon: Zap,
    items: [
      {
        q: '如何开始使用系统？',
        a: '登录后，您将进入流程工作台。左侧导航栏包含所有功能模块：客户中心、客户需求、解决方案、报价管理等。您可以从任意模块开始工作。',
      },
      {
        q: '如何创建第一个客户？',
        a: '进入"客户中心"页面，点击右上角的"新建客户"按钮，填写客户名称、联系人、联系方式等基本信息即可创建。',
      },
      {
        q: '系统支持哪些浏览器？',
        a: '系统支持 Chrome 90+、Firefox 88+、Safari 14+、Edge 90+ 等现代浏览器。建议使用最新版本的 Chrome 以获得最佳体验。',
      },
      {
        q: '如何快速找到我需要的功能？',
        a: '使用顶部的全局搜索功能（快捷键 Ctrl+K），可以快速搜索客户、需求、文档等各类数据。也可以使用左侧导航栏浏览各模块。',
      },
    ],
  },
  {
    id: 'role-sales',
    title: '销售手册',
    icon: Briefcase,
    items: [
      {
        q: '从客户到成交的完整流程怎么走？',
        a: '标准链路：客户中心建档 → 客户需求登记 → 生成方案（方案编码自动继承需求尾号）→ 报价（继承方案尾号）→ 报价列表「转合同」→ 合同 → 项目跟踪 → 售后。\n看到同一尾号（如 -009）就知道是同一单生意的全套单据。每一步都能在列表「落地阶段」列看到当前推进到哪。',
      },
      {
        q: '怎么知道一条需求有没有落地？',
        a: '客户需求列表的「落地阶段」列由系统按 方案→报价→合同 链路自动推导：已登记（还没方案）→ 方案阶段 → 报价阶段 → 已签约 / 已成交 / 已失单，无需人工维护。顶栏可按落地阶段筛选，例如筛「已登记」找出该催方案的需求，筛「报价阶段」找出该跟进签约的。',
      },
      {
        q: '怎么才不会忘记跟进客户？',
        a: '新建需求时「下次跟进日期」默认 7 天后，可改。业务概览首页的「我的今天」汇总 8 类要推动的事：待审批、跟进超期、7 天内跟进、参数待确认、报价超 14 天未签约、7 天内交货、项目预警、质保 30 天内到期，点一格直达筛好的列表；列表顶部的统计卡也能一键切到同一视图。',
      },
      {
        q: '想看某一个客户的全部业务怎么办？',
        a: '客户列表点开「客户 360」可看该客户的需求/方案/报价/合同/项目/售后与资料。各业务列表顶栏都有「按客户筛选」下拉，可选「未关联客户」把漏挂客户的单据捞出来补录。',
      },
      {
        q: '优先级怎么定才不凭感觉？',
        a: '需求列表的优先级旁有系统建议徽标：按期望金额（≥50万→高，≥10万→中）与客户等级（A→高，B→中）自动推算。与当前设置不一致时会提示「建议高/中」，鼠标悬停看推算依据，人工只需确认。',
      },
    ],
  },
  {
    id: 'role-tech',
    title: '技术手册',
    icon: Wrench,
    items: [
      {
        q: '收到客户需求文件后怎么快速登记？',
        a: '把客户的技术附件上传到需求详情的「关联资料」，系统解析完会自动识别技术参数并标出缺失项（通常 30–60 秒，结果标「待确认」，核对后点「确认无误」）；也可点「结构化识别」立即识别。缺失项可一键「生成客户回复」补问；识别确认单支持导出 Word/PDF。',
      },
      {
        q: '编制方案怎么复用历史资料？',
        a: '从需求列表点「生成方案」，客户/项目名称/编号自动带出。方案支持从 Word 导入正文（含文本框内容）；「输入文件」放客户原始资料，「输出文件」放方案交付版，列表回形针徽标显示 输入/输出 数量，支持勾选打包下载。',
      },
      {
        q: '报价明细和产品库怎么联动？',
        a: '从方案点「生成报价」，系统按需求的产品类型从产品库带出明细和单价，并写明为什么选这个产品；同类有多个产品又分不出时会列出候选让你选，没有价格表的标「缺价」。付款条件、交货期、质保写在报价里，生成合同时自动带过去。「产品与方案」页右侧列出「先补这几个产品」，补齐型号价格表后报价可直接按型号出价。',
      },
      {
        q: '项目执行阶段要记录什么？',
        a: '从合同立项时，开工日（签约日）、计划完工（交货期）、项目类型和 8 个标准阶段自动带出（阶段模板在「系统设置 → 系统配置」的 project_stage_template 里改）。健康度每天自动重算，过了计划完工未完成即标红并通知负责人；列表可切换「交期甘特」看全部项目的时间线。售后工单可从项目派生，设备型号从报价明细下拉选择。',
      },
      {
        q: '文档解析失败怎么排查？',
        a: '系统健康面板的「文档解析成功率」按周统计。常见原因：扫描件无文字层（先 OCR）、加密 PDF（先解密）、超时（大文件已在服务端排队）。仍失败可在业务资料里对该文档重建索引。',
      },
      {
        q: '工程计算和需求模板在哪？',
        a: '左侧「工具箱」里有两个页签：「工程计算」提供选型/校核计算表（表格编辑器首次打开时加载），计算结果可挂到需求或方案作为输出文件；「需求模板」维护参数化模板（按产品类型分组，选择器可搜索）。',
      },
    ],
  },
  {
    id: 'role-admin',
    title: '管理员手册',
    icon: ShieldCheck,
    items: [
      {
        q: '用户与数据权限怎么管？',
        a: '系统设置里维护部门/用户组/角色。单据可见性分 公开/部门/用户组/角色/私有 五档，任务类默认仅本人。管理员在审批中心处理跨模块审批（审批开关在系统配置里）。',
      },
      {
        q: '删错了客户或单据能找回吗？',
        a: '能。客户、需求、方案、报价、合同、项目、售后工单、产品删除后都进「系统设置 → 回收站」的「业务记录」，保留 30 天，按原编号一键还原，下游单据的关联随之恢复；资料在同页的资料回收站。删除前确认框会提示「被 N 个单据引用」。',
      },
      {
        q: '备份策略与恢复演练怎么做？',
        a: '数据库自动定期备份（AES-256-GCM 加密，data/backups/*.zip.enc），加密密钥在 data/.backup-key —— 异地容灾务必单独保管一份。恢复演练脚本：backend/scripts/restore-drill.mjs（解密→恢复到临时库→全表比对→自动清理），建议每季度跑一次并留存 data/restore-drill-report.json。',
      },
      {
        q: '日常巡检看哪些指标？',
        a: '业务概览「系统健康」面板：AI 可检索覆盖率（资料是否都能被问答找到）、产品报价就绪度、待审批积压、文档解析成功率、备份状态。数据一致性巡检接口 GET /api/system/consistency 会查悬空引用/重号/脏值，交付前应全绿。',
      },
      {
        q: '单据编号规则在哪定版？',
        a: '现行规则：CUST/REQ/PROP/QUO/CON/PRJ/TICKET/SOL/MAT/WT 前缀 + 年份 + 3 位流水（同链单据共享尾号）。如需与纸面习惯对齐（如 CST 前缀），在系统设置的编号规则里改前缀即可，历史编号不受影响。改前请与各业务负责人核对一次。',
      },
      {
        q: 'AI 能力怎么开关与核算？',
        a: '系统设置 → AI 配置：引擎、密钥、云端/本地模式（本地模式数据不出设备）。AI 预算与调用日志在设置里可查；智能问答对回答可点赞/点踩反馈，用于持续改进。',
      },
    ],
  },
  {
    id: 'ai-config',
    title: 'AI 配置',
    icon: Bot,
    items: [
      {
        q: '如何配置 AI 服务？',
        a: '进入"系统设置 → AI 配置"页面，可以配置 AI 引擎类型（如 OpenAI、Claude 等）、API Key、模型参数等。配置完成后点击"测试连接"验证是否正常。',
      },
      {
        q: 'AI 服务离线怎么办？',
        a: '如果 AI 云端服务不可用，系统会自动尝试使用本地模型（效果有限）。您也可以在 AI 配置页面检查 API Key 是否过期，或切换到其他可用的 AI 引擎。',
      },
      {
        q: '智能问答的回答不准确怎么办？',
        a: '智能问答基于知识库中的资料进行检索和生成。请确保相关文档已上传并建立索引。您也可以在提问时指定检索范围（如"客户"、"需求"等），提高回答的准确性。',
      },
      {
        q: '如何提高 AI 回答的质量？',
        a: '1. 上传更多相关文档到知识库；2. 提问时尽量具体，包含关键参数；3. 使用检索范围限定；4. 参考引用来源核对关键数据。',
      },
    ],
  },
  {
    id: 'data-management',
    title: '数据管理',
    icon: Database,
    items: [
      {
        q: '如何导入历史数据？',
        a: '进入"系统设置 → 备份恢复"页面，使用"数据导入"功能。支持 JSON 格式的数据文件。导入前建议先备份当前数据。',
      },
      {
        q: '如何导出数据？',
        a: '在"系统设置 → 备份恢复"页面，点击"导出数据"按钮。您可以选择导出全部数据或指定模块的数据。导出文件为 JSON 格式。',
      },
      {
        q: '文档上传失败怎么办？',
        a: '请检查：1. 文件大小是否超过限制（知识资料 20MB、业务资料 100MB）；2. 文件格式是否支持（PDF、Word、Excel、TXT 等）；3. 网络连接是否正常。如仍有问题，请联系管理员。',
      },
      {
        q: '如何建立文档索引？',
        a: '上传文档后，系统会自动建立索引。如果索引失败，可以在文档详情页手动点击"重建索引"按钮。索引完成后，文档内容才能被 AI 检索到。',
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: '常见问题',
    icon: Settings,
    items: [
      {
        q: '页面加载缓慢怎么办？',
        a: '1. 检查网络连接；2. 清除浏览器缓存；3. 关闭不必要的浏览器标签页；4. 如果数据量较大，尝试使用筛选条件减少加载量。',
      },
      {
        q: '操作没有反应怎么办？',
        a: '尝试刷新页面（F5）。如果问题持续，请检查浏览器控制台是否有错误信息，并联系技术支持。',
      },
      {
        q: '如何联系技术支持？',
        a: '您可以通过系统内的反馈功能提交问题，或发送邮件至技术支持邮箱。请详细描述问题现象、操作步骤和截图，以便快速定位问题。',
      },
      {
        q: '数据丢失了怎么办？',
        a: '系统会定期自动备份数据。请联系管理员从备份中恢复。建议定期手动备份重要数据（系统设置 → 备份恢复）。',
      },
    ],
  },
  {
    id: 'keyboard-shortcuts',
    title: '键盘快捷键',
    icon: Keyboard,
    items: [
      {
        q: '有哪些常用快捷键？',
        a: 'Ctrl+K：打开全局搜索\nCtrl+/：显示快捷键帮助\nEsc：关闭当前弹窗\nTab：在元素间切换焦点\nEnter：激活当前聚焦的元素',
      },
      {
        q: '如何查看所有快捷键？',
        a: '按 Ctrl+/（Mac 为 Cmd+/）可以打开快捷键面板，查看所有可用的键盘快捷键。',
      },
      {
        q: '快捷键不起作用怎么办？',
        a: '请确保当前焦点不在输入框或文本区域内。某些快捷键在输入状态下会被禁用。点击页面空白处移除焦点后重试。',
      },
    ],
  },
]

/*
 * 左右布局：左侧是「分类 → 问题」目录树（同知识资料/客户资料的导航模式），
 * 右侧展示选中问题的完整答案。搜索时左侧只留命中的问题，
 * 并自动选中第一条，答案直接出现在右侧，不用再手动展开。
 */
export default function HelpCenter() {
  const [searchQuery, setSearchQuery] = useState('')
  // 当前选中：{ 分类 id, 问题下标 }；默认打开「快速开始」第一条
  const [active, setActive] = useState<{ sectionId: string; idx: number }>({
    sectionId: faqSections[0].id,
    idx: 0,
  })
  /** 「全部」视图：右侧总览所有分类与问题，同知识资料/业务资料导航顶部的「全部」入口 */
  const [viewAll, setViewAll] = useState(false)
  /**
   * 分类缩放（展开/收起）：默认只展开当前选中分类，其余收起来，
   * 目录不再一铺到底；点分类标题切换，搜索时命中分类自动全部展开。
   */
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(faqSections.slice(1).map((s) => s.id)),
  )
  const toggleSection = (id: string) =>
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const isSearching = !!searchQuery.trim()
  const totalQuestions = faqSections.reduce((sum, s) => sum + s.items.length, 0)

  const setPageActions = usePageActions()
  // 顶栏操作区：「全部」入口 + FAQ 搜索框
  useEffect(() => {
    setPageActions(
      <>
      {/* 「全部」从左侧目录顶部挪到这里：左侧要留给问题目录 */}
      {!viewAll && (
        <button
          onClick={() => setViewAll(true)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-sm text-ink-soft border border-border hover:border-accent-300 hover:text-accent-600 transition-colors"
          title="返回全部问题总览"
        >
          <X size={13} /> 全部
        </button>
      )}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索常见问题…"
          className="eo-input !w-60 !pl-8 !py-1 !text-sm"
        />
      </div>
      </>
    )
    return () => setPageActions(null)
    // viewAll 进依赖：顶栏的「全部」只在非总览态出现
  }, [searchQuery, viewAll])

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return faqSections
    const query = searchQuery.toLowerCase()
    return faqSections
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) => item.q.toLowerCase().includes(query) || item.a.toLowerCase().includes(query),
        ),
      }))
      .filter((section) => section.items.length > 0)
  }, [searchQuery])

  /*
   * 页面助手上下文。
   *
   * 帮助中心的内容全在前端常量里（faqSections），没有后端数据，
   * 所以必须把 FAQ 正文送进上下文 —— 否则助手只能去知识库检索，
   * 而用户眼前这些问答根本不在向量库里，答出来的和看到的对不上。
   *
   * 全文太长会挤掉检索结果，这里只带：全部问题的标题 + 当前选中那条的完整答案。
   */
  useRegisterPageAssistant({
    key: 'help',
    label: '帮助中心',
    sourceTypes: ['knowledge'],
    questions: [
      '这个系统的 AI 问答是怎么工作的？',
      '资料上传后为什么搜不到？',
      '怎么让 AI 回答得更准？',
      '各个模块之间是什么关系？',
      '常见问题里有没有讲权限设置的？',
    ],
    context: (() => {
      const current = faqSections.find((s) => s.id === active.sectionId)?.items[active.idx]
      const lines = [
        `页面：帮助中心（共 ${faqSections.length} 个分类、${totalQuestions} 条常见问题）`,
        searchQuery ? `搜索关键词：${searchQuery}` : '',
        viewAll ? '当前视图：全部' : '',
      ]
      if (current) {
        lines.push(`当前正在看的问题：${current.q}`, `答案：${current.a}`)
      }
      lines.push('全部问题目录：')
      for (const s of filteredSections) {
        lines.push(`【${s.title || s.id}】`)
        lines.push(...s.items.slice(0, 12).map((it, i) => `  ${i + 1}. ${it.q}`))
      }
      return lines.filter(Boolean).join('\n').slice(0, 6000)
    })(),
  })

  // 左侧宽度可拖拽（宽度存本地，同其他左右布局页面）
  const navPanel = useResizablePanel('aikb-nav-width-help', 280)

  // 搜索变化后选中第一个命中项，保证右侧始终有答案可看
  useEffect(() => {
    if (!filteredSections.length) return
    if (searchQuery.trim() && viewAll) {
      // 在「全部」视图下搜索：直接跳到第一个命中问题
      setViewAll(false)
      setActive({ sectionId: filteredSections[0].id, idx: 0 })
      return
    }
    if (viewAll) return
    const stillExists = filteredSections.some(
      (s) => s.id === active.sectionId && active.idx < s.items.length,
    )
    if (!stillExists) setActive({ sectionId: filteredSections[0].id, idx: 0 })
    // 搜索跳转后清空搜索时，保证选中分类处于展开状态
    if (!searchQuery.trim()) {
      setCollapsedSections((prev) => {
        if (!prev.has(active.sectionId)) return prev
        const next = new Set(prev)
        next.delete(active.sectionId)
        return next
      })
    }
     
  }, [searchQuery])

  const activeSection = filteredSections.find((s) => s.id === active.sectionId)
  const activeItem = activeSection?.items[active.idx]

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* ===================== 左侧：全部 → 分类 → 问题目录（同知识资料布局） ===================== */}
      <aside className="lg:w-[280px] flex-shrink-0" style={navPanel.panelStyle}>
        <div className="eo-card p-3 lg:sticky lg:top-4 space-y-0.5">
          {/* 「全部」已挪到顶栏（见 setPageActions）：左侧要留给问题目录 */}
          {filteredSections.length === 0 && (
            <div className="text-center py-8 text-sm text-muted">未找到匹配的问题</div>
          )}
          {filteredSections.map((section) => {
            const Icon = section.icon
            // 搜索时命中分类自动展开；平时按用户收起状态显示
            const sectionOpen = isSearching || !collapsedSections.has(section.id)
            return (
              <div key={section.id} className="mb-1">
                <button
                  onClick={() => toggleSection(section.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-caption transition-colors ${
                    !viewAll && active.sectionId === section.id
                      ? 'text-accent-700 bg-accent-50/60'
                      : 'text-muted hover:bg-canvas hover:text-ink-soft'
                  }`}
                  title={sectionOpen ? `收起「${section.title}」` : `展开「${section.title}」`}
                  aria-expanded={sectionOpen}
                >
                  <ChevronDown
                    size={12}
                    className={`shrink-0 transition-transform ${sectionOpen ? '' : '-rotate-90'}`}
                  />
                  <Icon size={13} className="text-accent-600 shrink-0" />
                  <span className="truncate text-left flex-1">{section.title}</span>
                  <span className="shrink-0">{section.items.length}</span>
                </button>
                {sectionOpen && (
                <div className="ml-3 border-l border-border pl-1.5 space-y-0.5">
                  {section.items.map((item, idx) => {
                    const isActive = !viewAll && active.sectionId === section.id && active.idx === idx
                    return (
                      <button
                        key={idx}
                        onClick={() => { setViewAll(false); setActive({ sectionId: section.id, idx }) }}
                        className={`w-full text-left px-2 py-1.5 rounded-md text-xs leading-relaxed transition-colors ${
                          isActive
                            ? 'bg-accent-50 text-accent-700 font-medium'
                            : 'text-ink-soft hover:bg-canvas'
                        }`}
                        title={item.q}
                      >
                        {item.q}
                      </button>
                    )
                  })}
                </div>
                )}
              </div>
            )
          })}
        </div>
      </aside>
      <ResizeHandle onMouseDown={navPanel.startDrag} />

      {/* ===================== 右侧：「全部」总览 / 问题详细答案 ===================== */}
      <div className="flex-1 min-w-0">
        {viewAll ? (
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-caption text-muted mb-3">
              <HelpCircle size={13} className="text-accent-600" />
              <span>全部</span>
              <span>·</span>
              <span>共 {filteredSections.reduce((s, x) => s + x.items.length, 0)} 个问题</span>
            </div>
            <h1 className="font-serif text-heading-lg font-semibold text-ink mb-4">常见问题总览</h1>
            <div className="space-y-4">
              {filteredSections.map((section) => {
                const Icon = section.icon
                return (
                  <div key={section.id} className="eo-card p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Icon size={15} className="text-accent-600" />
                      <h2 className="text-body-sm font-semibold text-ink">{section.title}</h2>
                      <span className="text-caption text-muted">{section.items.length} 个问题</span>
                    </div>
                    <div className="space-y-1">
                      {section.items.map((item, idx) => (
                        <button
                          key={idx}
                          onClick={() => { setViewAll(false); setActive({ sectionId: section.id, idx }) }}
                          className="w-full text-left px-2.5 py-1.5 rounded-md text-body-sm text-ink-soft hover:bg-canvas hover:text-ink transition-colors"
                          title={item.q}
                        >
                          {item.q}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : !activeItem ? (
            <div className="h-full flex items-center justify-center">
              <EmptyState
                icon={MessageCircleQuestion}
                title={searchQuery ? '未找到匹配的问题' : '从左侧选择问题'}
                description={searchQuery ? '尝试其他关键词，或清空搜索浏览全部问题' : '点击左侧目录查看对应解答'}
              />
            </div>
          ) : (
            <div className="max-w-3xl mx-auto">
              {/* 面包屑：分类 / 序号 */}
              <div className="flex items-center gap-2 text-caption text-muted mb-3">
                {activeSection && (
                  <>
                    <activeSection.icon size={13} className="text-accent-600" />
                    <span>{activeSection.title}</span>
                    <span>·</span>
                    <span>第 {active.idx + 1} / {activeSection.items.length} 个问题</span>
                  </>
                )}
              </div>

              <h1 className="font-serif text-heading-lg font-semibold text-ink mb-4">
                {activeItem.q}
              </h1>
              <div className="eo-card p-5">
                <p className="text-body-sm text-ink-soft leading-relaxed whitespace-pre-line">
                  {activeItem.a}
                </p>
              </div>

              {/* 同分类下一条：顺着看下去不用回左侧点 */}
              <div className="flex items-center justify-between mt-4 text-xs">
                {active.idx > 0 ? (
                  <button
                    onClick={() => setActive({ sectionId: active.sectionId, idx: active.idx - 1 })}
                    className="text-accent-600 hover:text-accent-700"
                    title="上一个问题"
                  >
                    ← 上一个：{activeSection!.items[active.idx - 1].q}
                  </button>
                ) : (
                  <span />
                )}
                {activeSection && active.idx < activeSection.items.length - 1 ? (
                  <button
                    onClick={() => setActive({ sectionId: active.sectionId, idx: active.idx + 1 })}
                    className="text-accent-600 hover:text-accent-700 text-right"
                    title="下一个问题"
                  >
                    下一个：{activeSection.items[active.idx + 1].q} →
                  </button>
                ) : (
                  <span />
                )}
              </div>

              <div className="mt-8 eo-card p-4">
                <div className="flex items-start gap-3">
                  <BookOpen size={18} className="text-accent-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-body-sm font-medium text-ink">没有找到答案？</p>
                    <p className="text-body-sm text-muted mt-1">
                      您可以通过系统内的反馈功能提交问题，或联系技术支持获取帮助。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
      </div>
    </div>
  )
}
