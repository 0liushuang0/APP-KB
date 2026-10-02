import { useEffect, useMemo, useState, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Upload,
  Eye,
  Trash2,
  Download,
  Pencil,
  FileText,
  Link2,
  Unlink,
  GitBranch,
  Scan,
  Search,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Plus,
  Files,
  Building2,
  HardDrive,
  CheckCircle2,
  Clock,
  FolderInput,
  X,
} from 'lucide-react'
import {
  documentApi,
  customerApi,
  productApi,
} from '../api/services'
import { downloadFile } from '../api/files'
import { useDebounce } from '../hooks/useDebounce'
import { usePagedQuery } from '../hooks/usePagedQuery'
import { useFormValidation, required } from '../hooks/useFormValidation'
import { useResizablePanel, ResizeHandle } from '../hooks/useResizablePanel'
import { useNavPageSize, clampNavPage } from '../hooks/useNavPageSize'
import { useModuleStats } from '../hooks/useModuleStats'
import { usePageActions } from '../contexts/PageActionsContext'
import { toList } from '../utils/apiList'
import NavPager from '../components/NavPager'
import StatCards from '../components/StatCards'
import {
  type Document,
  type DocumentLink,
  DOC_CATEGORY_OPTIONS,
  DOC_SUBCATEGORY_MAP,
  DOC_GRANDSUB_MAP,
  CUSTOMER_DOC_CATEGORIES,
  CUSTOMER_DOC_SUBCATEGORY_MAP,
  resolveDocCategoryLabel,
  FILE_TYPE_OPTIONS,
  DOC_STAGE_LABELS,
} from '../types'
import Button from '../components/Button'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import Drawer from '../components/Drawer'
import FormInput from '../components/FormInput'
import FormSelect from '../components/FormSelect'
import DataTable from '../components/DataTable'
import StatusBadge from '../components/StatusBadge'
import PageHeader from '../components/PageHeader'
import { FormSection, FieldGrid, DetailHeader, DetailSection, DescList } from '../components/layout-kit'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import EmptyState from '../components/EmptyState'
import FileDropZone from '../components/FileDropZone'
import FilePreview from '../components/FilePreview'
import FilterPanel, { type FilterGroupDef, type FilterValues } from '../components/FilterPanel'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'
import { runWithConcurrency, uploadErrorMessage } from '../utils/batchUpload'

const visibilityOptions = [
  { value: 'public', label: '公开' },
  { value: 'department', label: '部门' },
  { value: 'private', label: '私有' },
]

const statusOptions = [
  { value: 'pending', label: '待整理' },
  { value: 'approved', label: '可用' },
  { value: 'rejected', label: '已停用' },
]

// ─── 工具函数与常量：提取到 documents-helpers.ts（主文件减负） ───
import {
  handleError,
  loadNavOrders, saveNavOrders,
  NAV_GROUP_ORDER_KEY, NAV_SUB_ORDER_KEY,
  NAV_LABEL_OVERRIDES_KEY,
  NAV_EXTRA_SUBS_KEY, NAV_EXTRA_GRANDSUBS_KEY, NAV_GRANDSUB_ORDER_KEY, NAV_HIDDEN_KEY,
  MAX_DOC_FILE_SIZE,
  PRODUCT_DOC_GROUP, PRODUCT_DOC_PREFIX,
  formatSize,
} from './documents-helpers'

// ─── 独立弹窗子组件：提取到 DocumentModals.tsx ───
import { LinkModal, MoveCategoryPicker } from './DocumentModals'

// ─── 工具函数/常量已提取到 documents-helpers.ts，此处仅保留 linkChips（含 JSX） ───

/** 一条 link 上填了哪些链路节点 → 展示成可点击芯片 */
function linkChips(link: DocumentLink, navigate: (p: string) => void) {
  const chips: Array<{ label: string; path: string }> = []
  if (link.requirementId) chips.push({ label: '需求', path: `/requirements/${link.requirementId}` })
  if (link.proposalId) chips.push({ label: '方案', path: `/proposals?highlight=${link.proposalId}` })
  if (link.quotationId) chips.push({ label: '报价', path: `/quotations?highlight=${link.quotationId}` })
  if (link.projectId) chips.push({ label: '项目', path: `/projects?highlight=${link.projectId}` })
  if (link.solutionId) chips.push({ label: '模板', path: `/solutions?highlight=${link.solutionId}` })
  return chips.map((c) => (
    <button
      key={c.label + c.path}
      onClick={(e) => {
        e.stopPropagation()
        navigate(c.path)
      }}
      className="font-mono text-caption px-1.5 py-0.5 rounded bg-info-bg text-info-fg hover:bg-info-line transition-colors"
    >
      {c.label}
    </button>
  ))
}

export default function Documents({ fixedScope }: { fixedScope?: string }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fileRef = useRef<HTMLInputElement>(null)

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [filters, setFilters] = useState<FilterValues>(() => {
    // 如果作为子页面被固定 scope 调用（如 CustomerDocs），直接用该 scope
    if (fixedScope) return { scope: fixedScope }
    // 从 URL ?scope=customer 初始化
    const scope = searchParams.get('scope')
    return scope ? { scope } : {}
  })
  const [editDoc, setEditDoc] = useState<Document | null>(null)
  const [editForm, setEditForm] = useState({ title: '', category: '', visibility: '' })

  const openEditDoc = (row: Document) => {
    setEditDoc(row)
    setEditForm({
      title: row.title || '',
      category: row.category || 'other',
      visibility: row.visibility || 'public',
    })
  }

  const [modalOpen, setModalOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [linkModalFor, setLinkModalFor] = useState<Document | null>(null)
  const [chainCustomerId, setChainCustomerId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  // 待确认解除的关联（关联链路一断，客户 360、需求、方案页就都回查不到这份文件了）
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null)
  // 回收站抽屉 + 彻底删除确认
  const [recycleOpen, setRecycleOpen] = useState(false)
  const [purgeId, setPurgeId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Document | null>(null)
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null)
  const [droppedFile, setDroppedFile] = useState<File | null>(null)

  // ─── 左侧导航：大类展开子类，选中子类 = 筛选 + 顶栏/拖拽直传目标（同知识资料页） ───
  const scopeKey = fixedScope || (searchParams.get('scope') ?? 'all')
  const isCustomer = fixedScope === 'customer'
  const catGroups = isCustomer
    ? CUSTOMER_DOC_CATEGORIES
    : [
        ...DOC_CATEGORY_OPTIONS,
        { value: PRODUCT_DOC_GROUP, label: '产品资料', hint: '按产品归档的图纸、样本、说明书；由产品管理页上传时自动建立' },
      ]
  const baseSubMap = isCustomer ? CUSTOMER_DOC_SUBCATEGORY_MAP : DOC_SUBCATEGORY_MAP

  /*
   * 「产品资料」大类：子类就是产品列表，等于每个产品在资料库里自动有一个文件夹。
   *
   * 产品页的「相关文档」把文件传成 category = `product:产品名`，这里按同样的规则
   * 还原成文件夹 —— 不用真的去建目录，也不会出现"传了文件但资料库里找不到"。
   * 只在业务资料下出现；客户资料是另一套分类，不掺进来。
   */
  const productsQuery = useQuery({
    queryKey: ['products-for-doc-nav'],
    queryFn: () => productApi.list({ pageSize: 200 }),
    enabled: !isCustomer,
    staleTime: 5 * 60_000,
  })
  const productSubs = useMemo(
    () =>
      toList<any>(productsQuery.data)
        .map((p) => ({ value: `${PRODUCT_DOC_PREFIX}${p.name}`, label: p.name }))
        .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
    [productsQuery.data],
  )

  // 左侧导航计数：按分类统计条数，scope 口径与列表一致（客户/业务两个视图分开算）
  const countsQuery = useQuery({
    queryKey: ['document-category-counts', scopeKey],
    queryFn: () => documentApi.categoryCounts(scopeKey === 'all' ? undefined : scopeKey),
    staleTime: 60_000,
  })
  const catCounts: Record<string, number> = countsQuery.data || {}
  const subCount = (value: string) => {
    const direct = catCounts[value] || 0
    const grandSum = (grandSubMap[value] || []).reduce((sum, g) => sum + (catCounts[g.value] || 0), 0)
    return direct + grandSum
  }
  const groupCount = (value: string) =>
    subCount(value) + (subMap[value] || []).reduce((sum, s) => sum + subCount(s.value), 0)

  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [activeSub, setActiveSub] = useState<string | null>(null)
  /*
   * 记「收起的大类」而不是「展开的大类」：默认全部展开。
   * 大类列表来自常量 + 用户自建子类，存展开集就得等数据齐了再回填一次，
   * 存收起集则天然默认展开，后加进来的大类也一样是展开的。
   */
  /*
   * 默认全部收起。
   *
   * 原来是默认全展开（空数组 = 没有收起的），大类 × 子类 × 孙子类一铺到底，
   * 左侧一屏根本装不下，只能靠滚动找 —— 这正是"内容太多需要下翻"的来源。
   * 改成默认收起后，一屏能看全所有大类，点开才展子类。
   * 仍然存"收起集"而不是"展开集"：这样用户展开过的会被记住，
   * 后续新增的大类也天然是收起的。
   */
  const [collapsedCats, setCollapsedCats] = useState<string[]>(() =>
    catGroups.map((g) => g.value),
  )
  const toggleCat = (value: string) =>
    setCollapsedCats((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  // 用户新增子类：Record<scope, Record<大类值, 子类名[]>>；名字即存储值
  const [extraSubs, setExtraSubs] = useState<Record<string, Record<string, string[]>>>(() => loadNavOrders(NAV_EXTRA_SUBS_KEY))
  // 用户删除的导航值（含静态内置项），按 scope 存；渲染时过滤掉
  const [hiddenNavValues, setHiddenNavValues] = useState<Record<string, string[]>>(() => loadNavOrders(NAV_HIDDEN_KEY))
  const isNavHidden = (v: string) => (hiddenNavValues[scopeKey] || []).includes(v)
  // 内联新增子类：当前正在新增的大类 + 输入值
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null)
  const [newNavSubName, setNewNavSubName] = useState('')
  const [navGroupOrders, setNavGroupOrders] = useState<Record<string, string[]>>(() => loadNavOrders(NAV_GROUP_ORDER_KEY))
  const [navSubOrders, setNavSubOrders] = useState<Record<string, Record<string, string[]>>>(() => loadNavOrders(NAV_SUB_ORDER_KEY))
  // 分类改名展示覆盖：分类存储值是系统固定枚举，改名只是换展示标签
  const [labelOverrides, setLabelOverrides] = useState<Record<string, string>>(() => loadNavOrders(NAV_LABEL_OVERRIDES_KEY))
  const [renamingNav, setRenamingNav] = useState<string | null>(null)
  const [renameNavValue, setRenameNavValue] = useState('')
  const [extraGrandSubs, setExtraGrandSubs] = useState<Record<string, Record<string, string[]>>>(() => loadNavOrders(NAV_EXTRA_GRANDSUBS_KEY))
  const [navGrandSubOrders, setNavGrandSubOrders] = useState<Record<string, Record<string, string[]>>>(() => loadNavOrders(NAV_GRANDSUB_ORDER_KEY))
  const [activeGrandSub, setActiveGrandSub] = useState<string | null>(null)
  const [addingGrandSubFor, setAddingGrandSubFor] = useState<string | null>(null)
  const [newNavGrandSubName, setNewNavGrandSubName] = useState('')
  const [collapsedSubs, setCollapsedSubs] = useState<string[]>([])
  const toggleSub = (value: string) =>
    setCollapsedSubs(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value])
  const [deletingNav, setDeletingNav] = useState<{ level: 1 | 2 | 3; value: string; parentValue?: string; grandParentValue?: string } | null>(null)
  const displayLabel = (value: string, fallback?: string) => labelOverrides[value] || fallback || value
  const resolvedCatLabel = (raw?: string) => (raw && labelOverrides[raw]) || resolveDocCategoryLabel(raw)

  // 内置子类 + 产品文件夹 + 用户新增子类合并；新增子类追加在末尾。已删除的值（含静态项）过滤掉
  const subMap = useMemo(() => {
    const merged: Record<string, { value: string; label: string }[]> = {}
    for (const [g, subs] of Object.entries(baseSubMap)) {
      merged[g] = subs.filter((s) => !isNavHidden(s.value))
    }
    if (!isCustomer) merged[PRODUCT_DOC_GROUP] = productSubs.filter((s) => !isNavHidden(s.value))
    const extras = extraSubs[scopeKey] || {}
    for (const [g, names] of Object.entries(extras)) {
      const existing = merged[g] || []
      const added = names.filter((n) => !isNavHidden(n) && !existing.some((s) => s.value === n)).map((n) => ({ value: n, label: n }))
      if (added.length) merged[g] = [...existing, ...added]
    }
    return merged
  }, [baseSubMap, extraSubs, scopeKey, isCustomer, productSubs, hiddenNavValues])

  const grandSubMap = useMemo(() => {
    const merged: Record<string, { value: string; label: string }[]> = {}
    for (const [sub, gs] of Object.entries(DOC_GRANDSUB_MAP)) {
      merged[sub] = gs.filter((g) => !isNavHidden(g.value))
    }
    const extras = extraGrandSubs[scopeKey] || {}
    for (const [sub, names] of Object.entries(extras)) {
      const existing = merged[sub] || []
      const added = names.filter((n) => !isNavHidden(n) && !existing.some((s) => s.value === n)).map((n) => ({ value: n, label: n }))
      if (added.length) merged[sub] = [...existing, ...added]
    }
    return merged
  }, [extraGrandSubs, scopeKey, hiddenNavValues])

  // 大类按本地偏好排序；存档里没有的值保持在末尾，容错；已删除的大类过滤掉
  const orderedGroups = (() => {
    const visible = catGroups.filter((g) => !isNavHidden(g.value))
    const order = navGroupOrders[scopeKey]
    if (!order || order.length === 0) return visible
    return [...visible].sort((a, b) => {
      const ia = order.indexOf(a.value)
      const ib = order.indexOf(b.value)
      return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
    })
  })()

  // 分类导航翻页：每页条数随屏高自适应，窗口拉高多显示几个大类，底部不留白
  const navPageSize = useNavPageSize({ rowHeight: 32, min: 5 })
  const [navPage, setNavPage] = useState(1)
  const navTotalPages = Math.max(1, Math.ceil(orderedGroups.length / navPageSize))
  const pagedGroups = orderedGroups.slice((navPage - 1) * navPageSize, navPage * navPageSize)
  // 大类增删/每页条数变化时把页码收敛回合法区间
  useEffect(() => { setNavPage((p) => clampNavPage(p, navTotalPages)) }, [navTotalPages])

  const orderedSubs = (groupValue: string) => {
    const subs = subMap[groupValue] || []
    const order = navSubOrders[scopeKey]?.[groupValue]
    if (!order || order.length === 0) return subs
    return [...subs].sort((a, b) => {
      const ia = order.indexOf(a.value)
      const ib = order.indexOf(b.value)
      return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
    })
  }

  const orderedGrandSubs = (subValue: string) => {
    const grandSubs = grandSubMap[subValue] || []
    const order = navGrandSubOrders[scopeKey]?.[subValue]
    if (!order || order.length === 0) return grandSubs
    return [...grandSubs].sort((a, b) => {
      const ia = order.indexOf(a.value)
      const ib = order.indexOf(b.value)
      return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
    })
  }

  /** 大类上下移动：顺序是浏览偏好，按 scope 存 localStorage */
  const moveNavGroup = (value: string, direction: -1 | 1) => {
    const current = orderedGroups.map((g) => g.value)
    const idx = current.indexOf(value)
    const to = idx + direction
    if (idx === -1 || to < 0 || to >= current.length) return
    ;[current[idx], current[to]] = [current[to], current[idx]]
    const next = { ...navGroupOrders, [scopeKey]: current }
    setNavGroupOrders(next)
    saveNavOrders(NAV_GROUP_ORDER_KEY, next)
  }

  /** 子类上下移动：同理，顺序不影响分类存储值，无需后端级联 */
  const moveNavSub = (groupValue: string, subValue: string, direction: -1 | 1) => {
    const current = orderedSubs(groupValue).map((s) => s.value)
    const idx = current.indexOf(subValue)
    const to = idx + direction
    if (idx === -1 || to < 0 || to >= current.length) return
    ;[current[idx], current[to]] = [current[to], current[idx]]
    const scopeMap = { ...(navSubOrders[scopeKey] || {}), [groupValue]: current }
    const next = { ...navSubOrders, [scopeKey]: scopeMap }
    setNavSubOrders(next)
    saveNavOrders(NAV_SUB_ORDER_KEY, next)
  }

  /** 重命名大类/子类：存储值是固定枚举，只存展示标签覆盖，无需后端级联 */
  const handleNavRename = (value: string, fallback: string) => {
    const newName = renameNavValue.trim()
    setRenamingNav(null)
    if (!newName || newName === displayLabel(value, fallback)) return
    if (newName.includes('/')) {
      toast.error('名称不能包含 /')
      return
    }
    const allVals = [...catGroups.map((g) => g.value), ...catGroups.flatMap((g) => (subMap[g.value] || []).map((s) => s.value))]
    if (allVals.some((v) => v !== value && displayLabel(v) === newName)) {
      toast.warning('该名称已存在')
      return
    }
    const next = { ...labelOverrides, [value]: newName }
    setLabelOverrides(next)
    saveNavOrders(NAV_LABEL_OVERRIDES_KEY, next)
    toast.success(`已改名为「${newName}」`)
  }

  /** 导航新增子类：名字直接作存储值（上传时写入数据库），按 scope 存 localStorage */
  const handleAddNavSub = (groupValue: string) => {
    const name = newNavSubName.trim()
    setAddingSubFor(null)
    setNewNavSubName('')
    if (!name) return
    const allVals = [...catGroups.map((g) => g.value), ...catGroups.flatMap((g) => (subMap[g.value] || []).map((s) => s.value))]
    if (allVals.some((v) => v === name || displayLabel(v) === name)) {
      toast.warning('该子分类已存在')
      return
    }
    const scopeMap = { ...(extraSubs[scopeKey] || {}), [groupValue]: [...((extraSubs[scopeKey] || {})[groupValue] || []), name] }
    const next = { ...extraSubs, [scopeKey]: scopeMap }
    setExtraSubs(next)
    saveNavOrders(NAV_EXTRA_SUBS_KEY, next)
    // 若该名字之前被删过（在隐藏集里），加回时取消隐藏
    const cur = hiddenNavValues[scopeKey] || []
    if (cur.includes(name)) {
      const nh = { ...hiddenNavValues, [scopeKey]: cur.filter((v) => v !== name) }
      setHiddenNavValues(nh); saveNavOrders(NAV_HIDDEN_KEY, nh)
    }
    toast.success(`子分类「${name}」已添加`)
  }

  /** 孙子类上下移动 */
  const moveNavGrandSub = (subValue: string, grandSubValue: string, direction: -1 | 1) => {
    const current = orderedGrandSubs(subValue).map((s) => s.value)
    const idx = current.indexOf(grandSubValue)
    const to = idx + direction
    if (idx === -1 || to < 0 || to >= current.length) return
    ;[current[idx], current[to]] = [current[to], current[idx]]
    const scopeMap = { ...(navGrandSubOrders[scopeKey] || {}), [subValue]: current }
    const next = { ...navGrandSubOrders, [scopeKey]: scopeMap }
    setNavGrandSubOrders(next)
    saveNavOrders(NAV_GRANDSUB_ORDER_KEY, next)
  }

  /** 新增孙子类 */
  const handleAddNavGrandSub = (subValue: string) => {
    const name = newNavGrandSubName.trim()
    setAddingGrandSubFor(null)
    setNewNavGrandSubName('')
    if (!name) return
    const allGrandSubs = Object.values(grandSubMap).flat().map((g) => g.value)
    if (allGrandSubs.some((v) => v === name || displayLabel(v) === name)) {
      toast.warning('该孙分类已存在')
      return
    }
    const scopeMap = { ...(extraGrandSubs[scopeKey] || {}), [subValue]: [...(((extraGrandSubs[scopeKey] || {})[subValue] || [])), name] }
    const next = { ...extraGrandSubs, [scopeKey]: scopeMap }
    setExtraGrandSubs(next)
    saveNavOrders(NAV_EXTRA_GRANDSUBS_KEY, next)
    // 若该名字之前被删过（在隐藏集里），加回时取消隐藏
    const cur = hiddenNavValues[scopeKey] || []
    if (cur.includes(name)) {
      const nh = { ...hiddenNavValues, [scopeKey]: cur.filter((v) => v !== name) }
      setHiddenNavValues(nh); saveNavOrders(NAV_HIDDEN_KEY, nh)
    }
    toast.success(`孙分类「${name}」已添加`)
  }

  /** 重命名孙子类 */
  const handleNavGrandSubRename = (grandSubValue: string, fallback: string) => {
    const newName = renameNavValue.trim()
    setRenamingNav(null)
    if (!newName || newName === displayLabel(grandSubValue, fallback)) return
    if (newName.includes('/')) { toast.error('名称不能包含 /'); return }
    const allVals = Object.values(grandSubMap).flat().map((g) => g.value)
    if (allVals.some((v) => v !== grandSubValue && displayLabel(v) === newName)) {
      toast.warning('该名称已存在'); return
    }
    const next = { ...labelOverrides, [grandSubValue]: newName }
    setLabelOverrides(next)
    saveNavOrders(NAV_LABEL_OVERRIDES_KEY, next)
    toast.success(`已改名为「${newName}」`)
  }

  /** 级联清理工具函数：删除节点时清理相关 localStorage 数据 */
  const cleanupDescendants = (level: 'group' | 'sub' | 'grandsub', value: string, parentValue?: string) => {
    const newLabels = { ...labelOverrides }
    const newExtraSubs = { ...extraSubs }
    const newExtraGrandSubs = { ...extraGrandSubs }
    const newGroupOrders = { ...navGroupOrders }
    const newSubOrders = { ...navSubOrders }
    const newGrandSubOrders = { ...navGrandSubOrders }

    // 计算要隐藏的值（含子孙）。静态内置项不在 extra 里、删不掉，靠隐藏集过滤。
    const valuesToHide = (() => {
      if (level === 'grandsub') return [value]
      if (level === 'sub') return [value, ...(grandSubMap[value] || []).map((g) => g.value)]
      // group
      const subs = subMap[value] || []
      return [value, ...subs.flatMap((s) => [s.value, ...(grandSubMap[s.value] || []).map((g) => g.value)])]
    })()

    if (level === 'grandsub') {
      delete newLabels[value]
      // 从 extraGrandSubs 中移除
      if (parentValue && newExtraGrandSubs[scopeKey]?.[parentValue]) {
        const scope = { ...newExtraGrandSubs[scopeKey] }
        scope[parentValue] = scope[parentValue].filter((n) => n !== value)
        newExtraGrandSubs[scopeKey] = scope
      }
      // 从 grandSubOrders 中移除
      if (parentValue && newGrandSubOrders[scopeKey]?.[parentValue]) {
        const scope = { ...newGrandSubOrders[scopeKey] }
        scope[parentValue] = scope[parentValue].filter((v) => v !== value)
        newGrandSubOrders[scopeKey] = scope
      }
    } else if (level === 'sub') {
      // 清理该子类及其孙子类
      const subs = subMap[value] || []
      subs.forEach((s) => {
        const gs = grandSubMap[s.value] || []
        gs.forEach((g) => { delete newLabels[g.value] })
        delete newExtraGrandSubs[scopeKey]?.[s.value]
        delete newGrandSubOrders[scopeKey]?.[s.value]
      })
      delete newLabels[value]
      // 从 extraSubs 中移除
      if (parentValue && newExtraSubs[scopeKey]?.[parentValue]) {
        const scope = { ...newExtraSubs[scopeKey] }
        scope[parentValue] = scope[parentValue].filter((n) => n !== value)
        newExtraSubs[scopeKey] = scope
      }
      delete newExtraGrandSubs[scopeKey]?.[value]
      delete newGrandSubOrders[scopeKey]?.[value]
      // 从 subOrders 中移除
      if (parentValue && newSubOrders[scopeKey]?.[parentValue]) {
        const scope = { ...newSubOrders[scopeKey] }
        scope[parentValue] = scope[parentValue].filter((v) => v !== value)
        newSubOrders[scopeKey] = scope
      }
    } else if (level === 'group') {
      // 清理该大类及其所有子类和孙子类
      const subs = subMap[value] || []
      subs.forEach((s) => {
        const gs = grandSubMap[s.value] || []
        gs.forEach((g) => { delete newLabels[g.value] })
        delete newExtraGrandSubs[scopeKey]?.[s.value]
        delete newGrandSubOrders[scopeKey]?.[s.value]
        delete newLabels[s.value]
      })
      delete newLabels[value]
      delete newExtraSubs[scopeKey]?.[value]
      delete newSubOrders[scopeKey]?.[value]
      delete newExtraGrandSubs[scopeKey]?.[value]
      delete newGrandSubOrders[scopeKey]?.[value]
      // 从 groupOrders 中移除
      if (newGroupOrders[scopeKey]) {
        newGroupOrders[scopeKey] = newGroupOrders[scopeKey].filter((v) => v !== value)
      }
    }

    setLabelOverrides(newLabels); saveNavOrders(NAV_LABEL_OVERRIDES_KEY, newLabels)
    setExtraSubs(newExtraSubs); saveNavOrders(NAV_EXTRA_SUBS_KEY, newExtraSubs)
    setExtraGrandSubs(newExtraGrandSubs); saveNavOrders(NAV_EXTRA_GRANDSUBS_KEY, newExtraGrandSubs)
    setNavGroupOrders(newGroupOrders); saveNavOrders(NAV_GROUP_ORDER_KEY, newGroupOrders)
    setNavSubOrders(newSubOrders); saveNavOrders(NAV_SUB_ORDER_KEY, newSubOrders)
    setNavGrandSubOrders(newGrandSubOrders); saveNavOrders(NAV_GRANDSUB_ORDER_KEY, newGrandSubOrders)

    // 加入隐藏集（静态项靠它从导航消失）
    const curHidden = hiddenNavValues[scopeKey] || []
    const mergedHidden = Array.from(new Set([...curHidden, ...valuesToHide]))
    const newHidden = { ...hiddenNavValues, [scopeKey]: mergedHidden }
    setHiddenNavValues(newHidden); saveNavOrders(NAV_HIDDEN_KEY, newHidden)
  }

  /** 删除孙子类 */
  const handleDeleteNavGrandSub = (grandSubValue: string, parentSubValue?: string) => {
    const label = displayLabel(grandSubValue)
    cleanupDescendants('grandsub', grandSubValue, parentSubValue)
    if (activeGrandSub === grandSubValue) setActiveGrandSub(null)
    toast.success(`孙子类「${label}」已删除`)
  }

  /** 删除子类（级联清理） */
  const handleDeleteNavSub = (groupValue: string, subValue: string) => {
    const label = displayLabel(subValue)
    cleanupDescendants('sub', subValue, groupValue)
    if (activeSub === subValue) { setActiveSub(null); setActiveGrandSub(null) }
    toast.success(`子类「${label}」及其孙子类已删除`)
  }

  /** 删除大类（级联清理） */
  const handleDeleteNavGroup = (groupValue: string) => {
    const label = displayLabel(groupValue, catGroups.find(g => g.value === groupValue)?.label)
    cleanupDescendants('group', groupValue)
    if (activeCat === groupValue) { setActiveCat(null); setActiveSub(null); setActiveGrandSub(null) }
    toast.success(`大类「${label}」及其所有子分类已删除`)
  }

  const { values: form, errors, isValid, setValue, validateAll, reset } = useFormValidation({
    initialValues: { title: '', category: fixedScope === 'customer' ? 'customer_background' : 'company_profile', visibility: 'public' as string },
    rules: { title: required('请输入标题') },
  })

  // 从全局搜索跳转过来时高亮目标资料
  const highlightId = searchParams.get('highlight')

  const params = useMemo(() => {
    const fileTypes = (filters.fileType as string[]) || []
    const range = (filters.date as { from?: string; to?: string }) || {}
    // 左侧导航：选中孙子类 → 只筛该孙子类；选中子类 → 子类值 + 其全部孙子类值；选中大类 → 大类值 + 其全部子类 + 孙子类
    const navCats = activeGrandSub
      ? [activeGrandSub]
      : activeSub
        ? [activeSub, ...(grandSubMap[activeSub] || []).map((g) => g.value)]
        : activeCat
          ? [activeCat, ...(subMap[activeCat] || []).flatMap((s) => [s.value, ...(grandSubMap[s.value] || []).map((g) => g.value)])]
          : []
    return {
      keyword: debouncedSearch || undefined,
      category: navCats.length ? navCats.join(',') : undefined,
      fileType: fileTypes.length ? fileTypes.join(',') : undefined,
      customerId: (filters.customerId as string) || undefined,
      uploaderId: (filters.uploaderId as string) || undefined,
      status: (filters.status as string) || undefined,
      // 带 ?highlight= 精确定位某份资料时不套 scope 过滤，
      // 否则从全局搜索/AI问答点进来的客户绑定文档会被 business 视图挡掉、显示不出来
      scope: highlightId ? undefined : ((filters.scope as string) || undefined),
      dateFrom: range.from,
      dateTo: range.to,
    }
  }, [debouncedSearch, filters, highlightId, activeCat, activeSub, activeGrandSub, subMap, grandSubMap])

  const {
    list: listData,
    pagination,
    isLoading,
    isError,
    error,
    refetch,
  } = usePagedQuery<Document>({
    key: ['documents'],
    filters: params,
    fetcher: (p) => documentApi.list(p) as any,
    initialPageSize: 15,
  })

  useRegisterPageAssistant({
    key: 'documents',
    label: '业务资料',
    sourceTypes: ['document', 'knowledge'],
    questions: [
      '本页资料按分类是怎么分布的？',
      '这些资料里哪些和产品选型有关？',
      '当前筛选下有哪些资料还没审批通过？',
      '挑一份资料，说明它讲了什么',
      '本页资料里缺少哪类内容？',
    ],
    context: [
      `页面：业务资料（共 ${pagination?.total ?? listData.length} 份，当前第 ${pagination?.page ?? 1} 页）`,
      activeCat ? `当前分类：${displayLabel(activeCat)}${activeSub ? ` / ${displayLabel(activeSub)}` : ''}` : '',
      search ? `搜索关键词：${search}` : '',
      '当前页资料清单：',
      ...listData
        .slice(0, 40)
        .map(
          (x: Document, i: number) =>
            `${i + 1}. ${x.title || x.fileName}｜分类 ${resolvedCatLabel(x.category)}｜状态 ${x.status || '—'}`,
        ),
    ]
      .filter(Boolean)
      .join('\n'),
  })

  const customersQuery = useQuery({
    queryKey: ['customers', 'options'],
    queryFn: () => customerApi.list(),
    staleTime: 5 * 60_000,
  })

  const detailQuery = useQuery({
    queryKey: ['document', selected?.id],
    queryFn: () => (selected?.id ? documentApi.get(selected.id) : null),
    enabled: !!selected?.id,
  })

  const detailLinksQuery = useQuery({
    queryKey: ['document-links', selected?.id],
    queryFn: () => (selected?.id ? documentApi.links(selected.id) : []),
    enabled: !!selected?.id,
  })

  const chainQuery = useQuery({
    queryKey: ['document-chain', chainCustomerId],
    queryFn: () => (chainCustomerId ? documentApi.chain(chainCustomerId) : []),
    enabled: !!chainCustomerId,
  })

  const customers = Array.isArray(customersQuery.data)
    ? customersQuery.data
    : (customersQuery.data as any)?.list || []

  const filterGroups: FilterGroupDef[] = [
    { key: 'status', label: '内容状态', columns: 2, type: 'radio', options: statusOptions },
    { key: 'fileType', label: '文件格式', columns: 2, type: 'checkbox', options: FILE_TYPE_OPTIONS },
  ]

  const activeCount = Object.values(filters).filter((v) =>
    Array.isArray(v) ? v.length > 0 : v && (typeof v === 'string' || (v as any).from || (v as any).to),
  ).length

  /** 同名文件检查：listData 中已有同名文件名时提示 */
  const checkDuplicateName = (fileName: string): boolean => {
    return listData.some((d: any) => d.fileName === fileName || d.title === fileName)
  }

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', form.title || file.name)
      fd.append('category', form.category)
      fd.append('visibility', form.visibility)
      return documentApi.upload(fd)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['document-category-counts'] })
      setModalOpen(false)
      setDroppedFile(null)
      reset()
      if (fileRef.current) fileRef.current.value = ''
      toast.success('上传成功')
    },
    onError: handleError,
  })

  const updateDocMutation = useMutation({
    mutationFn: () => documentApi.update(editDoc!.id, editForm),
    onSuccess: () => {
      toast.success('已保存')
      setEditDoc(null)
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['document-category-counts'] })
      refetch()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '保存失败'),
  })

  // 移动分类
  const [moveTarget, setMoveTarget] = useState<Document | null>(null)
  const [moveCategory, setMoveCategory] = useState('')
  const [moveSearch, setMoveSearch] = useState('')

  // 批量选择
  const [docSelectedKeys, setDocSelectedKeys] = useState<string[]>([])
  const [batchMoveOpen, setBatchMoveOpen] = useState(false)
  const [batchDeleteIds, setBatchDeleteIds] = useState<string[]>([])

  const batchMoveMutation = useMutation({
    mutationFn: async () => {
      for (const id of docSelectedKeys) {
        await documentApi.update(id, { category: moveCategory })
      }
    },
    onSuccess: () => {
      toast.success(`已批量移动 ${docSelectedKeys.length} 个文件`)
      setBatchMoveOpen(false)
      setDocSelectedKeys([])
      setMoveCategory('')
      setMoveSearch('')
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['document-category-counts'] })
      refetch()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '批量移动失败'),
  })

  const batchDeleteMutation = useMutation({
    mutationFn: async () => {
      for (const id of batchDeleteIds) {
        await documentApi.remove(id)
      }
    },
    onSuccess: () => {
      toast.success(`已删除 ${batchDeleteIds.length} 个文件`)
      setDocSelectedKeys(docSelectedKeys.filter(k => !batchDeleteIds.includes(k)))
      setBatchDeleteIds([])
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['document-category-counts'] })
      refetch()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '批量删除失败'),
  })
  const moveMutation = useMutation({
    mutationFn: () => documentApi.update(moveTarget!.id, { category: moveCategory }),
    onSuccess: () => {
      toast.success('已移动到新分类')
      setMoveTarget(null)
      setMoveCategory('')
      setMoveSearch('')
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['document-category-counts'] })
      refetch()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '移动失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['document-category-counts'] })
      setDeleteId(null)
      toast.success('已删除')
    },
    onError: handleError,
  })

  // 只在抽屉打开时才拉回收站列表，避免每次进页面都多一次请求
  const recycleQuery = useQuery({
    queryKey: ['documents-recycled'],
    queryFn: () => documentApi.recycled(),
    enabled: recycleOpen,
  })

  const restoreMutation = useMutation({
    mutationFn: (recycleId: string) => documentApi.restoreRecycled(recycleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents-recycled'] })
      queryClient.invalidateQueries({ queryKey: ['document-category-counts'] })
      refetch()
      toast.success('已还原，正在重建索引')
    },
    onError: handleError,
  })

  const purgeMutation = useMutation({
    mutationFn: (recycleId: string) => documentApi.purgeRecycled(recycleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents-recycled'] })
      setPurgeId(null)
      toast.success('已彻底删除')
    },
    onError: handleError,
  })

  const unlinkMutation = useMutation({
    mutationFn: (linkId: string) => documentApi.removeLink(linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-links'] })
      setUnlinkingId(null)
      toast.success('已解除关联')
    },
    onError: handleError,
  })

  const handleDownload = async (item?: Document) => {
    if (!item) return
    try {
      await downloadFile('documents', item.id, item.fileName)
    } catch (err: any) {
      toast.error(err?.message || '下载失败')
    }
  }

  /**
   * 批量上传。
   *
   * 关键是**限并发**：原来是 for 循环里不 await 直接发，二十张照片就是
   * 二十个请求同时打出去，再叠加每次成功后的两次 invalidate ——
   * 瞬间六十次请求，撞上后端 50 次/10 秒的限流（提示「操作过于频繁」），
   * 同时并发写 SQLite 还会撞出 500。
   *
   * 现在同时最多传 2 个，进度实时更新，列表只在**全部结束后**刷新一次。
   */
  const uploadBatch = async (
    files: File[],
    build: (f: File) => FormData,
  ) => {
    const total = files.length
    const toastId = toast.loading(`正在上传 0 / ${total}…`)
    const { succeeded, failed } = await runWithConcurrency(
      files,
      (f) => documentApi.upload(build(f)),
      {
        concurrency: 2,
        onProgress: (done) => toast.loading(`正在上传 ${done} / ${total}…`, { id: toastId }),
      },
    )

    /*
     * 刷新只做一次：每传一个就 invalidate 会把请求数直接翻三倍。
     *
     * invalidate 之外还要显式 refetch —— 只 invalidate 的话新上传的文件
     * 不会立刻出现在列表里，得手动刷浏览器（本页其它写操作如"移动分类"
     * 早就是这么写的，这里保持一致）。
     */
    queryClient.invalidateQueries({ queryKey: ['documents'] })
    queryClient.invalidateQueries({ queryKey: ['document-category-counts'] })
    await refetch()

    if (!failed.length) {
      toast.success(`已上传 ${succeeded.length} 个文件`, { id: toastId })
      return
    }
    const detail = failed
      .slice(0, 3)
      .map((f) => `${(f.item as File).name}：${uploadErrorMessage(f.error)}`)
      .join('\n')
    toast.error(
      `${succeeded.length} 个成功，${failed.length} 个失败\n${detail}` +
        (failed.length > 3 ? `\n…另有 ${failed.length - 3} 个` : ''),
      { id: toastId, duration: 8000 },
    )
  }

  const handleFilesDropped = (files: File[]) => {
    if (!files.length) return
    // 同名检查：过滤掉已有同名文件，提示用户
    const accepted: File[] = []
    const rejected: string[] = []
    for (const f of files) {
      if (!checkFileSize(f)) { rejected.push(`${f.name}（超过大小限制）`); continue }
      if (checkDuplicateName(f.name)) { rejected.push(`${f.name}（已有同名文件，如需更新请先删除旧文件）`); continue }
      accepted.push(f)
    }
    if (rejected.length) {
      toast.warning(`已跳过 ${rejected.length} 个文件：\n${rejected.join('\n')}`)
    }
    if (!accepted.length) return

    // 选中子类/孙子类时拖拽直传该分类
    const target = activeGrandSub || activeSub
    if (target) {
      uploadBatch(accepted, (f) => {
        const fd = new FormData()
        fd.append('file', f)
        fd.append('title', f.name)
        fd.append('category', target)
        fd.append('visibility', 'public')
        return fd
      })
      return
    }
    // 没选子类：多文件直接默认上传，单文件弹窗填写信息
    if (accepted.length === 1) {
      setDroppedFile(accepted[0])
      reset()
      setModalOpen(true)
    } else {
      uploadBatch(accepted, (f) => {
        const fd = new FormData()
        fd.append('file', f)
        fd.append('title', f.name)
        fd.append('category', form.category || 'other')
        fd.append('visibility', 'public')
        return fd
      })
    }
  }

  /** 上传前大小预校验：超限时中文提示，避免撞后端原始 Validation 报错 */
  const checkFileSize = (file?: File | null) => {
    if (file && file.size > MAX_DOC_FILE_SIZE) {
      toast.error(`「${file.name}」超过 ${MAX_DOC_FILE_SIZE / 1024 / 1024}MB 上限，请压缩后再传`)
      return false
    }
    return true
  }

  /** 直传到子类/孙子类：文件名作标题、默认公开（选中子类后的顶栏按钮与拖拽走这里，免弹窗） */
  const directUploadToSub = (file: File, sub: string) => {
    if (!file) return
    if (!checkFileSize(file)) return
    const label = displayLabel(sub, catGroups.flatMap((g) => subMap[g.value] || []).find((s) => s.value === sub)?.label)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('title', file.name)
    fd.append('category', sub)
    fd.append('visibility', 'public')
    toast.info(`正在上传到「${label}」…`)
    documentApi.upload(fd)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['documents'] })
        queryClient.invalidateQueries({ queryKey: ['document-category-counts'] })
        // 同 uploadBatch：只 invalidate 不 refetch 的话，新文件要刷浏览器才出现
        refetch()
        toast.success(`已上传到「${label}」`)
      })
      .catch(handleError)
  }

  const directFileRef = useRef<HTMLInputElement>(null)
  const handleDirectUploadPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || [])
    e.target.value = ''
    if (!fileList.length) return
    const target = activeGrandSub || activeSub
    if (!target) return

    const accepted = fileList.filter((f) => checkFileSize(f))
    if (!accepted.length) return

    // 单个仍走原来的单文件路径（提示语带分类名，信息更具体）
    if (accepted.length === 1) {
      directUploadToSub(accepted[0], target)
      return
    }
    // 多个走限并发批量：原来是 for 循环里逐个 fire-and-forget，
    // 一次选十几张就同时打十几个请求，撞限流也撞 SQLite 并发写
    uploadBatch(accepted, (f) => {
      const fd = new FormData()
      fd.append('file', f)
      fd.append('title', f.name)
      fd.append('category', target)
      fd.append('visibility', 'public')
      return fd
    })
  }

  const activeSubLabel = activeGrandSub
    ? displayLabel(activeGrandSub, catGroups.flatMap((g) => subMap[g.value] || []).flatMap((s) => grandSubMap[s.value] || []).find((gs) => gs.value === activeGrandSub)?.label)
    : activeSub
      ? displayLabel(activeSub, catGroups.flatMap((g) => subMap[g.value] || []).find((s) => s.value === activeSub)?.label)
      : null

  /** 弹窗里的资料类型下拉：大类 + 缩进子类 + 孙子类平铺，三者都可选作存储值 */
  const groupedCatOptions = catGroups.flatMap((g) => [
    { value: g.value, label: displayLabel(g.value, g.label) },
    ...(subMap[g.value] || []).flatMap((s) => [
      { value: s.value, label: `├ ${displayLabel(s.value, s.label)}` },
      ...(grandSubMap[s.value] || []).map((gs) => ({ value: gs.value, label: `│ ├ ${displayLabel(gs.value, gs.label)}` })),
    ]),
  ])

  const setPageActions = usePageActions()
  // 左侧导航可拖拽调宽（宽度存本地，右侧随 flex 伸缩）
  const navPanel = useResizablePanel('aikb-nav-width-documents', 240)
  useEffect(() => {
    setPageActions(
      <>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            placeholder="搜索资料…"
            onChange={(e) => setSearch(e.target.value)}
            className="eo-input !w-60 !pl-8 !py-1 !text-sm"
          />
        </div>
        {docSelectedKeys.length > 0 ? (
          <>
            <span className="text-xs font-medium text-accent-600 whitespace-nowrap">已选{docSelectedKeys.length}个</span>
            {/* 琥珀=移动、红=删除，实心配色与顶栏其它控件一眼区分 */}
            <button
              onClick={() => { setBatchMoveOpen(true); setMoveCategory(''); setMoveSearch('') }}
              className="flex items-center gap-1 rounded-md bg-warning-fg text-white text-xs font-medium px-2 py-1 hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <FolderInput size={13} /> 批量移动
            </button>
            <button
              onClick={() => { setBatchDeleteIds([...docSelectedKeys]) }}
              className="flex items-center gap-1 rounded-md bg-danger-fg text-white text-xs font-medium px-2 py-1 hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <Trash2 size={13} /> 批量删除
            </button>
            <button onClick={() => setDocSelectedKeys([])} className="text-xs text-muted hover:text-ink">取消</button>
          </>
        ) : (
          <>
            {/*
              「全部」从左侧导航顶部挪到顶栏。
              放在导航里要占掉一整行，而左侧本来就装不下（分类树一屏放不完）；
              放顶栏则始终可见、不吃导航高度，且只在真的处于筛选态时才出现。
            */}
            {(activeCat || activeSub || activeGrandSub) && (
              <button
                onClick={() => { setActiveCat(null); setActiveSub(null); setActiveGrandSub(null) }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-sm text-ink-soft border border-border hover:border-accent-300 hover:text-accent-600 transition-colors"
                title="清除分类筛选，查看全部资料"
              >
                <X size={13} /> 全部
              </button>
            )}
            <button
              onClick={() => setRecycleOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-sm text-ink-soft border border-border hover:border-accent-300 hover:text-accent-600 transition-colors"
              title="查看最近删除的资料（保留 30 天，可还原）"
            >
              <Trash2 size={13} /> 回收站
            </button>
            {activeSub || activeGrandSub ? (
              <Button size="sm" className="!py-1 !text-sm" onClick={() => directFileRef.current?.click()}>
                <Upload size={13} className="mr-0.5" /> 上传至「{activeSubLabel}」
              </Button>
            ) : (
              <Button size="sm" className="!py-1 !text-sm" onClick={() => { reset(); setModalOpen(true) }}>
                <Upload size={13} className="mr-0.5" /> 上传
              </Button>
            )}
            <input ref={directFileRef} type="file" multiple className="hidden" onChange={handleDirectUploadPick} />
          </>
        )}
      </>,
    )
    return () => setPageActions(null)
    // activeCat 也要进依赖：顶栏的「全部」按钮只在筛选态出现，
    // 只选了大类（没选子类）时它同样该显示出来
  }, [activeCat, activeSub, activeGrandSub, activeSubLabel, docSelectedKeys])

  // 这个页面同时承担业务资料与客户资料两种 scope，卡片口径也要跟着分
  const { stats, isLoading: statsLoading } = useModuleStats()
  const docCards =
    fixedScope === 'customer'
      ? [
          { label: '资料总数', value: stats?.documents.customer.total ?? 0, icon: Files },
          { label: '涉及客户', value: stats?.documents.customer.customers ?? 0, icon: Building2 },
          {
            label: '占用空间',
            value: formatSize(stats?.documents.customer.totalSize ?? 0),
            icon: HardDrive,
          },
          { label: '本月新增', value: stats?.documents.customer.newThisMonth ?? 0, icon: Upload },
        ]
      : [
          { label: '资料总数', value: stats?.documents.business.total ?? 0, icon: Files },
          { label: '可用', value: stats?.documents.business.approved ?? 0, icon: CheckCircle2 },
          { label: '待整理', value: stats?.documents.business.pending ?? 0, icon: Clock },
          {
            label: '占用空间',
            value: formatSize(stats?.documents.business.totalSize ?? 0),
            icon: HardDrive,
          },
          { label: '本月新增', value: stats?.documents.business.newThisMonth ?? 0, icon: Upload },
        ]

  return (
    <FileDropZone
      accept={['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.md', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.dwg', '.dxf']}
      onFilesDropped={handleFilesDropped}
    >
    <div>
      <PageHeader
        title={fixedScope === 'customer' ? '客户' : '业务'}
        titleEm="资料"
      />

      {/* 统计卡片：与业务概览顶部同一套组件 */}
      <StatCards className="mb-4" loading={statsLoading} skeletonCount={5} items={docCards} />

      <div className="flex flex-col lg:flex-row gap-4">
        {/* 左侧：分类导航 + 筛选面板 */}
        <div className="lg:w-60 flex-shrink-0 space-y-3" style={navPanel.panelStyle}>
          {/* 分类导航：大类展开子类；选中子类 = 筛选 + 直传目标（同知识资料页） */}
          <div className="eo-card p-3">
            {/*
              这里原有一行「全部 N」。去掉之后清除筛选靠"再点一次已选中的分类"，
              见下面各级按钮的 onClick —— 选中态再点即取消，回到未筛选。
            */}
            <div className="space-y-0.5">
              {pagedGroups.map((g, i) => {
                const gIdx = (navPage - 1) * navPageSize + i
                const subs = orderedSubs(g.value)
                const expanded = !collapsedCats.includes(g.value)
                return (
                  <div key={g.value}>
                    <div className="group/tab flex items-center">
                      {/*
                        展开/收起子类：放在最左边，与客户资料页的公司树对齐 ——
                        小三角是"这一行有下级"的层级标记，跟在名称后面看着像操作按钮。
                        也可双击大类名称切换。
                      */}
                      <button
                        onClick={() => toggleCat(g.value)}
                        className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-accent-600 shrink-0"
                        title={expanded ? '收起子类' : '展开子类'}
                      >
                        <ChevronRight size={11} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
                      </button>
                      {renamingNav === g.value ? (
                        // 改名中：内联输入框，Enter 保存，Esc/失焦取消
                        <input
                          autoFocus
                          value={renameNavValue}
                          onChange={(e) => setRenameNavValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleNavRename(g.value, g.label)
                            if (e.key === 'Escape') setRenamingNav(null)
                          }}
                          onBlur={() => setRenamingNav(null)}
                          className="flex-1 min-w-0 px-2 py-1 text-xs border border-accent-300 rounded-md bg-surface outline-none focus:border-accent-500"
                        />
                      ) : (
                        <button
                          // 再点一次已选中的大类 = 取消筛选（顶替原来的「全部」入口）
                          onClick={() => {
                            const isActive = activeCat === g.value && !activeSub && !activeGrandSub
                            setActiveCat(isActive ? null : g.value)
                            setActiveSub(null)
                            setActiveGrandSub(null)
                          }}
                          onDoubleClick={() => toggleCat(g.value)}
                          className={`flex-1 min-w-0 flex items-center justify-between gap-1 px-2.5 py-1.5 rounded-md text-body-sm transition-colors ${
                            activeCat === g.value && !activeSub ? 'bg-accent-50 text-accent-700 font-medium' : 'text-ink-soft hover:bg-canvas'
                          }`}
                        >
                          <span className="truncate text-left">{displayLabel(g.value, g.label)}</span>
                          <span className="text-caption text-muted shrink-0">{groupCount(g.value)}</span>
                        </button>
                      )}
                      {/* 重命名（只改展示标签，存储值不变） */}
                      {renamingNav !== g.value && (
                        <button
                          onClick={() => { setRenamingNav(g.value); setRenameNavValue(displayLabel(g.value, g.label)) }}
                          className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/tab:opacity-100 transition-opacity shrink-0"
                          title={`重命名「${displayLabel(g.value, g.label)}」`}
                        >
                          <Pencil size={10} />
                        </button>
                      )}
                      {/* 新增子类 */}
                      <button
                        onClick={() => {
                          setAddingSubFor(g.value)
                          setNewNavSubName('')
                          if (!expanded) setCollapsedCats((prev) => prev.filter((v) => v !== g.value))
                        }}
                        className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/tab:opacity-100 transition-opacity shrink-0"
                        title={`在「${displayLabel(g.value, g.label)}」下新增子类`}
                      >
                        <Plus size={11} />
                      </button>
                      {/* 上下移动（顺序是浏览偏好，按 scope 存 localStorage） */}
                      <button
                        onClick={() => moveNavGroup(g.value, -1)}
                        disabled={gIdx === 0}
                        className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/tab:opacity-100 transition-opacity shrink-0 disabled:invisible"
                        title="大类上移"
                      >
                        <ChevronUp size={11} />
                      </button>
                      <button
                        onClick={() => moveNavGroup(g.value, 1)}
                        disabled={gIdx === orderedGroups.length - 1}
                        className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/tab:opacity-100 transition-opacity shrink-0 disabled:invisible"
                        title="大类下移"
                      >
                        <ChevronDown size={11} />
                      </button>
                      {/* 删除大类 */}
                      {!isCustomer && g.value !== PRODUCT_DOC_GROUP && (
                        <button
                          onClick={() => setDeletingNav({ level: 1, value: g.value })}
                          className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-red-500 opacity-0 group-hover/tab:opacity-100 transition-opacity shrink-0"
                          title="删除大类"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                    {/* 子类：点击 = 筛选列表 + 设为顶栏直传目标 */}
                    {expanded && (
                      <div className="ml-2.5 pl-2 border-l border-border space-y-0.5 py-0.5">
                        {subs.map((s, sIdx) => (
                          <div key={s.value}>
                          <div className="group/sub flex items-center">
                            {renamingNav === s.value ? (
                              <input
                                autoFocus
                                value={renameNavValue}
                                onChange={(e) => setRenameNavValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleNavRename(s.value, s.label)
                                  if (e.key === 'Escape') setRenamingNav(null)
                                }}
                                onBlur={() => setRenamingNav(null)}
                                className="flex-1 min-w-0 px-2 py-0.5 text-caption border border-accent-300 rounded-md bg-surface outline-none focus:border-accent-500"
                              />
                            ) : (
                              <button
                                onClick={() => { setActiveCat(g.value); setActiveSub(s.value); setActiveGrandSub(null) }}
                                className={`flex-1 min-w-0 flex items-center justify-between gap-1 px-2 py-1 rounded-md text-caption transition-colors ${
                                  activeSub === s.value && !activeGrandSub ? 'bg-accent-50 text-accent-700 font-medium' : 'text-ink-soft hover:bg-canvas'
                                }`}
                                title={activeSub === s.value ? `已选中：顶栏上传将直接传到「${displayLabel(s.value, s.label)}」` : '点击筛选该子类，并设为直接上传目标'}
                              >
                                <span className="truncate text-left">{displayLabel(s.value, s.label)}</span>
                                <span className="text-[10px] text-muted shrink-0">{subCount(s.value)}</span>
                              </button>
                            )}
                            {/* 重命名（只改展示标签，存储值不变） */}
                            {renamingNav !== s.value && (
                              <button
                                onClick={() => { setRenamingNav(s.value); setRenameNavValue(displayLabel(s.value, s.label)) }}
                                className="w-4 h-4 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/sub:opacity-100 transition-opacity shrink-0"
                                title={`重命名「${displayLabel(s.value, s.label)}」`}
                              >
                                <Pencil size={9} />
                              </button>
                            )}
                            <button
                              onClick={() => moveNavSub(g.value, s.value, -1)}
                              disabled={sIdx === 0}
                              className="w-4 h-4 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/sub:opacity-100 transition-opacity shrink-0 disabled:invisible"
                              title="上移"
                            >
                              <ChevronUp size={9} />
                            </button>
                            <button
                              onClick={() => moveNavSub(g.value, s.value, 1)}
                              disabled={sIdx === subs.length - 1}
                              className="w-4 h-4 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/sub:opacity-100 transition-opacity shrink-0 disabled:invisible"
                              title="下移"
                            >
                              <ChevronDown size={9} />
                            </button>
                            {/* 新增孙子类 */}
                            {!isCustomer && (
                              <button
                                onClick={() => { setAddingGrandSubFor(s.value); setNewNavGrandSubName(''); if (collapsedSubs.includes(s.value)) toggleSub(s.value) }}
                                className="w-4 h-4 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/sub:opacity-100 transition-opacity shrink-0"
                                title={`在「${displayLabel(s.value, s.label)}」下新增孙子类`}
                              >
                                <Plus size={9} />
                              </button>
                            )}
                            {/* 展开/收起孙子类：有孙子类或正在新增时也显示，确保新增后能收起 */}
                            {!isCustomer && (orderedGrandSubs(s.value).length > 0 || addingGrandSubFor === s.value) && (
                              <button
                                onClick={() => toggleSub(s.value)}
                                className="w-4 h-4 flex items-center justify-center rounded text-muted hover:text-accent-600 shrink-0"
                                title={collapsedSubs.includes(s.value) ? '展开孙子类' : '收起孙子类'}
                              >
                                <ChevronRight size={9} className={`transition-transform ${!collapsedSubs.includes(s.value) ? 'rotate-90' : ''}`} />
                              </button>
                            )}
                            {/* 删除子类 */}
                            {!isCustomer && (
                              <button
                                onClick={() => setDeletingNav({ level: 2, value: s.value, parentValue: g.value })}
                                className="w-4 h-4 flex items-center justify-center rounded text-muted hover:text-red-500 opacity-0 group-hover/sub:opacity-100 transition-opacity shrink-0"
                                title="删除子类"
                              >
                                <Trash2 size={9} />
                              </button>
                            )}
                          </div>
                          {/* 孙子类（第三级）：子类展开时显示；正在新增孙子类时也展开 */}
                          {!isCustomer && !collapsedSubs.includes(s.value) && (orderedGrandSubs(s.value).length > 0 || addingGrandSubFor === s.value) && (
                            <div className="ml-2 pl-1.5 border-l border-border space-y-0.5 py-0.5">
                              {orderedGrandSubs(s.value).map((gs, gsIdx) => (
                                <div key={gs.value} className="group/gs flex items-center">
                                  {renamingNav === gs.value ? (
                                    <input
                                      autoFocus
                                      value={renameNavValue}
                                      onChange={(e) => setRenameNavValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleNavGrandSubRename(gs.value, gs.label)
                                        if (e.key === 'Escape') setRenamingNav(null)
                                      }}
                                      onBlur={() => setRenamingNav(null)}
                                      className="flex-1 min-w-0 px-2 py-0.5 text-[11px] border border-accent-300 rounded-md bg-surface outline-none focus:border-accent-500"
                                    />
                                  ) : (
                                    <button
                                      onClick={() => { setActiveCat(g.value); setActiveSub(s.value); setActiveGrandSub(gs.value) }}
                                      className={`flex-1 min-w-0 flex items-center justify-between gap-1 px-2 py-0.5 rounded-md text-[11px] transition-colors ${
                                        activeGrandSub === gs.value ? 'bg-accent-50 text-accent-700 font-medium' : 'text-ink-soft hover:bg-canvas'
                                      }`}
                                      title={activeGrandSub === gs.value ? `已选中：顶栏上传将直接传到「${displayLabel(gs.value, gs.label)}」` : '点击筛选'}
                                    >
                                      <span className="truncate text-left">{displayLabel(gs.value, gs.label)}</span>
                                      <span className="text-[10px] text-muted shrink-0">{subCount(gs.value)}</span>
                                    </button>
                                  )}
                                  {/* 重命名 */}
                                  {renamingNav !== gs.value && (
                                    <button
                                      onClick={() => { setRenamingNav(gs.value); setRenameNavValue(displayLabel(gs.value, gs.label)) }}
                                      className="w-4 h-4 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/gs:opacity-100 transition-opacity shrink-0"
                                      title={`重命名「${displayLabel(gs.value, gs.label)}」`}
                                    >
                                      <Pencil size={9} />
                                    </button>
                                  )}
                                  {/* 上移/下移 */}
                                  <button onClick={() => moveNavGrandSub(s.value, gs.value, -1)} disabled={gsIdx === 0}
                                    className="w-4 h-4 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/gs:opacity-100 transition-opacity shrink-0 disabled:invisible" title="上移">
                                    <ChevronUp size={9} />
                                  </button>
                                  <button onClick={() => moveNavGrandSub(s.value, gs.value, 1)} disabled={gsIdx === orderedGrandSubs(s.value).length - 1}
                                    className="w-4 h-4 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/gs:opacity-100 transition-opacity shrink-0 disabled:invisible" title="下移">
                                    <ChevronDown size={9} />
                                  </button>
                                  {/* 删除 */}
                                  <button onClick={() => setDeletingNav({ level: 3, value: gs.value, grandParentValue: s.value })}
                                    className="w-4 h-4 flex items-center justify-center rounded text-muted hover:text-red-500 opacity-0 group-hover/gs:opacity-100 transition-opacity shrink-0" title="删除">
                                    <Trash2 size={9} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* 内联新增孙子类：放在三级区域外，确保无孙子类时也能显示输入框 */}
                          {!isCustomer && addingGrandSubFor === s.value && (
                            <div className="ml-2 pl-1.5 border-l border-border py-0.5">
                              <input
                                autoFocus
                                value={newNavGrandSubName}
                                onChange={(e) => setNewNavGrandSubName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleAddNavGrandSub(s.value)
                                  if (e.key === 'Escape') setAddingGrandSubFor(null)
                                }}
                                onBlur={() => setAddingGrandSubFor(null)}
                                placeholder="孙子类名，Enter 确认"
                                className="w-full px-2 py-0.5 text-[11px] border border-accent-300 rounded-md bg-surface outline-none focus:border-accent-500"
                              />
                            </div>
                          )}
                          </div>
                        ))}
                        {/* 内联新增子类：Enter 确认，Esc/失焦取消 */}
                        {addingSubFor === g.value && (
                          <input
                            autoFocus
                            value={newNavSubName}
                            onChange={(e) => setNewNavSubName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddNavSub(g.value)
                              if (e.key === 'Escape') setAddingSubFor(null)
                            }}
                            onBlur={() => setAddingSubFor(null)}
                            placeholder="子类名，Enter 确认"
                            className="w-full px-2 py-0.5 text-caption border border-accent-300 rounded-md bg-surface outline-none focus:border-accent-500"
                          />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {/* 大类翻页：分类多时逐页浏览，每页条数随屏高自适应 */}
              <NavPager page={navPage} totalPages={navTotalPages} onChange={setNavPage} label="分类" />
            </div>
          </div>

          <FilterPanel
            groups={filterGroups}
            values={filters}
            onChange={(key, value) => setFilters((f) => ({ ...f, [key]: value }))}
            onReset={() => { setFilters(fixedScope ? { scope: fixedScope } : {}); setActiveCat(null); setActiveSub(null); setActiveGrandSub(null) }}
            activeCount={activeCount}
          />
        </div>
        <ResizeHandle onMouseDown={navPanel.startDrag} />

        <div className="flex-1 min-w-0">
          {isLoading && <PageLoader />}
          {isError && <ErrorState message={(error as any)?.message || '加载失败'} onRetry={refetch} />}
          {!isLoading && !isError && listData.length === 0 && (
            <EmptyState
              icon={FileText}
              title="没有符合条件的资料"
              description={activeCount ? '试试放宽筛选条件' : '上传第一份资料开始沉淀'}
              action={
                <Button onClick={() => { reset(); setModalOpen(true) }}>
                  <Upload size={15} className="mr-1" /> 上传资料
                </Button>
              }
            />
          )}
          {!isLoading && !isError && listData.length > 0 && (
            <DataTable
              data={listData}
              rowKey={(row) => row.id}
              onRowDoubleClick={(row) => { setSelected(row); setDrawerOpen(true) }}
              rowClassName={(row: Document) => (row.id === highlightId ? 'bg-accent-50' : '')}
              selectedKeys={docSelectedKeys}
              onSelectionChange={setDocSelectedKeys}
              columns={[
                {
                  key: 'title',
                  title: '文件名',
                  // 标题默认就是文件名，两行一样会看着像重复；
                  // 同知识资料的做法：单行显示标题，文件名只在悬停提示里露脸
                  render: (row: Document) => {
                    const name = row.title || row.fileName
                    return (
                      <div className="text-ink truncate" title={row.fileName}>
                        {name}
                      </div>
                    )
                  },
                },
                {
                  key: 'ownerModule',
                  // 资料所属 = 这份文件从哪个业务环节来的，
                  // 和「类型」是两个维度：类型说它是什么，所属说它归谁
                  title: '资料所属',
                  render: (row: any) =>
                    row.ownerModule ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-canvas border border-border text-ink-soft">
                        {row.ownerModule}
                      </span>
                    ) : (
                      <span className="text-muted text-xs">未关联</span>
                    ),
                },
                {
                  key: 'category',
                  title: '类型',
                  render: (row: Document) =>
                    resolvedCatLabel(row.category),
                },
                {
                  key: 'customerId',
                  title: '关联客户',
                  render: (row: Document) => {
                    const c = customers.find((x: any) => x.id === row.customerId)
                    return c ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/customers/${c.id}`) }}
                        className="text-accent-600 hover:underline"
                      >
                        {c.name}
                      </button>
                    ) : (
                      <span className="text-muted">-</span>
                    )
                  },
                },
                { key: 'fileSize', title: '大小', render: (row: Document) => <span className="eo-num text-label">{formatSize(row.fileSize)}</span> },
                { key: 'status', title: '状态', render: (row: Document) => <StatusBadge status={row.status} /> },
                {
                  key: 'createdAt',
                  title: '上传时间',
                  render: (row: Document) => (
                    <span className="eo-num text-label text-muted">
                      {row.createdAt ? new Date(row.createdAt).toLocaleDateString('zh-CN') : '-'}
                    </span>
                  ),
                },
              ]}
              pagination={pagination}
              actions={(row: Document) => (
                <div className="flex items-center gap-2">
                  <button onClick={() => { setSelected(row); setDrawerOpen(true) }} className="text-accent-600 hover:text-accent-700" title="查看详情" aria-label="查看">
                    <Eye size={16} />
                  </button>
                  <button onClick={() => setPreviewDoc(row)} className="text-info-fg hover:opacity-70" title="预览文件" aria-label="预览">
                    <Scan size={16} />
                  </button>
                  <button onClick={() => openEditDoc(row)} className="text-ink-soft hover:text-ink" title="编辑归档信息" aria-label="编辑">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => { setMoveTarget(row); setMoveCategory(row.category || '') }} className="text-accent-600 hover:text-accent-700" title="移动分类" aria-label="移动分类">
                    <FolderInput size={16} />
                  </button>
                  {/* 关联到业务对象：仅客户资料需要（挂客户/需求/方案/报价）。
                      业务资料是对外参考资料（标准/图册/手册），不关联任何业务对象。 */}
                  {fixedScope !== 'business' && (
                    <button onClick={() => setLinkModalFor(row)} className="text-muted hover:text-ink" title="关联到业务对象" aria-label="关联到业务对象">
                      <Link2 size={16} />
                    </button>
                  )}
                  <button onClick={() => handleDownload(row)} className="text-ink-soft hover:text-ink" title="下载文件" aria-label="下载">
                    <Download size={16} />
                  </button>
                  <button onClick={() => setDeleteId(row.id)} className="text-danger-fg hover:opacity-70" title="删除资料" aria-label="删除">
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            />
          )}
        </div>
      </div>

      {/* 批量移动弹窗 */}
      <Modal
        open={batchMoveOpen}
        onClose={() => { setBatchMoveOpen(false); setMoveCategory(''); setMoveSearch('') }}
        title={`批量移动 ${docSelectedKeys.length} 个文件`}
        onConfirm={() => batchMoveMutation.mutate()}
        loading={batchMoveMutation.isPending}
        confirmText="移动"
        confirmDisabled={!moveCategory}
        size="sm"
      >
        <MoveCategoryPicker
          search={moveSearch}
          onSearchChange={setMoveSearch}
          selected={moveCategory}
          onSelect={setMoveCategory}
          groups={orderedGroups}
          subMap={subMap}
          grandSubMap={grandSubMap}
          displayLabel={displayLabel}
        />
      </Modal>

      {/* 批量删除确认 */}
      <Modal
        open={batchDeleteIds.length > 0}
        onClose={() => setBatchDeleteIds([])}
        title={`确认删除 ${batchDeleteIds.length} 个文件`}
        onConfirm={() => batchDeleteMutation.mutate()}
        loading={batchDeleteMutation.isPending}
        confirmText="删除"
      >
        <p className="text-sm text-ink-soft">
          确定删除选中的 {batchDeleteIds.length} 个文件吗？删除后进入
          <strong className="text-ink">回收站</strong>，保留 30 天内可还原。
        </p>
      </Modal>

      {/* 上传 */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setDroppedFile(null) }}
        title="上传资料"
        onConfirm={() => {
          if (!validateAll()) return
          const file = droppedFile || fileRef.current?.files?.[0]
          if (!file) return toast.error('请选择文件')
          if (!checkFileSize(file)) return
          if (checkDuplicateName(file.name)) {
            toast.warning(`已有同名文件「${file.name}」，如需更新请先删除旧文件`)
            return
          }
          uploadMutation.mutate(file)
        }}
        loading={uploadMutation.isPending}
        confirmDisabled={!isValid}
      >
        <div className="space-y-6">
          <FormSection title="文件" icon={FileText}>
            <div>
              <input id="doc-file" ref={fileRef} type="file" className="w-full text-sm" />
              <p className="mt-1 text-xs text-muted">支持 PDF、Word、Excel、PPT、Markdown、TXT。文件在本机解析，不上传外网。</p>
            </div>
          </FormSection>

          <FormSection title="归档信息">
            <FieldGrid>
              <div className="md:col-span-2">
                <FormInput label="标题" value={form.title} onChange={(e) => setValue('title', e.target.value)} error={errors.title} required />
              </div>
              <FormSelect label="资料类型" options={groupedCatOptions} value={form.category} onChange={(e) => setValue('category', e.target.value)} />
              <FormSelect label="可见性" options={visibilityOptions} value={form.visibility} onChange={(e) => setValue('visibility', e.target.value)} />
            </FieldGrid>
            {(() => {
              const cats = fixedScope === 'customer' ? CUSTOMER_DOC_CATEGORIES : DOC_CATEGORY_OPTIONS
              const selected = cats.find((c) => c.value === form.category)
              if (!selected?.hint) return null
              return (
                <div className="mt-2 px-3 py-2 bg-accent-50 border border-accent-200 rounded-md text-xs text-accent-700 leading-relaxed">
                  📁 {selected.hint}
                </div>
              )
            })()}
          </FormSection>
        </div>
      </Modal>

      {/* 关联到业务对象 */}
      <LinkModal
        doc={linkModalFor}
        onClose={() => setLinkModalFor(null)}
        onDone={() => {
          setLinkModalFor(null)
          queryClient.invalidateQueries({ queryKey: ['document-links'] })
        }}
      />

      {/* 删除确认 */}
      {/*
        编辑资料。
        只改归档信息（标题/类型/可见性），不动文件本身 ——
        换文件应该重新上传成新版本，而不是把一份记录的内容偷偷替换掉。

        改标题会影响所有引用处：资料只有一份，客户需求、技术方案里看到的
        是同一条记录。这是对的 —— 一份文件不该有两个名字。
      */}
      <Modal
        open={!!editDoc}
        onClose={() => setEditDoc(null)}
        title="编辑资料"
        onConfirm={() => editDoc && updateDocMutation.mutate()}
        loading={updateDocMutation.isPending}
        size="md"
      >
        <div className="space-y-4">
          <FormInput
            label="标题"
            value={editForm.title}
            onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))}
          />
          <FieldGrid>
            <FormSelect
              label="资料类型"
              options={groupedCatOptions}
              value={editForm.category}
              onChange={(e) => setEditForm((p) => ({ ...p, category: e.target.value }))}
            />
            <FormSelect
              label="可见性"
              options={visibilityOptions}
              value={editForm.visibility}
              onChange={(e) => setEditForm((p) => ({ ...p, visibility: e.target.value }))}
            />
          </FieldGrid>
          <p className="text-xs text-muted">
            文件名与文件内容不可在此修改。需要换文件请重新上传一份，保留原件便于追溯。
          </p>
        </div>
      </Modal>

      <Modal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="确认删除"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
        confirmText="删除"
      >
        {/* 文案必须与后端行为一致：删除已改为软删（进回收站保留 30 天），
            再写"无法恢复"会让用户以为误删就完了 */}
        <p className="text-sm text-ink-soft">
          确定要删除该资料吗？删除后进入<strong className="text-ink">回收站</strong>，
          保留 30 天内可还原；期间已建立的链路关联会失效，AI 问答也检索不到。
        </p>
      </Modal>

      {/* 解除关联确认：文件本身不动，断的是它与业务单据的链路 */}
      <ConfirmDialog
        open={!!unlinkingId}
        onClose={() => setUnlinkingId(null)}
        onConfirm={() => unlinkingId && unlinkMutation.mutate(unlinkingId)}
        loading={unlinkMutation.isPending}
        title="确认解除关联"
        confirmText="解除关联"
        message="确定解除这条关联吗？"
        detail="文件本身不会被删除，但解除后在客户 360°、需求、方案、报价等页面将回查不到它，需要时可重新建立关联。"
      />

      {/* 导航分类删除确认 */}
      {deletingNav && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeletingNav(null)}>
          <div className="eo-card p-4 w-80 space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium">确认删除</p>
            <p className="text-caption text-ink-soft">
              确定要删除「{displayLabel(deletingNav.value)}」吗？
              {deletingNav.level === 1 && '该大类下的所有子类和孙子类都将被移除。'}
              {deletingNav.level === 2 && '该子类下的所有孙子类都将被移除。'}
            </p>
            <p className="text-caption text-muted">删除后该分类下的文档不会丢失，仍可在「全部」中查看。</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeletingNav(null)} className="px-3 py-1 text-caption rounded-md border border-border hover:bg-canvas">取消</button>
              <button onClick={() => {
                if (deletingNav.level === 1) handleDeleteNavGroup(deletingNav.value)
                else if (deletingNav.level === 2) handleDeleteNavSub(deletingNav.parentValue!, deletingNav.value)
                else handleDeleteNavGrandSub(deletingNav.value, deletingNav.grandParentValue)
                setDeletingNav(null)
              }} className="px-3 py-1 text-caption rounded-md bg-red-500 text-white hover:bg-red-600">删除</button>
            </div>
          </div>
        </div>
      )}

      {/*
        回收站。
        删除已改为软删（快照 + 文件移到 uploads/.trash），没有这个入口的话
        "可还原"对用户等于不存在。
      */}
      <Drawer
        open={recycleOpen}
        onClose={() => setRecycleOpen(false)}
        title="回收站"
        width="w-[560px]"
      >
        <p className="text-caption text-muted mb-3">
          删除的资料在这里保留 30 天，到期自动清除。还原会把文件放回原位并重建 AI 索引。
        </p>
        {recycleQuery.isLoading ? (
          <PageLoader />
        ) : !(recycleQuery.data || []).length ? (
          <EmptyState bare icon={Trash2} title="回收站是空的" description="删除的资料会先放到这里，30 天内可以还原" />
        ) : (
          <div className="space-y-2">
            {(recycleQuery.data || []).map((it) => (
              <div key={it.id} className="rounded-md border border-border p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-body-sm text-ink truncate">{it.title || it.fileName}</p>
                    <p className="text-caption text-muted">
                      {resolvedCatLabel(it.category)} · 删除于{' '}
                      {it.deletedAt ? new Date(it.deletedAt).toLocaleString('zh-CN') : '—'}
                      {it.expiresAt && ` · ${new Date(it.expiresAt).toLocaleDateString('zh-CN')} 到期`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => restoreMutation.mutate(it.id)}
                      disabled={restoreMutation.isPending}
                      className="px-2 py-1 text-caption rounded-md border border-border hover:border-accent-300 hover:text-accent-600 disabled:opacity-50"
                    >
                      还原
                    </button>
                    <button
                      onClick={() => setPurgeId(it.id)}
                      className="px-2 py-1 text-caption rounded-md border border-border text-danger-fg hover:bg-danger-bg"
                    >
                      彻底删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      <Modal
        open={!!purgeId}
        onClose={() => setPurgeId(null)}
        title="彻底删除"
        onConfirm={() => purgeId && purgeMutation.mutate(purgeId)}
        loading={purgeMutation.isPending}
        confirmText="彻底删除"
      >
        <p className="text-sm text-ink-soft">
          这一步会把文件从磁盘上真正删掉，<strong className="text-danger-fg">无法再还原</strong>。确定继续吗？
        </p>
      </Modal>

      {/* 全链路回查 */}
      <Drawer
        open={!!chainCustomerId}
        onClose={() => setChainCustomerId(null)}
        title="全链路资料回查"
        width="w-[680px]"
      >
        {chainQuery.isLoading ? (
          <PageLoader />
        ) : (chainQuery.data || []).length === 0 ? (
          <EmptyState bare icon={GitBranch} title="该客户暂无链路资料" description="上传资料并关联到需求 / 方案 / 报价后，这里会按阶段展示完整链路" />
        ) : (
          <div className="space-y-5">
            {(chainQuery.data || []).map((node) => (
              <div key={node.stage}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-body-sm font-semibold text-ink">{node.stageLabel}</span>
                  <span className="font-mono text-caption text-muted">{node.documents.length}</span>
                  {node.entityTitle && (
                    <span className="text-caption text-muted truncate">· {node.entityTitle}</span>
                  )}
                </div>
                <div className="space-y-1.5">
                  {node.documents.map((d) => (
                    <div key={d.id + (d.link?.id || '')} className="flex items-center gap-2 bg-subtle rounded-md px-3 py-2">
                      <FileText size={14} className="text-muted flex-shrink-0" />
                      <span className="text-body-sm text-ink truncate flex-1">{d.title}</span>
                      {d.link && <div className="flex gap-1">{linkChips(d.link, navigate)}</div>}
                      <button onClick={() => handleDownload(d)} className="text-muted hover:text-accent-600 flex-shrink-0" title="下载文件" aria-label="下载">
                        <Download size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      {/* 详情 */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="资料详情" width="w-[560px]">
        {detailQuery.isLoading ? (
          <PageLoader />
        ) : (
          <div className="space-y-6">
            <DetailHeader
              title={detailQuery.data?.title}
              code={detailQuery.data?.fileName}
              badge={<StatusBadge status={detailQuery.data?.status} />}
              stats={[
                {
                  label: '资料类型',
                  value:
resolvedCatLabel(detailQuery.data?.category),
                },
                { label: '大小', value: formatSize(detailQuery.data?.fileSize) },
              ]}
            />

            <DetailSection title="归档信息">
              <DescList
                items={[
                  {
                    label: '可见性',
                    value:
                      visibilityOptions.find((o) => o.value === detailQuery.data?.visibility)?.label ||
                      detailQuery.data?.visibility,
                  },
                  { label: '上传人', value: detailQuery.data?.uploader?.nickname },
                  {
                    label: '上传时间',
                    value: detailQuery.data?.createdAt
                      ? new Date(detailQuery.data.createdAt).toLocaleString('zh-CN')
                      : undefined,
                  },
                ]}
              />
            </DetailSection>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-body-sm font-semibold text-ink">关联链路</h4>
                <Button variant="secondary" size="sm" onClick={() => setLinkModalFor(detailQuery.data || null)}>
                  <Link2 size={13} className="mr-1" /> 新增关联
                </Button>
              </div>
              {(detailLinksQuery.data || []).length === 0 ? (
                <p className="text-body-sm text-muted bg-subtle rounded-md px-3 py-3">
                  尚未关联到任何业务对象。关联后可在客户 360°、需求、方案、报价页面回查到本文件。
                </p>
              ) : (
                <div className="space-y-1.5">
                  {(detailLinksQuery.data || []).map((link) => (
                    <div key={link.id} className="flex items-center gap-2 bg-subtle rounded-md px-3 py-2">
                      <span className="font-mono text-caption px-1.5 py-0.5 rounded bg-neutral-bg text-neutral-fg">
                        {DOC_STAGE_LABELS[link.stage] || link.stage}
                      </span>
                      <div className="flex gap-1 flex-1">{linkChips(link, navigate)}</div>
                      <button
                        onClick={() => setUnlinkingId(link.id)}
                        className="text-muted hover:text-danger-fg flex-shrink-0"
                        title="解除关联"
                        aria-label="解除关联"
                      >
                        <Unlink size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Button variant="secondary" className="w-full" onClick={() => handleDownload(detailQuery.data || undefined)}>
              <Download size={15} className="mr-1" /> 下载 / 预览
            </Button>
          </div>
        )}
      </Drawer>

      {/* 文件预览 */}
      <FilePreview
        isOpen={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        fileName={previewDoc?.fileName || ''}
        mimeType={previewDoc?.mimeType}
        fileSize={previewDoc?.fileSize}
        fileKind="documents"
        fileId={previewDoc?.id}
        // 当前页的资料即可连续翻阅：一次传十几张现场照片时不用一张张关掉重开
        siblings={listData as any}
        onNavigate={(item) => setPreviewDoc(item as any)}
      />

      {/* 移动分类弹窗 */}
      <Modal
        open={!!moveTarget}
        onClose={() => { setMoveTarget(null); setMoveCategory(''); setMoveSearch('') }}
        title={`移动「${moveTarget?.title || moveTarget?.fileName || ''}」`}
        onConfirm={() => moveMutation.mutate()}
        loading={moveMutation.isPending}
        confirmText="移动"
        confirmDisabled={!moveCategory}
        size="sm"
      >
        <MoveCategoryPicker
          search={moveSearch}
          onSearchChange={setMoveSearch}
          selected={moveCategory}
          onSelect={setMoveCategory}
          groups={orderedGroups}
          subMap={subMap}
          grandSubMap={grandSubMap}
          displayLabel={displayLabel}
        />
      </Modal>
    </div>
    </FileDropZone>
  )
}

// LinkModal 和 MoveCategoryPicker 已提取到 DocumentModals.tsx
