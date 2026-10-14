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
