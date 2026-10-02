import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Calculator,
  Gauge,
  Ruler,
  Scissors,
  Lock,
  Link as LinkIcon,
  History,
  Trash2,
  FileText,
  AlertTriangle,
  Search,
  Plus,
  Pencil,
  BookOpen,
  Columns3,
  X,
  FileSpreadsheet,
  ListTree,
  FileEdit,
  Activity,
} from 'lucide-react'
import { calcToolApi, calcRecordApi } from '../api/services'
import { usePageActions } from '../contexts/PageActionsContext'
import { useResizablePanel, ResizeHandle } from '../hooks/useResizablePanel'
import { useNavPageSize, clampNavPage } from '../hooks/useNavPageSize'
import type { CalcTemplate, CalcRecord, CalcResultItem } from '../types'
import PageHeader from '../components/PageHeader'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import EmptyState from '../components/EmptyState'
import CalcRunner from '../components/CalcRunner'
import StatCards from '../components/StatCards'
import NavPager from '../components/NavPager'
import CalcTemplateEditor from '../components/CalcTemplateEditor'
import CalcSheetList from '../components/CalcSheetList'
import Drawer from '../components/Drawer'
import Tabs from '../components/Tabs'
import Button from '../components/Button'
import ConfirmDialog from '../components/ConfirmDialog'
import { useAuthStore } from '../store/authStore'
import { DetailHeader, DetailSection, DescList } from '../components/layout-kit'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'

/** 模板 icon 字段 → lucide 组件 */
const ICONS: Record<string, typeof Calculator> = {
  Gauge,
  Ruler,
  Scissors,
  Lock,
  Link: LinkIcon,
  Calculator,
}

export default function CalcTools() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const hasRole = useAuthStore((s) => s.hasRole)
  const canManage = hasRole('admin')

  const [tab, setTab] = useState<'calc' | 'records' | 'about' | 'sheets'>('calc')
  const [calcSearch, setCalcSearch] = useState('')
  const [recordDetail, setRecordDetail] = useState<CalcRecord | null>(null)
  // 待确认删除的计算记录 / 计算工具（原来记录点了直接删、工具走的是浏览器原生 confirm）
  const [deletingRecord, setDeletingRecord] = useState<CalcRecord | null>(null)
  const [deletingTemplate, setDeletingTemplate] = useState<any | null>(null)
  /** 「全部」视图：右侧总览所有计算工具（同知识资料导航顶部入口） */
  const [showAll, setShowAll] = useState(false)
  // 左侧工具翻页：每页条数随屏高自适应，窗口拉高每页多显示几个工具，底部不留白
  const navPageSize = useNavPageSize({ rowHeight: 62, min: 4 })
  const [navPage, setNavPage] = useState(1)
  // 搜索回到第 1 页：命中的工具可能在别的页上
  useEffect(() => { setNavPage(1) }, [calcSearch])

  const setPageActions = usePageActions()
  // 左侧工具列表可拖拽调宽（宽度存本地，右侧随 flex 伸缩）
  const navPanel = useResizablePanel('aikb-nav-width-calc', 230)
  // 顶栏操作区：搜索计算工具 + 新增计算（与标准方案/知识资料等页面一致）
  useEffect(() => {
    setPageActions(
      <>
        {/* 「全部」从左侧导航顶部挪到这里：左侧要留给工具列表 */}
        {!showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-sm text-ink-soft border border-border hover:border-accent-300 hover:text-accent-600 transition-colors"
            title="返回全部计算工具总览"
          >
            <X size={13} /> 全部
          </button>
        )}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={calcSearch}
            onChange={(e) => setCalcSearch(e.target.value)}
            placeholder="搜索计算工具…"
            className="eo-input !w-60 !pl-8 !py-1 !text-sm"
          />
        </div>
        {canManage && (
          <Button onClick={() => setEditor({})} size="sm" className="!py-1 !text-sm">
            <Plus size={13} className="mr-0.5" /> 新增计算
          </Button>
        )}
      </>
    )
    return () => setPageActions(null)
     
  }, [calcSearch, canManage])

  /** 模板编辑器：null = 关闭，{} = 新建，{template} = 编辑 */
  const [editor, setEditor] = useState<{ template?: CalcTemplate; category?: string } | null>(null)

  /** 记录对比：勾选的记录 id */
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)

  const listQuery = useQuery({
    queryKey: ['calc-tools'],
    queryFn: () => calcToolApi.list(),
  })

  const templates = listQuery.data || []
  const active = code || templates[0]?.code
  const activeTemplate = templates.find((t) => t.code === active)

  // 工具全量在前端，卡片与左侧工具列表同源
  const calcCards = [
    { label: '计算工具', value: templates.length, icon: Calculator },
    { label: '分类', value: new Set(templates.map((t) => t.category).filter(Boolean)).size, icon: ListTree },
    { label: '待配置', value: templates.filter((t) => t.status === 'draft').length, icon: FileEdit, title: '草稿：参数与公式还没配好' },
    { label: '累计使用', value: templates.reduce((s, t) => s + (t.useCount || 0), 0), icon: Activity },
  ]

  // 未指定工具时跳到第一个，保证右侧面板始终有内容
  useEffect(() => {
    if (!code && templates.length) navigate(`/calc-tools/${templates[0].code}`, { replace: true })
  }, [code, templates, navigate])

  /*
   * 页面助手上下文。
   *
   * 工程计算这一页，用户问的基本都是"这个工具算什么、要输入什么"，
   * 所以当前选中工具的输入参数要逐条展开，只给工具名答不了。
   */
  useRegisterPageAssistant({
    key: 'calc-tools',
    label: '工程计算',
    sourceTypes: ['product', 'solution', 'knowledge'],
    questions: [
      '当前这个计算工具是算什么的？需要哪些输入？',
      '有哪些计算工具，分别用在什么场景？',
      '这个工具的计算结果怎么解读？',
      '哪些工具还没配好参数和公式？',
      '算这类设备需要先知道哪些参数？',
    ],
    context: (() => {
      const lines = [
        `页面：工程计算（共 ${templates.length} 个工具）`,
        activeTemplate
          ? `当前工具：${activeTemplate.name}（编码 ${activeTemplate.code}｜分类 ${activeTemplate.category || '—'}｜状态 ${activeTemplate.status || '—'}）`
          : '当前未选中工具',
      ]
      if (activeTemplate?.description) lines.push(`工具说明：${activeTemplate.description}`)
      try {
        const inputs = JSON.parse((activeTemplate as any)?.inputs || '[]')
        if (Array.isArray(inputs) && inputs.length) {
          lines.push('输入参数：')
          lines.push(
            ...inputs
              .slice(0, 40)
              .map(
                (f: any, i: number) =>
                  `  ${i + 1}. ${f.label || f.key || ''}${f.unit ? `（${f.unit}）` : ''}` +
                  `${f.default !== undefined && f.default !== '' ? `｜默认 ${f.default}` : ''}`,
              ),
          )
        }
      } catch {
        // 输入定义是坏 JSON 时不影响其余上下文
      }
      lines.push('全部工具：')
      lines.push(
        ...templates
          .slice(0, 40)
          .map((t: any, i: number) => `${i + 1}. ${t.name}｜分类 ${t.category || '—'}｜状态 ${t.status || '—'}`),
      )
      return lines.filter(Boolean).join('\n')
    })(),
  })

  const recordsQuery = useQuery({
    queryKey: ['calc-records', active],
    queryFn: () => calcRecordApi.list({ templateCode: active }),
    enabled: !!active && tab === 'records',
  })

  const removeRecord = useMutation({
    mutationFn: (id: string) => calcRecordApi.remove(id),
    onSuccess: (_r, id) => {
      toast.success('已删除')
      setCompareIds((p) => p.filter((x) => x !== id))
      setDeletingRecord(null)
      recordsQuery.refetch()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '删除失败'),
  })

  const removeTemplate = useMutation({
    mutationFn: (c: string) => calcToolApi.remove(c),
    onSuccess: (res) => {
      setDeletingTemplate(null)
      toast.success(
        res.disabled
          ? `该工具已有 ${res.used} 条计算记录，已改为停用（记录与公式都保留）`
          : '计算工具已删除',
      )
      listQuery.refetch().then((r) => {
        const rest = r.data || []
        if (rest.length) navigate(`/calc-tools/${rest[0].code}`, { replace: true })
      })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '删除失败'),
  })

  const openRecord = async (id: string) => {
    const record = await calcRecordApi.get(id)
    setRecordDetail(record)
  }

  /** 对比用的完整记录（列表接口不带 inputs/results，得逐条取） */
  const compareQuery = useQuery({
    queryKey: ['calc-compare', ...compareIds],
    queryFn: () => Promise.all(compareIds.map((id) => calcRecordApi.get(id))),
    enabled: compareOpen && compareIds.length > 1,
  })

  const toggleCompare = (id: string) =>
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 4) {
        toast.error('最多同时对比 4 条')
        return prev
      }
      return [...prev, id]
    })

  if (listQuery.isLoading) return <PageLoader />
  if (listQuery.isError) return <ErrorState message="计算工具加载失败" onRetry={() => listQuery.refetch()} />

  if (templates.length === 0) {
    return (
      <div>
        <PageHeader
          title="计算"
          titleEm="工具"
          actions={
            canManage ? (
              <Button onClick={() => setEditor({})}>
                <Plus size={15} className="mr-1" /> 新增计算
              </Button>
            ) : undefined
          }
        />
        <EmptyState
          icon={Calculator}
          title="尚无可用计算工具"
          description="内置模板会在后端首次启动时自动写入；也可以点右上角「新增计算」自己配一个"
        />
        <CalcTemplateEditor
          open={!!editor}
          onClose={() => setEditor(null)}
          template={editor?.template}
          defaultCategory={editor?.category}
          existingCategories={[]}
          existingCodes={[]}
          onSaved={(t) => {
            listQuery.refetch()
            navigate(`/calc-tools/${t.code}`)
          }}
        />
      </div>
    )
  }

  // 按产品线分组
  // 模板一多就得挨个分类找，先按关键词过一遍
  const visibleTemplates = calcSearch
    ? templates.filter(
        (t) =>
          t.name?.toLowerCase().includes(calcSearch.toLowerCase()) ||
          t.description?.toLowerCase().includes(calcSearch.toLowerCase()) ||
          t.category?.toLowerCase().includes(calcSearch.toLowerCase()),
      )
    : templates

  // 工具列表翻页：每页条数随屏高自适应；页码越界（工具变少/屏幕拉高）时渲染前收敛
  const navTotalPages = Math.max(1, Math.ceil(visibleTemplates.length / navPageSize))
  const safePage = clampNavPage(navPage, navTotalPages)
  const pagedTools = visibleTemplates.slice((safePage - 1) * navPageSize, safePage * navPageSize)

  return (
    <div>
      <PageHeader
        title="计算"
        titleEm="工具"
      />

      {/* 统计卡片：与业务概览/客户中心同一套组件 */}
      <StatCards className="mb-4" loading={listQuery.isLoading} skeletonCount={4} items={calcCards} />

      <div className="flex flex-col lg:flex-row gap-4">
        {/* 左侧工具列表 */}
        <aside className="lg:w-[230px] flex-shrink-0" style={navPanel.panelStyle}>
          <div className="eo-card p-3 lg:sticky lg:top-4 space-y-3">
            {/* 「全部」已挪到顶栏（见 setPageActions）：左侧要留给工具列表 */}
            {visibleTemplates.length === 0 && (
              <p className="px-2 py-3 text-body-sm text-muted">没有匹配的计算工具</p>
            )}
            {pagedTools.map((t, i) => {
              // 分类标题只在分页内的首个工具处出现，跨页也不丢分类上下文
              const globalIdx = (safePage - 1) * navPageSize + i
              const prev = visibleTemplates[globalIdx - 1]
              const showCategory = !prev || (prev.category || '其他') !== (t.category || '其他')
              const Icon = ICONS[t.icon || ''] || Calculator
              const on = !showAll && t.code === active
              return (
                <div key={t.code}>
                  {showCategory && (
                    <div className="px-2 py-1 flex items-center gap-1">
                      <span className="eo-label">{t.category || '其他'}</span>
                      {canManage && !calcSearch && (
                        <button
                          onClick={() => setEditor({ category: t.category || '其他' })}
                          title={`在「${t.category || '其他'}」下新增计算`}
                          className="ml-auto text-muted hover:text-accent-600 transition-colors"
                          aria-label={`在 ${t.category || '其他'} 下新增计算`}
                        >
                          <Plus size={13} />
                        </button>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => { setShowAll(false); navigate(`/calc-tools/${t.code}`) }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md flex items-center gap-2.5 transition-colors ${
                      on ? 'bg-accent-50' : 'hover:bg-canvas'
                    }`}
                  >
                    <Icon
                      size={16}
                      className={`flex-shrink-0 ${on ? 'text-accent-600' : 'text-muted'}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-body-sm truncate ${on ? 'text-accent-700 font-medium' : 'text-ink'}`}>
                        {t.name}
                        {t.status === 'draft' && (
                          <span className="ml-1.5 text-caption px-1 py-0.5 rounded bg-warning-bg text-warning-fg font-normal">
                            草稿
                          </span>
                        )}
                      </span>
                      {/* 只留一行用途；详细说明在右侧「计算说明」里 */}
                      <span className="block text-caption text-muted truncate">
                        {t.status === 'draft' ? '待配置参数与公式' : t.description}
                      </span>
                    </span>
                    {!!t.useCount && (
                      <span className="font-mono text-caption text-muted flex-shrink-0">{t.useCount}</span>
                    )}
                  </button>
                </div>
              )
            })}
            {/* 工具翻页：工具多时逐页浏览，每页条数随屏高自适应 */}
            <NavPager page={safePage} totalPages={navTotalPages} onChange={setNavPage} label="工具" />
          </div>
        </aside>
      <ResizeHandle onMouseDown={navPanel.startDrag} />

        {/* 右侧计算面板：「全部」总览 / 单个工具 */}
        <div className="flex-1 min-w-0">
          {showAll ? (
            <div>
              <div className="flex items-center gap-3 text-sm flex-wrap mb-3">
                <span className="font-medium text-ink">全部计算工具</span>
                <span className="text-muted">共 {templates.length} 个工具</span>
              </div>
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                {templates.map((t) => {
                  const Icon = ICONS[t.icon || ''] || Calculator
                  return (
                    <button
                      key={t.code}
                      onClick={() => { setShowAll(false); navigate(`/calc-tools/${t.code}`) }}
                      className="eo-card p-4 text-left hover:shadow-card transition-shadow"
                      title={`打开「${t.name}」`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <Icon size={16} className="text-accent-600 flex-shrink-0" />
                        <span className="flex-1 min-w-0 truncate text-body-sm font-medium text-ink">{t.name}</span>
                        {t.status === 'draft' && (
                          <span className="text-caption px-1 py-0.5 rounded bg-warning-bg text-warning-fg shrink-0">草稿</span>
                        )}
                      </div>
                      <p className="text-caption text-muted truncate">{t.description || '暂无说明'}</p>
                      <p className="text-caption text-muted mt-1">
                        {t.category || '未分类'}{t.useCount ? ` · 已使用 ${t.useCount} 次` : ''}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
          <div className="eo-card p-5">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <Tabs
                tabs={[
                  { value: 'calc', label: '计算', icon: Calculator },
                  { value: 'records', label: '计算记录', icon: History },
                  { value: 'about', label: '计算说明', icon: BookOpen },
                  { value: 'sheets', label: '计算表', icon: FileSpreadsheet },
                ]}
                value={tab}
                onChange={(v) => setTab(v as any)}
                className="flex-1 min-w-0"
              />
              {canManage && activeTemplate && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setEditor({ template: activeTemplate })}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-label text-muted hover:text-accent-600 hover:bg-accent-50 transition-colors"
                  >
                    <Pencil size={13} /> 编辑
                  </button>
                  <button
                    onClick={() => setDeletingTemplate(activeTemplate)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-label text-muted hover:text-danger-fg hover:bg-danger-bg/50 transition-colors"
                  >
                    <Trash2 size={13} /> 删除
                  </button>
                </div>
              )}
            </div>

            {/* 草稿还算不了，给个直达编辑器的入口，别让人对着空表单发呆 */}
            {tab === 'calc' && activeTemplate?.status === 'draft' ? (
              <EmptyState
                bare
                icon={Pencil}
                title="这个计算工具还是草稿"
                description={
                  activeTemplate.schema?.formulas?.length
                    ? '公式还没配全，补完并启用后才能开始计算'
                    : '参数与公式都还没配，点下面接着配置'
                }
                action={
                  canManage ? (
                    <Button onClick={() => setEditor({ template: activeTemplate })}>
                      <Pencil size={14} className="mr-1" /> 继续配置
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              tab === 'calc' && active && <CalcRunner key={active} code={active} allowPickRequirement />
            )}

            {/* ── 计算说明 ── */}
            {tab === 'about' && activeTemplate && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-body-sm font-semibold text-ink mb-1.5">用途</h3>
                  <p className="text-body-sm text-ink-soft leading-relaxed">
                    {activeTemplate.description || '（该工具尚未填写用途说明）'}
                  </p>
                </div>

                {activeTemplate.schema?.notes && (
                  <div>
                    <h3 className="text-body-sm font-semibold text-ink mb-1.5">适用范围与取值说明</h3>
                    <p className="text-body-sm text-ink-soft leading-relaxed whitespace-pre-wrap">
                      {activeTemplate.schema.notes}
                    </p>
                  </div>
                )}

                <div>
                  <h3 className="text-body-sm font-semibold text-ink mb-2">
                    需要填写的参数（{activeTemplate.schema?.inputs?.length || 0} 项）
                  </h3>
                  <div className="eo-scroll-x">
                    <table className="w-full text-body-sm">
                      <thead>
                        <tr className="border-y border-border bg-subtle">
                          <th className="eo-th text-left py-2 px-3">参数</th>
                          <th className="eo-th text-left py-2 px-3">单位</th>
                          <th className="eo-th text-left py-2 px-3">合理范围</th>
                          <th className="eo-th text-left py-2 px-3">分组</th>
                          <th className="eo-th text-left py-2 px-3">取值说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(activeTemplate.schema?.inputs || []).map((f) => (
                          <tr key={f.key} className="border-b border-divider last:border-0">
                            <td className="py-2 px-3 text-ink">
                              {f.label}
                              {f.required && <span className="text-danger-fg ml-0.5">*</span>}
                            </td>
                            <td className="py-2 px-3 text-muted text-label">{f.unit || '-'}</td>
                            <td className="py-2 px-3 text-muted eo-num text-label">
                              {f.min != null || f.max != null
                                ? `${f.min ?? '-∞'} ~ ${f.max ?? '+∞'}`
                                : '-'}
                            </td>
                            <td className="py-2 px-3 text-muted text-label">{f.group || '-'}</td>
                            <td className="py-2 px-3 text-muted text-label">{f.hint || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h3 className="text-body-sm font-semibold text-ink mb-2">会算出哪些结果</h3>
                  <div className="flex flex-wrap gap-2">
                    {(activeTemplate.schema?.formulas || [])
                      .filter(
                        (f) =>
                          !activeTemplate.schema?.outputs?.length ||
                          activeTemplate.schema.outputs.includes(f.key),
                      )
                      .map((f) => (
                        <span
                          key={f.key}
                          className="px-2.5 py-1 rounded-md bg-accent-50 text-body-sm text-accent-700"
                          title={f.hint}
                        >
                          {f.label}
                          {f.unit ? ` (${f.unit})` : ''}
                        </span>
                      ))}
                  </div>
                </div>

                {/* 公式默认收起 —— 业务人员多数只关心填什么、出什么 */}
                <details className="rounded-lg border border-border overflow-hidden">
                  <summary className="px-3 py-2 bg-subtle text-body-sm text-ink-soft cursor-pointer select-none hover:bg-canvas transition-colors">
                    展开计算公式（{activeTemplate.schema?.formulas?.length || 0} 步，含中间量）
                  </summary>
                  <div className="eo-scroll-x">
                    <table className="w-full text-body-sm">
                      <thead>
                        <tr className="border-y border-border bg-subtle">
                          <th className="eo-th text-left py-2 px-3 w-10">步</th>
                          <th className="eo-th text-left py-2 px-3">计算量</th>
                          <th className="eo-th text-left py-2 px-3">计算式</th>
                          <th className="eo-th text-left py-2 px-3">告警区间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(activeTemplate.schema?.formulas || []).map((f, i) => {
                          const isOut =
                            !activeTemplate.schema?.outputs?.length ||
                            activeTemplate.schema.outputs.includes(f.key)
                          return (
                            <tr key={f.key} className="border-b border-divider last:border-0">
                              <td className="py-2 px-3 font-mono text-caption text-muted">{i + 1}</td>
                              <td className={`py-2 px-3 ${isOut ? 'text-ink font-medium' : 'text-muted'}`}>
                                {f.label}
                                {f.unit ? ` (${f.unit})` : ''}
                                {!isOut && <span className="text-caption text-muted ml-1">中间量</span>}
                              </td>
                              <td className="py-2 px-3 font-mono text-caption text-ink-soft">
                                <span className="text-accent-700">{f.key}</span> = {f.expr}
                              </td>
                              <td className="py-2 px-3 text-caption text-muted eo-num">
                                {f.warnBelow != null || f.warnAbove != null
                                  ? `${f.warnBelow ?? '-∞'} ~ ${f.warnAbove ?? '+∞'}`
                                  : '-'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="px-3 py-2 text-caption text-muted border-t border-border">
                    公式按上表顺序求值，后一步可以引用前面算出的量。当前为
                    <span className="font-mono"> v{activeTemplate.version}</span>；
                    改动公式会升版本，已有记录仍保留当时的版本号。
                  </p>
                </details>
              </div>
            )}

            {tab === 'records' && (
              recordsQuery.isLoading ? (
                <PageLoader />
              ) : (recordsQuery.data || []).length === 0 ? (
                <EmptyState
                  bare
                  icon={History}
                  title="还没有计算记录"
                  description="计算后点击「保存记录」，结果可关联到方案与报价供后续回查"
                />
              ) : (
                <div className="space-y-1.5">
                  {/* 对比条：勾了两条以上才有意义 */}
                  <div className="flex items-center gap-2 pb-2 flex-wrap">
                    <span className="text-label text-muted">
                      勾选 2–4 条可并排对比不同方案的参数与结果
                    </span>
                    <div className="flex-1" />
                    {compareIds.length > 0 && (
                      <button
                        onClick={() => setCompareIds([])}
                        className="text-label text-muted hover:text-ink inline-flex items-center gap-1"
                      >
                        <X size={12} /> 清空（{compareIds.length}）
                      </button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={compareIds.length < 2}
                      onClick={() => setCompareOpen(true)}
                    >
                      <Columns3 size={13} className="mr-1" /> 对比（{compareIds.length}）
                    </Button>
                  </div>

                  {(recordsQuery.data || []).map((r) => (
                    <div
                      key={r.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${
                        compareIds.includes(r.id) ? 'bg-accent-50' : 'bg-subtle hover:bg-canvas'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={compareIds.includes(r.id)}
                        onChange={() => toggleCompare(r.id)}
                        className="w-3.5 h-3.5 accent-accent-500 flex-shrink-0"
                        aria-label={`选择「${r.title}」用于对比`}
                      />
                      <FileText size={14} className="text-muted flex-shrink-0" />
                      <button onClick={() => openRecord(r.id)} className="min-w-0 flex-1 text-left">
                        <span className="block text-body-sm text-ink truncate hover:text-accent-600">
                          {r.title}
                        </span>
                        <span className="block text-caption text-muted">
                          {r.createdByName || '—'} ·{' '}
                          <span className="font-mono">
                            {new Date(r.createdAt).toLocaleString('zh-CN')}
                          </span>
                          {r.templateVersion && ` · 模板 v${r.templateVersion}`}
                        </span>
                      </button>
                      {(r.relatedProposalId || r.relatedRequirementId) && (
                        <span className="font-mono text-caption px-1.5 py-0.5 rounded bg-info-bg text-info-fg flex-shrink-0">
                          已关联
                        </span>
                      )}
                      <button
                        onClick={() => setDeletingRecord(r)}
                        className="text-muted hover:text-danger-fg flex-shrink-0"
                        title={"删除记录"}
                        aria-label="删除记录"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}

            {tab === 'sheets' && active && (
              <CalcSheetList
                filters={{ templateCode: active }}
                context={{ templateCode: active }}
              />
            )}
          </div>
          )}
        </div>
      </div>

      {/* 记录对比 —— 同一项目常要试算几轮，靠一条条点开比对根本看不出差在哪 */}
      <Drawer
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        title={`计算记录对比（${compareIds.length} 条）`}
        width="w-[880px]"
      >
        {compareQuery.isLoading ? (
          <PageLoader />
        ) : (
          (() => {
            const rows = compareQuery.data || []
            if (rows.length < 2) return null

            // 并集取键，某条记录缺这个量时留空而不是跳过整行
            const inputKeys = [...new Set(rows.flatMap((r: any) => Object.keys(r.inputs || {})))]
            const resultKeys = [
              ...new Set(rows.flatMap((r: any) => (r.results || []).map((x: CalcResultItem) => x.key))),
            ]
            const labelOf = (key: string) => {
              const fromTpl = activeTemplate?.schema?.inputs?.find((i) => i.key === key)
              if (fromTpl) return `${fromTpl.label}${fromTpl.unit ? ` (${fromTpl.unit})` : ''}`
              return key
            }
            const resultMeta = (key: string): CalcResultItem | undefined => {
              for (const r of rows as any[]) {
                const hit = (r.results || []).find((x: CalcResultItem) => x.key === key)
                if (hit) return hit
              }
              return undefined
            }
            /** 各条取值不全一样就高亮，方案之间到底改了什么一眼看到 */
            const differs = (vals: (string | number | undefined)[]) =>
              new Set(vals.map((v) => (v === undefined || v === null ? '' : String(v)))).size > 1

            return (
              <div className="space-y-5">
                <div className="eo-scroll-x">
                  <table className="w-full text-body-sm">
                    <thead>
                      <tr className="border-y border-border bg-subtle">
                        <th className="eo-th text-left py-2 px-3 sticky left-0 bg-subtle">项目</th>
                        {rows.map((r: any) => (
                          <th key={r.id} className="eo-th text-right py-2 px-3 min-w-[130px]">
                            <span className="block text-ink truncate" title={r.title}>
                              {r.title}
                            </span>
                            <span className="block font-normal text-caption text-muted">
                              {new Date(r.createdAt).toLocaleDateString('zh-CN')}
                              {r.templateVersion ? ` · v${r.templateVersion}` : ''}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-canvas">
                        <td
                          colSpan={rows.length + 1}
                          className="py-1.5 px-3 eo-label sticky left-0 bg-canvas"
                        >
                          输入值
                        </td>
                      </tr>
                      {inputKeys.map((k) => {
                        const vals = rows.map((r: any) => r.inputs?.[k])
                        const hot = differs(vals)
                        return (
                          <tr key={k} className="border-b border-divider">
                            <td
                              className={`py-1.5 px-3 sticky left-0 bg-surface ${hot ? 'text-ink font-medium' : 'text-muted'}`}
                            >
                              {labelOf(k)}
                            </td>
                            {vals.map((v, i) => (
                              <td
                                key={i}
                                className={`py-1.5 px-3 text-right eo-num ${
                                  hot ? 'bg-warning-bg/40 text-ink' : 'text-ink-soft'
                                }`}
                              >
                                {v === undefined || v === null || v === '' ? '—' : String(v)}
                              </td>
                            ))}
                          </tr>
                        )
                      })}

                      <tr className="bg-canvas">
                        <td
                          colSpan={rows.length + 1}
                          className="py-1.5 px-3 eo-label sticky left-0 bg-canvas"
                        >
                          输出值
                        </td>
                      </tr>
                      {resultKeys.map((k) => {
                        const meta = resultMeta(k)
                        const vals = rows.map(
                          (r: any) =>
                            (r.results || []).find((x: CalcResultItem) => x.key === k)?.value,
                        )
                        const hot = differs(vals)
                        return (
                          <tr key={k} className="border-b border-divider">
                            <td
                              className={`py-1.5 px-3 sticky left-0 bg-surface ${
                                meta?.isOutput ? 'text-ink font-medium' : 'text-muted'
                              }`}
                            >
                              {meta?.label || k}
                              {meta?.unit ? ` (${meta.unit})` : ''}
                            </td>
                            {vals.map((v, i) => (
                              <td
                                key={i}
                                className={`py-1.5 px-3 text-right eo-num ${
                                  hot ? 'bg-accent-50 text-accent-700' : 'text-ink-soft'
                                }`}
                              >
                                {typeof v === 'number' ? v.toLocaleString('zh-CN') : '—'}
                              </td>
                            ))}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center gap-4 text-caption text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-warning-bg" /> 输入值有差异
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm bg-accent-50" /> 结果有差异
                  </span>
                </div>

                {new Set(rows.map((r: any) => r.templateVersion)).size > 1 && (
                  <p className="text-label text-warning-fg flex items-start gap-1.5">
                    <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                    这几条记录用的不是同一版公式，结果差异可能来自模板改动而不是参数变化。
                  </p>
                )}
              </div>
            )
          })()
        )}
      </Drawer>

      {/* 删除确认：记录删了就没了，工具删除还可能被后端降级成停用，文案分开写 */}
      <ConfirmDialog
        open={!!deletingRecord}
        onClose={() => setDeletingRecord(null)}
        onConfirm={() => deletingRecord && removeRecord.mutate(deletingRecord.id)}
        loading={removeRecord.isPending}
        title="确认删除记录"
        message={<>确定删除计算记录「{deletingRecord?.title}」吗？</>}
        detail="删除后无法恢复，这次计算的输入参数和结果都不再保留。"
      />

      <ConfirmDialog
        open={!!deletingTemplate}
        onClose={() => setDeletingTemplate(null)}
        onConfirm={() => deletingTemplate && removeTemplate.mutate(deletingTemplate.code)}
        loading={removeTemplate.isPending}
        title="确认删除计算工具"
        message={<>确定删除计算工具「{deletingTemplate?.name}」吗？</>}
        detail="若该工具已有计算记录，会自动改为停用而不是真删 —— 记录里的数字要靠公式才解释得清；没有记录时则彻底删除，无法恢复。"
      />

      {/* 模板编辑器 */}
      <CalcTemplateEditor
        open={!!editor}
        onClose={() => setEditor(null)}
        template={editor?.template}
        defaultCategory={editor?.category}
        existingCategories={[...new Set(templates.map((t) => t.category || '其他'))]}
        existingCodes={templates.map((t) => t.code)}
        onSaved={(t) => {
          listQuery.refetch()
          navigate(`/calc-tools/${t.code}`)
          setTab('calc')
        }}
      />

      {/* 记录详情 */}
      <Drawer
        open={!!recordDetail}
        onClose={() => setRecordDetail(null)}
        title={recordDetail?.title || '计算记录'}
        width="w-[620px]"
      >
        {recordDetail && (
          <div className="space-y-5">
            <DetailHeader
              title={recordDetail.templateName}
              code={`v${recordDetail.templateVersion}`}
              stats={[
                { label: '计算人', value: recordDetail.createdByName },
                {
                  label: '计算时间',
                  value: new Date(recordDetail.createdAt).toLocaleString('zh-CN'),
                },
              ]}
            />

            {recordDetail.remark && (
              <DetailSection title="备注">
                <DescList items={[{ label: '说明', value: recordDetail.remark, full: true }]} />
              </DetailSection>
            )}

            <div>
              <h4 className="text-body-sm font-semibold text-ink mb-2">输入参数</h4>
              <div className="eo-scroll-x">
                <table className="w-full text-body-sm">
                  <tbody>
                    {Object.entries(recordDetail.inputs || {}).map(([k, v]) => (
                      <tr key={k} className="border-b border-divider last:border-0">
                        <td className="py-1.5 pr-4 text-muted font-mono text-caption">{k}</td>
                        <td className="py-1.5 text-right eo-num text-ink">{String(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h4 className="text-body-sm font-semibold text-ink mb-2">计算结果</h4>
              <div className="eo-scroll-x">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="border-b border-border bg-subtle">
                      <th className="eo-th text-left py-2 px-2">量</th>
                      <th className="eo-th text-right py-2 px-2">值</th>
                      <th className="eo-th text-left py-2 px-2">单位</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recordDetail.results || []).map((r) => (
                      <tr
                        key={r.key}
                        className={`border-b border-divider last:border-0 ${
                          r.isOutput ? 'font-medium' : 'text-muted'
                        }`}
                      >
                        <td className="py-1.5 px-2 flex items-center gap-1">
                          {r.label}
                          {r.warn && <AlertTriangle size={11} className="text-warning-fg" />}
                        </td>
                        <td className="py-1.5 px-2 text-right eo-num">{r.value.toLocaleString('zh-CN')}</td>
                        <td className="py-1.5 px-2 text-label">{r.unit || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}

