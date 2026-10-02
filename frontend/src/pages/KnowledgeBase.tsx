import { useEffect, useRef, useState, useMemo } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Upload,
  FileText,
  RefreshCw,
  Trash2,
  CheckCircle,
  Clock,
  AlertCircle,
  BookOpen,
  Search,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Plus,
  X,
  Scan,
  Pencil,
  FolderTree,
  Download,
  FolderInput,
} from 'lucide-react'
import { documentApi } from '../api/services'
import { downloadFile } from '../api/files'
import { usePageActions } from '../contexts/PageActionsContext'
import { useResizablePanel, ResizeHandle } from '../hooks/useResizablePanel'
import { useNavPageSize, clampNavPage } from '../hooks/useNavPageSize'
import { notifyIfPermitted } from '../utils/notifications'
import Button from '../components/Button'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import EmptyState from '../components/EmptyState'
import FilePreview from '../components/FilePreview'
import FileDropZone from '../components/FileDropZone'
import StatCards from '../components/StatCards'
import NavPager from '../components/NavPager'
import BatchEditBar from '../components/BatchEditBar'
import { PAGE_SIZE_OPTIONS } from '../components/DataTable'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'

// ─── 上传限制 ───
/** 单文件上限 200MB（与后端 MAX_UPLOAD_BYTES 对齐） */
const MAX_FILE_SIZE = 200 * 1024 * 1024
/** 单批上限 10 个：逐个解析+向量索引，太多等待太久 */
const MAX_FILE_COUNT = 10
const ACCEPT_EXTS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.md']

// ─── 基础分类体系 ───
const BASE_CATEGORIES = [
  { key: 'workflow_import', label: '工作流导入', group: '其他', color: 'text-warning-fg bg-warning-bg border-warning-line' },
  // ── FAQ常见问题 ──
  { key: 'faq_selection', label: '选型FAQ', group: 'FAQ常见问题', color: 'text-accent-600 bg-accent-50 border-accent-200' },
  { key: 'faq_tech_params', label: '技术参数FAQ', group: 'FAQ常见问题', color: 'text-accent-600 bg-accent-50 border-accent-200' },
  { key: 'faq_process', label: '工艺FAQ', group: 'FAQ常见问题', color: 'text-accent-600 bg-accent-50 border-accent-200' },
  { key: 'faq_price', label: '价格/商务FAQ', group: 'FAQ常见问题', color: 'text-accent-600 bg-accent-50 border-accent-200' },
  { key: 'faq_delivery', label: '交期/物流FAQ', group: 'FAQ常见问题', color: 'text-accent-600 bg-accent-50 border-accent-200' },
  { key: 'faq_warranty', label: '售后/质保FAQ', group: 'FAQ常见问题', color: 'text-accent-600 bg-accent-50 border-accent-200' },
  // ── 技术知识 ──
  { key: 'tech_principle', label: '技术原理', group: '技术知识', color: 'text-info-fg bg-info-bg border-info-line' },
  { key: 'tech_process', label: '工艺知识', group: '技术知识', color: 'text-info-fg bg-info-bg border-info-line' },
  { key: 'tech_material', label: '材料知识', group: '技术知识', color: 'text-info-fg bg-info-bg border-info-line' },
  { key: 'tech_structure', label: '设备结构', group: '技术知识', color: 'text-info-fg bg-info-bg border-info-line' },
  { key: 'tech_electrical', label: '电气控制', group: '技术知识', color: 'text-info-fg bg-info-bg border-info-line' },
  { key: 'tech_hydraulic', label: '液压/润滑', group: '技术知识', color: 'text-info-fg bg-info-bg border-info-line' },
  { key: 'tech_trend', label: '行业动态', group: '技术知识', color: 'text-info-fg bg-info-bg border-info-line' },
  // ── 标准规范 ──
  { key: 'national_standard', label: '国家标准', group: '标准规范', color: 'text-danger-fg bg-danger-bg border-danger-line' },
  { key: 'industry_standard', label: '行业标准', group: '标准规范', color: 'text-info-fg bg-info-bg border-info-line' },
  { key: 'enterprise_standard', label: '企业标准', group: '标准规范', color: 'text-muted bg-canvas border-border' },
  { key: 'intl_standard', label: '国际标准', group: '标准规范', color: 'text-accent-600 bg-accent-50 border-accent-200' },
  { key: 'customer_special_std', label: '客户特殊规范', group: '标准规范', color: 'text-warning-fg bg-warning-bg border-warning-line' },
  // ── 模板表格 ──
  { key: 'tech_agreement', label: '技术协议模板', group: '模板表格', color: 'text-warning-fg bg-warning-bg border-warning-line' },
  { key: 'acceptance_template', label: '验收标准模板', group: '模板表格', color: 'text-warning-fg bg-warning-bg border-warning-line' },
  { key: 'test_report_template', label: '测试报告模板', group: '模板表格', color: 'text-warning-fg bg-warning-bg border-warning-line' },
  { key: 'site_survey_template', label: '现场勘测表', group: '模板表格', color: 'text-warning-fg bg-warning-bg border-warning-line' },
  { key: 'calc_template', label: '计算表格', group: '模板表格', color: 'text-warning-fg bg-warning-bg border-warning-line' },
  { key: 'param_comparison', label: '参数对照表', group: '模板表格', color: 'text-warning-fg bg-warning-bg border-warning-line' },
  // ── 培训资料 ──
  { key: 'product_manual', label: '产品手册', group: '培训资料', color: 'text-success-fg bg-success-bg border-success-line' },
  { key: 'training_material', label: '培训教材', group: '培训资料', color: 'text-success-fg bg-success-bg border-success-line' },
  { key: 'operation_manual', label: '操作手册', group: '培训资料', color: 'text-success-fg bg-success-bg border-success-line' },
  { key: 'maintenance_manual', label: '维护手册', group: '培训资料', color: 'text-success-fg bg-success-bg border-success-line' },
  { key: 'safety_manual', label: '安全规程', group: '培训资料', color: 'text-success-fg bg-success-bg border-success-line' },
  // ── 常用提交资料 ──
  { key: 'product_spec_doc', label: '产品说明书', group: '常用提交资料', color: 'text-muted bg-canvas border-border' },
  { key: 'certificate_template', label: '合格证', group: '常用提交资料', color: 'text-muted bg-canvas border-border' },
  { key: 'packing_list', label: '装箱单', group: '常用提交资料', color: 'text-muted bg-canvas border-border' },
  { key: 'factory_inspection', label: '出厂检验', group: '常用提交资料', color: 'text-muted bg-canvas border-border' },
  { key: 'random_docs', label: '随机文件', group: '常用提交资料', color: 'text-muted bg-canvas border-border' },
  // ── 故障排除（售后转FAQ自动生成）──
  { key: 'troubleshooting', label: '故障排除', group: '故障排除', color: 'text-danger-fg bg-danger-bg/70 border-danger-line/70' },
  // ── 其他 ──
  { key: 'other', label: '其他', group: '其他', color: 'text-muted bg-canvas border-border' },
]

const BASE_GROUPS = ['FAQ常见问题', '技术知识', '标准规范', '模板表格', '培训资料', '常用提交资料', '故障排除', '其他']

const CUSTOM_GROUP_COLORS = [
  'text-danger-fg bg-danger-bg border-danger-line',
  'text-accent-600 bg-accent-50 border-accent-200',
  'text-success-fg bg-success-bg border-success-line',
  'text-warning-fg bg-warning-bg border-warning-line',
  'text-info-fg bg-info-bg border-info-line',
  'text-danger-fg bg-danger-bg border-danger-line',
]

// ─── localStorage 持久化 ───
const STORAGE_KEY = 'knowledge-groups-v2'  // v2: 强制刷新为新分类体系

const DEFAULT_GROUPS = BASE_GROUPS

function loadGroups(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed: string[] = JSON.parse(stored)
      // 旧版分组迁移：只要包含任意旧分组名（产品资料/商务资料/运维培训），
      // 说明是旧版缓存，直接替换为新8分组。
      const oldGroupNames = ['产品资料', '商务资料', '运维培训']
      if (parsed.some((g) => oldGroupNames.includes(g))) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_GROUPS))
        return [...DEFAULT_GROUPS]
      }
      return parsed
    }
    // 首次使用，初始化默认分类
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_GROUPS))
    return [...DEFAULT_GROUPS]
  } catch { return [...DEFAULT_GROUPS] }
}

function saveGroups(groups: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(groups))
}

// ─── 自定义子类持久化（仅用户自建大类可追加子类） ───
const SUB_STORAGE_KEY = 'knowledge-custom-subs-v1'

function loadCustomSubs(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(SUB_STORAGE_KEY) || '{}')
  } catch { return {} }
}

function saveCustomSubs(map: Record<string, string[]>) {
  localStorage.setItem(SUB_STORAGE_KEY, JSON.stringify(map))
}

// ─── 基础子类展示顺序（本地浏览偏好，与需求模板页同款；自定义子类顺序由 customSubs 数组天然承载） ───
const SUB_ORDER_KEY = 'knowledge-sub-order-v1'

function loadSubOrders(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(SUB_ORDER_KEY) || '{}')
  } catch { return {} }
}

function saveSubOrders(map: Record<string, string[]>) {
  localStorage.setItem(SUB_ORDER_KEY, JSON.stringify(map))
}

// ─── 基础分类标签改名覆盖（大类名/子类标签）───
// 基础分类的存储值（key）固定不可变，改名只是换展示标签，存本地即可，无需后端级联
const LABEL_OVERRIDES_KEY = 'knowledge-label-overrides-v1'

function loadLabelOverrides(): { group: Record<string, string>; sub: Record<string, string> } {
  try {
    const parsed = JSON.parse(localStorage.getItem(LABEL_OVERRIDES_KEY) || '{}')
    return { group: parsed.group || {}, sub: parsed.sub || {} }
  } catch { return { group: {}, sub: {} } }
}

function saveLabelOverrides(o: { group: Record<string, string>; sub: Record<string, string> }) {
  localStorage.setItem(LABEL_OVERRIDES_KEY, JSON.stringify(o))
}

// ─── 分类查找 ───
const catLabel = (cat: string, allCategories: typeof BASE_CATEGORIES) => {
  const sub = cat?.includes('/') ? cat.split('/')[1] : cat
  return allCategories.find((c) => c.key === sub)?.label || sub || '其他'
}
const catColor = (cat: string, allCategories: typeof BASE_CATEGORIES) => {
  const sub = cat?.includes('/') ? cat.split('/')[1] : cat
  return allCategories.find((c) => c.key === sub)?.color || 'text-muted bg-canvas border-border'
}

interface KnowledgeDoc {
  id: string
  title: string
  fileName: string
  fileUrl?: string
  fileSize: number
  mimeType: string
  category: string
  status: string
  parsedText?: string
  createdAt: string
}

function getIndexStatus(parsedText?: string): { indexed: boolean; chunks: number; reason?: string } {
  if (!parsedText) return { indexed: false, chunks: 0 }
  try {
    const parsed = JSON.parse(parsedText)
    return { indexed: !!parsed.indexed, chunks: parsed.chunks || 0, reason: parsed.reason }
  } catch {
    return { indexed: false, chunks: 0 }
  }
}

export default function KnowledgeBase() {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const modalFileRef = useRef<HTMLInputElement>(null)
  const addInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const [indexing, setIndexing] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('all')
  const [kbPage, setKbPage] = useState(1)
  /** 右侧列表每页条数：10/15/20 可选，默认 15（与全站列表统一） */
  const [kbPageSize, setKbPageSize] = useState(15)
  /** 左侧导航选中的子类：选中后顶栏/拖拽上传直接传到该子类，不再走弹窗 */
  const [activeSub, setActiveSub] = useState<string | null>(null)
  /**
   * 左侧导航中被收起的大类 —— 记「收起」而不是「展开」，默认就是全部展开。
   * 大类是接口拉回来的，存展开集得等数据到齐再回填一次；存收起集则新大类天然展开。
   */
  /*
   * 默认全部收起（原来是默认全展开）。
   * 大类 + 子类一铺到底时左侧一屏装不下，只能滚动找；收起后一屏能看全大类。
   * 仍存"收起集"：展开过的会被记住，新增的大类天然收起。
   */
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(() => [...BASE_GROUPS])
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => (prev.includes(key) ? prev.filter((g) => g !== key) : [...prev, key]))
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  // 默认落在首个基础分组及其首个子分类（旧默认 '产品资料' 已不在 BASE_GROUPS 中，
  // 导致弹窗打开时分组无高亮、子分类列表为空）
  const [uploadGroup, setUploadGroup] = useState(BASE_GROUPS[0])
  const [uploadSub, setUploadSub] = useState('faq_selection')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [previewDoc, setPreviewDoc] = useState<KnowledgeDoc | null>(null)
  // 待确认删除的资料 / 大类（原来资料用原生 confirm、大类点了直接删）
  const [deletingDoc, setDeletingDoc] = useState<KnowledgeDoc | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null)
  const [deletingDocBusy, setDeletingDocBusy] = useState(false)
  // 列表复选框选中的资料 ID（批量修改分类/批量删除，操作条在顶栏）
  const [kbSelected, setKbSelected] = useState<string[]>([])
  // 文件移动分类（操作列「移动」按钮）
  const [moveTarget, setMoveTarget] = useState<KnowledgeDoc | null>(null)
  const [moveCategory, setMoveCategory] = useState('')
  const moveMutation = useMutation({
    mutationFn: () => documentApi.update(moveTarget!.id, { category: moveCategory }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-docs'] })
      setMoveTarget(null)
      setMoveCategory('')
      toast.success('已移动到新分类')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || '移动失败'),
  })

  // 自定义分类（包含默认分类 + 用户新增）
  const [groups, setGroups] = useState<string[]>(loadGroups)
  const [showAddInput, setShowAddInput] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  // 自定义大类下的子类（key=大类名，value=子类名数组）；基础大类用固定 BASE_CATEGORIES
  const [customSubs, setCustomSubs] = useState<Record<string, string[]>>(loadCustomSubs)
  const [newSubName, setNewSubName] = useState('')
  // 重命名：正在改名的大类/子类 + 输入值（自定义分类走后端级联，基础分类只改展示标签）
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null)
  const [renameGroupValue, setRenameGroupValue] = useState('')
  const [renamingSub, setRenamingSub] = useState<{ group: string; name: string } | null>(null)
  const [renameSubValue, setRenameSubValue] = useState('')
  // 基础分类的改名标签覆盖（自定义分类直接改存储名，不需要覆盖）
  const [labelOverrides, setLabelOverrides] = useState(loadLabelOverrides)
  const groupLabelOf = (g: string) => labelOverrides.group[g] || g
  const subLabelOf = (key: string, fallback: string) => labelOverrides.sub[key] || fallback
  // 基础子类的展示顺序偏好（自定义子类顺序在 customSubs 数组里）
  const [subOrders, setSubOrders] = useState<Record<string, string[]>>(loadSubOrders)
  // 左侧导航新增子类（基础/自定义大类都支持；新增中的大类 + 输入值）
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null)
  const [newNavSubName, setNewNavSubName] = useState('')

  // 基础子类按本地偏好排序、并套用改名标签覆盖；key 不变，无需级联
  const orderedBaseCategories = BASE_GROUPS.flatMap((g) => {
    const baseCats = BASE_CATEGORIES.filter((c) => c.group === g).map((c) => ({ ...c, label: subLabelOf(c.key, c.label) }))
    // 基础大类下本地新增的子类（存在 customSubs 里，key 即存储值，后端目录同名）
    const color = baseCats[0]?.color || 'text-muted bg-canvas border-border'
    const extraCats = (customSubs[g] || [])
      .filter((s) => !BASE_CATEGORIES.some((c) => c.key === s))
      .map((s) => ({ key: s, label: subLabelOf(s, s), group: g, color }))
    const cats = [...baseCats, ...extraCats]
    const order = subOrders[g]
    if (!order || order.length === 0) return cats
    // 存档里没有的 key（新增或残留）保持在末尾，容错
    return [...cats].sort((a, b) => {
      const ia = order.indexOf(a.key)
      const ib = order.indexOf(b.key)
      return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
    })
  })

  // 构建完整分类列表：基础分类 + 自定义分类（用户新增的会自动加进去）
  const allGroups = groups
  const configuredCategories = [
    ...orderedBaseCategories,
    ...groups.filter((g) => !BASE_GROUPS.includes(g)).flatMap((g, i) => {
      const color = CUSTOM_GROUP_COLORS[i % CUSTOM_GROUP_COLORS.length]
      const subs = customSubs[g] || []
      // 还没建过子类时保留旧行为：大类自身充当唯一子类（兼容历史上传的数据）
      if (subs.length === 0) return [{ key: g, label: g, group: g, color }]
      return subs.map((s) => ({ key: s, label: s, group: g, color }))
    }),
  ]

  const handleAddGroup = () => {
    const name = newGroupName.trim()
    if (!name) return
    if (allGroups.some((g) => g === name || groupLabelOf(g) === name)) {
      toast.warning('该分类已存在')
      return
    }
    const updated = [...groups, name]
    setGroups(updated)
    saveGroups(updated)
    setNewGroupName('')
    setShowAddInput(false)
    toast.success(`分类「${name}」已添加`)
  }

  // 为自定义大类添加子类：子类名全局唯一（直接作后端磁盘目录名与 category 存储值，不能歧义）
  const handleAddSub = () => {
    const name = newSubName.trim()
    if (!name) return
    if (name.includes('/')) {
      toast.error('子分类名不能包含 /')
      return
    }
    if (allCategories.some((c) => c.key === name || c.label === name)) {
      toast.warning('该子分类已存在')
      return
    }
    const updated = { ...customSubs, [uploadGroup]: [...(customSubs[uploadGroup] || []), name] }
    setCustomSubs(updated)
    saveCustomSubs(updated)
    setUploadSub(name)
    setNewSubName('')
    toast.success(`子分类「${name}」已添加，已自动选中`)
  }

  // 左侧导航新增子类：基础/自定义大类都支持；子类名全局唯一（直接作存储值与磁盘目录名）
  const handleAddNavSub = (group: string) => {
    const name = newNavSubName.trim()
    if (!name) return
    if (name.includes('/')) {
      toast.error('子分类名不能包含 /')
      return
    }
    if (allCategories.some((c) => c.key === name || c.label === name) || allGroups.some((g) => g === name || groupLabelOf(g) === name)) {
      toast.warning('该子分类已存在')
      return
    }
    const updated = { ...customSubs, [group]: [...(customSubs[group] || []), name] }
    setCustomSubs(updated)
    saveCustomSubs(updated)
    setNewNavSubName('')
    toast.success(`子分类「${name}」已添加`)
  }

  /**
   * 重命名大类。
   * 自定义大类：名字已写进数据库（category = knowledge/xxx），必须后端级联改，
   * 否则旧资料会掉到「其他」里。
   * 基础大类：存储 key 固定不可变，改名只是换展示标签（本地覆盖），无需级联。
   */
  const handleRenameGroup = async (oldName: string) => {
    const newName = renameGroupValue.trim()
    setRenamingGroup(null)
    const oldLabel = groupLabelOf(oldName)
    if (!newName || newName === oldLabel) return
    if (newName.includes('/')) {
      toast.error('分类名不能包含 /')
      return
    }
    // 重名校验按双方改后展示名：其他大类展示名 + 全部子类 key/标签
    if (allGroups.some((g) => g !== oldName && groupLabelOf(g) === newName) || allCategories.some((c) => c.key === newName || c.label === newName)) {
      toast.warning('该分类名已存在')
      return
    }
    if (BASE_GROUPS.includes(oldName)) {
      const updated = { ...labelOverrides, group: { ...labelOverrides.group, [oldName]: newName } }
      setLabelOverrides(updated)
      saveLabelOverrides(updated)
      toast.success(`分类「${oldLabel}」已改名为「${newName}」`)
      return
    }
    // 本地：大类列表 + 子类映射跟着改
    const updatedGroups = groups.map((g) => (g === oldName ? newName : g))
    setGroups(updatedGroups)
    saveGroups(updatedGroups)
    if (customSubs[oldName]) {
      const updatedSubs = { ...customSubs, [newName]: customSubs[oldName] }
      delete updatedSubs[oldName]
      setCustomSubs(updatedSubs)
      saveCustomSubs(updatedSubs)
    }
    if (activeTab === oldName) setActiveTab(newName)
    // 库里以旧大类名直传的资料 → 后端级联改 category
    try {
      await documentApi.knowledgeRenameCategory(oldName, newName)
      queryClient.invalidateQueries({ queryKey: ['knowledge-docs'] })
      toast.success(`分类「${oldName}」已改名为「${newName}」`)
    } catch (err: any) {
      toast.error(`改名失败：${err?.response?.data?.message || err?.message}`)
    }
  }

  /** 重命名子类：自定义子类后端级联；基础子类只改展示标签（key 是存储值，不可变） */
  const handleRenameSub = async (group: string, oldKey: string) => {
    const newName = renameSubValue.trim()
    setRenamingSub(null)
    const isBase = BASE_GROUPS.includes(group)
    const oldLabel = isBase ? subLabelOf(oldKey, BASE_CATEGORIES.find((c) => c.key === oldKey)?.label || oldKey) : oldKey
    if (!newName || newName === oldLabel) return
    if (newName.includes('/')) {
      toast.error('子分类名不能包含 /')
      return
    }
    if (allCategories.some((c) => c.key !== oldKey && (c.key === newName || c.label === newName)) || allGroups.some((g) => groupLabelOf(g) === newName)) {
      toast.warning('该子分类名已存在')
      return
    }
    if (isBase) {
      const updated = { ...labelOverrides, sub: { ...labelOverrides.sub, [oldKey]: newName } }
      setLabelOverrides(updated)
      saveLabelOverrides(updated)
      toast.success(`子分类「${oldLabel}」已改名为「${newName}」`)
      return
    }
    const updated = { ...customSubs, [group]: (customSubs[group] || []).map((s) => (s === oldKey ? newName : s)) }
    setCustomSubs(updated)
    saveCustomSubs(updated)
    if (activeSub === oldKey) setActiveSub(newName)
    try {
      await documentApi.knowledgeRenameCategory(oldKey, newName)
      queryClient.invalidateQueries({ queryKey: ['knowledge-docs'] })
      toast.success(`子分类「${oldKey}」已改名为「${newName}」`)
    } catch (err: any) {
      toast.error(`改名失败：${err?.response?.data?.message || err?.message}`)
    }
  }

  /**
   * 点删除图标：非空分类当场拦下，空分类才弹确认框。
   * 拦截放在开弹窗之前 —— 弹出来再告诉用户「删不了」是白让人点一次。
   */
  const requestDeleteGroup = (group: string) => {
    // 口径与导航计数一致：归不到已知分类的资料算在「其他」下，删它之前一样要拦
    const docsInGroup = allDocs.filter((d) => groupOf(d) === group)
    if (docsInGroup.length > 0) {
      toast.error(`该分类下有 ${docsInGroup.length} 份文档，请先删除或移动文档`)
      return
    }
    setDeletingGroup(group)
  }

  const handleDeleteGroup = (group: string) => {
    const updated = groups.filter((g) => g !== group)
    setGroups(updated)
    saveGroups(updated)
    // 该大类下的自定义子类一并清掉
    if (customSubs[group]) {
      const subUpdated = { ...customSubs }
      delete subUpdated[group]
      setCustomSubs(subUpdated)
      saveCustomSubs(subUpdated)
    }
    if (activeTab === group) setActiveTab('all')
    setActiveSub(null)
    setDeletingGroup(null)
    toast.success(`分类「${group}」已删除`)
  }

  /** 大类上下移动：纯展示顺序偏好，随 groups 数组持久化 */
  const moveGroup = (group: string, direction: -1 | 1) => {
    const idx = groups.indexOf(group)
    const to = idx + direction
    if (idx === -1 || to < 0 || to >= groups.length) return
    const next = [...groups]
    ;[next[idx], next[to]] = [next[to], next[idx]]
    setGroups(next)
    saveGroups(next)
  }

  /**
   * 子类上下移动：顺序只是浏览偏好，不改分类存储值（无需后端级联）。
   * 基础子类存 subOrders，自定义子类改 customSubs 数组顺序。
   * 以当前实际展示顺序为基准，避免改名后存档残留旧名导致 indexOf 失败。
   */
  const moveSub = (group: string, key: string, direction: -1 | 1) => {
    const displayed = allCategories.filter((c) => c.group === group).map((c) => c.key)
    const idx = displayed.indexOf(key)
    const to = idx + direction
    if (idx === -1 || to < 0 || to >= displayed.length) return
    const next = [...displayed]
    ;[next[idx], next[to]] = [next[to], next[idx]]
    if (BASE_GROUPS.includes(group)) {
      const updated = { ...subOrders, [group]: next }
      setSubOrders(updated)
      saveSubOrders(updated)
    } else {
      const updated = { ...customSubs, [group]: next }
      setCustomSubs(updated)
      saveCustomSubs(updated)
    }
  }

  // 重置为默认分类（保留自定义分类，只补回缺失的默认分类）
  const handleResetGroups = () => {
    const missing = DEFAULT_GROUPS.filter((g) => !groups.includes(g))
    if (missing.length === 0) {
      toast.info('默认分类已全部存在')
      return
    }
    const updated = [...groups, ...missing]
    setGroups(updated)
    saveGroups(updated)
    toast.success(`已恢复 ${missing.length} 个默认分类`)
  }

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['knowledge-docs'],
    queryFn: () => documentApi.knowledge(),
  })

  const allDocs = (Array.isArray(data) ? data : []) as KnowledgeDoc[]

  /** 取一条资料的子类名（category 形如 knowledge/宝钢样本） */
  const subOf = (d: KnowledgeDoc) =>
    d.category?.includes('/') ? d.category.split('/')[1] : 'other'

  /*
   * 库里真实存在、但分类表里没有的子类。
   *
   * 分类表是「BASE_CATEGORIES 常量 + localStorage 里的自定义项」，完全不看数据。
   * 批量导入/外部写入的资料（本机就有 17 篇挂在「宝钢样本」下）因此两头落空：
   * 左侧导航没有它的入口，各大类计数用的是 `find(...)?.group === g`，匹配不上就
   * 哪个大类都不算 —— 于是「全部 30」而下面各类加起来只有 13，另外 17 篇看不见也点不到。
   * 这里把它们补进「其他」，导航能点、计数也对得上。
   */
  const orphanCategories = useMemo(() => {
    const known = new Set(configuredCategories.map((c) => c.key))
    const found = new Set<string>()
    for (const d of allDocs) {
      const sub = subOf(d)
      if (sub && !known.has(sub)) found.add(sub)
    }
    return [...found].map((s) => ({
      key: s,
      label: s,
      group: '其他',
      color: 'text-muted bg-canvas border-border',
    }))
     
  }, [allDocs, JSON.stringify(configuredCategories.map((c) => c.key))])

  const allCategories = [...configuredCategories, ...orphanCategories]

  /** 子类 → 大类；查不到一律归「其他」，计数与筛选必须用同一套口径 */
  const groupOf = (d: KnowledgeDoc) =>
    allCategories.find((c) => c.key === subOf(d))?.group || '其他'

  // 当前大类下的小类（上传用）
  const currentSubs = allCategories.filter((c) => c.group === uploadGroup)

  // Tab: 按大类分组 + "全部"
  const groupTabs = allGroups.map((g) => ({
    key: g,
    label: groupLabelOf(g),
    count: allDocs.filter((d) => groupOf(d) === g).length,
  }))

  // 大类导航翻页：每页条数随屏高自适应，窗口拉高一屏多翻几个大类，底部不留白
  const navPageSize = useNavPageSize({ rowHeight: 34, min: 5 })
  const [navPage, setNavPage] = useState(1)
  const navTotalPages = Math.max(1, Math.ceil(groupTabs.length / navPageSize))
  const pagedTabs = groupTabs.slice((navPage - 1) * navPageSize, navPage * navPageSize)
  // 分类增删/每页条数变化时把页码收敛回合法区间
  useEffect(() => { setNavPage((p) => clampNavPage(p, navTotalPages)) }, [navTotalPages])

  // Filter by group tab + subcategory + search
  const filtered = useMemo(() => allDocs.filter((d) => {
    const tabMatch = activeTab === 'all' || groupOf(d) === activeTab
    const subMatch = !activeSub || subOf(d) === activeSub
    const searchMatch = !search || d.title?.toLowerCase().includes(search.toLowerCase()) || d.fileName?.toLowerCase().includes(search.toLowerCase())
    return tabMatch && subMatch && searchMatch
     
  }), [allDocs, activeTab, activeSub, search, allCategories])

  // 筛选条件变化时重置到第1页
  useEffect(() => { setKbPage(1) }, [activeTab, activeSub, search])

  /*
   * 页面助手上下文。
   *
   * 这一页的特殊之处：资料能不能被 AI 检索到，取决于它有没有成功索引 ——
   * 扫描件、旧版 .doc 会被挡在门外。所以上下文里必须带上每份资料的索引状态，
   * 否则用户问"这份规范里怎么写的"，助手查不到又说不清为什么。
   */
  useRegisterPageAssistant({
    key: 'knowledge',
    label: '知识资料',
    sourceTypes: ['knowledge'],
    questions: [
      '本页哪些资料还没有成功索引？为什么',
      '这些标准规范主要覆盖哪些钢种和工艺？',
      '按当前分类，资料的完整度如何？',
      '冷轧带钢相关的资料有哪些？',
      '哪些资料需要重新上传文字版？',
    ],
    context: (() => {
      const stat = (d: KnowledgeDoc) => getIndexStatus(d.parsedText)
      const okCount = filtered.filter((d) => stat(d).indexed).length
      return [
        `页面：知识资料（共 ${allDocs.length} 份，当前筛选后 ${filtered.length} 份）`,
        `当前大类：${activeTab === 'all' ? '全部' : groupLabelOf(activeTab)}${activeSub ? ` / ${activeSub}` : ''}`,
        search ? `搜索关键词：${search}` : '',
        `筛选结果中已成功索引 ${okCount} 份、未索引 ${filtered.length - okCount} 份`,
        '当前资料清单（含索引状态）：',
        ...filtered.slice(0, 40).map((d, i) => {
          const s = stat(d)
          const state = s.indexed
            ? `已索引 ${s.chunks} 块`
            : `未索引${s.reason ? `（${s.reason}）` : ''}`
          return `${i + 1}. ${d.title || d.fileName}｜分类 ${subOf(d)}｜${state}`
        }),
      ]
        .filter(Boolean)
        .join('\n')
    })(),
  })

  const handleFileSelect = () => {
    const files = Array.from(fileRef.current?.files || [])
    if (fileRef.current) fileRef.current.value = ''
    if (files.length) directUploadOrModal(files)
  }

  const handleModalFileSelect = () => {
    const files = Array.from(modalFileRef.current?.files || [])
    if (modalFileRef.current) modalFileRef.current.value = ''
    if (files.length) addFiles(files)
  }

  const handleFilesDropped = (files: File[]) => {
    directUploadOrModal(files)
  }

  /** 格式/大小/重名校验（选文件与直传共用），返回可接受的文件 */
  const validateFiles = (incoming: File[]): File[] => {
    const rejected: string[] = []
    const accepted: File[] = []
    for (const f of incoming) {
      const ext = '.' + (f.name.split('.').pop() || '').toLowerCase()
      if (!ACCEPT_EXTS.includes(ext)) {
        rejected.push(`${f.name}：格式不支持`)
        continue
      }
      if (f.size > MAX_FILE_SIZE) {
        rejected.push(`${f.name}：超过 ${MAX_FILE_SIZE / 1024 / 1024}MB`)
        continue
      }
      if (allDocs.some((d) => d.fileName === f.name)) {
        rejected.push(`${f.name}：库中已存在同名资料，如需更新请先删除旧文件`)
        continue
      }
      accepted.push(f)
    }
    rejected.forEach((r) => toast.error(`已跳过 ${r}`))
    return accepted
  }

  /**
   * 左侧导航选中子类时的直传入口：选好文件直接传到该子类，不开弹窗。
   * 未选中子类时退回弹窗流程（addFiles）。
   */
  const directUploadOrModal = (files: File[]) => {
    if (!activeSub) {
      addFiles(files)
      return
    }
    const valid = validateFiles(files)
    if (valid.length > 0) {
      if (valid.length > MAX_FILE_COUNT) {
        toast.warning(`单次最多 ${MAX_FILE_COUNT} 个文件，已保留前 ${MAX_FILE_COUNT} 个`)
        valid.splice(MAX_FILE_COUNT)
      }
      const subLabel = allCategories.find((c) => c.key === activeSub)?.label || activeSub
      toast.info(`正在上传到「${subLabel}」…`)
      uploadFiles(valid, activeSub)
    }
  }

  /**
   * 新增待上传文件（弹窗流程：选择/拖拽统一入口）。
   * 限制：单个 ≤ 20MB；单批 ≤ 10 个（逐个解析+向量索引，太多等待太久）。后端同步按 20MB 拦截。
   */
  const addFiles = (incoming: File[]) => {
    const accepted = validateFiles(incoming)
    if (accepted.length === 0) return

    setPendingFiles((prev) => {
      // 同名同大小视为重复，不重复加（并提示，避免用户以为没选上）
      const fresh: File[] = []
      const dupNames: string[] = []
      for (const f of accepted) {
        if (prev.some((p) => p.name === f.name && p.size === f.size)) {
          dupNames.push(f.name)
        } else {
          fresh.push(f)
        }
      }
      if (dupNames.length) toast.warning(`已跳过本批中重复的文件：${dupNames.join('、')}`)
      const merged = [...prev, ...fresh]
      if (merged.length > MAX_FILE_COUNT) {
        toast.warning(`单次最多 ${MAX_FILE_COUNT} 个文件，已保留前 ${MAX_FILE_COUNT} 个`)
        return merged.slice(0, MAX_FILE_COUNT)
      }
      return merged
    })
    setUploadModalOpen(true)
  }

  /** 通用上传执行：逐个顺序上传（索引也逐个触发，避免并发压垂 AI 服务）+ 进度 + 刷新 */
  const uploadFiles = async (files: File[], subcategory: string) => {
    setUploading(true)
    setUploadProgress({ done: 0, total: files.length })
    let okCount = 0
    for (const file of files) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('title', file.name)
        formData.append('subcategory', subcategory)
        await documentApi.knowledgeUpload(formData)
        okCount++
      } catch (err: any) {
        toast.error(`${file.name}：${err?.response?.data?.message || err?.message || '上传失败'}`)
      }
      setUploadProgress((p) => (p ? { ...p, done: p.done + 1 } : p))
    }
    queryClient.invalidateQueries({ queryKey: ['knowledge-docs'] })
    if (okCount > 0) {
      toast.success(`已上传 ${okCount} 个文件，正在AI索引...`)
    }
    setUploadProgress(null)
    setUploading(false)
    if (okCount > 0) setTimeout(() => refetch(), 3000)
  }

  const handleUpload = async () => {
    if (pendingFiles.length === 0) return
    await uploadFiles(pendingFiles, uploadSub)
    setUploadModalOpen(false)
    setPendingFiles([])
  }

  const handleIndex = async (id: string, title: string) => {
    setIndexing(id)
    try {
      const result: any = await documentApi.index(id)
      if (result.success) {
        toast.success(`${title}: ${result.message}`)
        notifyIfPermitted('AI 索引完成', `「${title}」${result.message}`)
      } else {
        toast.warning(`${title}: ${result.message}`)
      }
      queryClient.invalidateQueries({ queryKey: ['knowledge-docs'] })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || '索引失败')
    }
    setIndexing(null)
  }

  /** 删除知识资料（确认弹窗里点「删除」后走这里）：软删，进系统回收站保留 30 天 */
  const handleDelete = async (id: string) => {
    setDeletingDocBusy(true)
    try {
      await documentApi.remove(id)
      queryClient.invalidateQueries({ queryKey: ['knowledge-docs'] })
      setDeletingDoc(null)
      toast.success('已删除，可在「系统设置 → 回收站」还原')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || '删除失败')
    } finally {
      setDeletingDocBusy(false)
    }
  }

  const totalChunks = allDocs.reduce((sum, d) => sum + getIndexStatus(d.parsedText).chunks, 0)
  const indexedCount = allDocs.filter((d) => getIndexStatus(d.parsedText).indexed).length

  // 当前页资料：表头全选复选框与列表渲染用同一份口径
  const kbTotalPages = Math.max(1, Math.ceil(filtered.length / kbPageSize))
  const pagedDocs = filtered.slice((kbPage - 1) * kbPageSize, kbPage * kbPageSize)
  const allPageChecked = pagedDocs.length > 0 && pagedDocs.every((d) => kbSelected.includes(d.id))
  const togglePageSelection = () => {
    setKbSelected((prev) =>
      allPageChecked
        ? prev.filter((id) => !pagedDocs.some((d) => d.id === id))
        : [...new Set([...prev, ...pagedDocs.map((d) => d.id)])],
    )
  }
  const toggleDocSelection = (id: string) => {
    setKbSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const setPageActions = usePageActions()
  // 左侧导航可拖拽调宽（宽度存本地，右侧随 flex 伸缩）
  const navPanel = useResizablePanel('aikb-nav-width-knowledge', 230)
  useEffect(() => {
    // 左侧导航选中子类时，顶栏上传直接传到该子类；按钮文案明示目标，避免传错地方
    const targetLabel = activeSub ? (allCategories.find((c) => c.key === activeSub)?.label || activeSub) : ''
    setPageActions(
      <>
        {/*
          「全部」从左侧导航顶部挪到这里：导航要留给分类树，那一行的高度
          在分类多时很吃紧；放顶栏则始终可见，且只在真的处于筛选态时出现。
        */}
        {(activeTab !== 'all' || activeSub) && (
          <button
            onClick={() => { setActiveTab('all'); setActiveSub(null) }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-sm text-ink-soft border border-border hover:border-accent-300 hover:text-accent-600 transition-colors"
            title="清除分类筛选，查看全部知识资料"
          >
            <X size={13} /> 全部
          </button>
        )}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          {/* 非受控：受控 value 会在 IME 组字时被打断（拼音乱码），搜索只靠 onChange 写状态 */}
          <input
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索知识资料…"
            className="eo-input !w-60 !pl-8 !py-1 !text-sm"
          />
        </div>
        <Button
          size="sm"
          className="!py-1 !text-sm"
          onClick={() => fileRef.current?.click()}
          title={activeSub ? `直接上传到「${targetLabel}」（左侧导航已选中）` : '选择文件后在弹窗中确认分类'}
        >
          <Upload size={13} className="mr-0.5" /> {activeSub ? `上传至「${targetLabel}」` : '上传'}
        </Button>
        <input ref={fileRef} type="file" multiple className="hidden" accept={ACCEPT_EXTS.join(',')} onChange={handleFileSelect} />
        {/* 批量操作收到顶栏：列表勾选后才出现，琥珀修改/红色删除一眼可见 */}
        <BatchEditBar
          selectedKeys={kbSelected}
          onClear={() => setKbSelected([])}
          moduleName="资料"
          queryKey={['knowledge-docs']}
          updateFn={(id, dto) => documentApi.update(id, dto)}
          deleteFn={(id) => documentApi.remove(id)}
          fields={[
            { key: 'category', label: '所属分类', options: allCategories.map((c) => ({ value: `knowledge/${c.key}`, label: `${groupLabelOf(c.group)} / ${c.label}` })) },
          ]}
        />
      </>
    )
    return () => setPageActions(null)
     
    // activeTab 也要进依赖：顶栏的「全部」按钮只在筛选态出现，
    // 只切了大类（没选子类）时它同样该显示出来
  }, [activeSub, activeTab, kbSelected])

  return (
    <FileDropZone
      accept={ACCEPT_EXTS}
      maxSize={MAX_FILE_SIZE}
      onFilesDropped={handleFilesDropped}
    >
    <div className="space-y-4">
    {/*
      统计卡片放在整行最上方（横跨左侧导航），与客户中心等页面一致 ——
      原来嵌在右侧内容列里，左侧导航上方空着一块，各模块之间看起来不是一套东西。
    */}
    <StatCards
      loading={isLoading}
      skeletonCount={5}
      items={[
        { label: '知识资料', value: allDocs.length, icon: BookOpen },
        { label: '已索引', value: indexedCount, icon: CheckCircle },
        {
          label: '待索引',
          value: allDocs.length - indexedCount,
          icon: Clock,
          title: '多为扫描件，AI 提不出文字',
        },
        { label: '文本块数', value: totalChunks, icon: FileText },
        {
          label: '分类数',
          value: new Set(allDocs.map(subOf).filter(Boolean)).size,
          icon: FolderTree,
        },
      ]}
    />

    <div className="flex flex-col lg:flex-row gap-4">
      {/*
        左右布局：分类是长期存在的结构，当导航常驻左侧。
        原来是横向标签条，分类一多就挤成一条滚动带，
        还得配增删按钮，横着排根本放不下。
      */}
      <aside className="lg:w-[230px] flex-shrink-0" style={navPanel.panelStyle}>
        <div className="eo-card p-3 lg:sticky lg:top-4 space-y-3">
          {/* 「全部」已挪到顶栏（见 setPageActions）：左侧要留给分类树 */}
          <div className="space-y-0.5">
            {pagedTabs.map((tab, i) => {
              const gIdx = (navPage - 1) * navPageSize + i
              const subs = allCategories.filter((c) => c.group === tab.key)
              const expanded = !collapsedGroups.includes(tab.key)
              return (
                <div key={tab.key}>
                  <div className="group/tab flex items-center">
                    {/*
                      展开/收起子类：放在最左边，与客户资料页的公司树对齐 ——
                      小三角是"这一行有下级"的层级标记，跟在名称后面看着像操作按钮。
                      也可双击大类名称切换。
                    */}
                    <button
                      onClick={() => toggleGroup(tab.key)}
                      className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-accent-600 shrink-0"
                      title={expanded ? '收起子类' : '展开子类'}
                    >
                      <ChevronRight size={11} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
                    </button>
                    {renamingGroup === tab.key ? (
                      // 改名中：内联输入框，Enter 保存，Esc/失焦取消
                      <input
                        autoFocus
                        value={renameGroupValue}
                        onChange={(e) => setRenameGroupValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameGroup(tab.key)
                          if (e.key === 'Escape') { setRenamingGroup(null) }
                        }}
                        onBlur={() => setRenamingGroup(null)}
                        className="flex-1 min-w-0 px-2 py-1 text-xs border border-accent-300 rounded-md bg-surface outline-none focus:border-accent-500"
                      />
                    ) : (
                      <button
                        onClick={() => { setActiveTab(tab.key); setActiveSub(null) }}
                        onDoubleClick={() => toggleGroup(tab.key)}
                        className={`flex-1 min-w-0 flex items-center justify-between px-2.5 py-1.5 rounded-md text-body-sm transition-colors ${
                          activeTab === tab.key && !activeSub ? 'bg-accent-50 text-accent-700 font-medium' : 'text-ink-soft hover:bg-canvas'
                        }`}
                      >
                        <span className="truncate text-left">{tab.label}</span>
                        <span className="text-caption text-muted shrink-0 ml-1">{tab.count}</span>
                      </button>
                    )}
                    {/* 重命名（基础大类只改展示标签，自定义大类会后端级联） */}
                    {renamingGroup !== tab.key && (
                      <button
                        onClick={() => { setRenamingGroup(tab.key); setRenameGroupValue(groupLabelOf(tab.key)) }}
                        className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/tab:opacity-100 transition-opacity shrink-0"
                        title={`重命名「${tab.label}」`}
                      >
                        <Pencil size={10} />
                      </button>
                    )}
                    {/* 新增子类（基础/自定义大类都可加） */}
                    <button
                      onClick={() => {
                        setAddingSubFor(tab.key)
                        setNewNavSubName('')
                        if (!expanded) setCollapsedGroups((prev) => prev.filter((g) => g !== tab.key))
                      }}
                      className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/tab:opacity-100 transition-opacity shrink-0"
                      title={`在「${tab.label}」下新增子类`}
                    >
                      <Plus size={11} />
                    </button>
                    {/* 上下移动（顺序仅为浏览偏好，随 groups 数组持久化） */}
                    <button
                      onClick={() => moveGroup(tab.key, -1)}
                      disabled={gIdx === 0}
                      className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/tab:opacity-100 transition-opacity shrink-0 disabled:invisible"
                      title="大类上移"
                    >
                      <ChevronUp size={11} />
                    </button>
                    <button
                      onClick={() => moveGroup(tab.key, 1)}
                      disabled={gIdx === groupTabs.length - 1}
                      className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/tab:opacity-100 transition-opacity shrink-0 disabled:invisible"
                      title="大类下移"
                    >
                      <ChevronDown size={11} />
                    </button>
                    <button
                      onClick={() => requestDeleteGroup(tab.key)}
                      className="w-5 h-5 flex items-center justify-center rounded text-muted hover:text-danger-fg opacity-0 group-hover/tab:opacity-100 transition-opacity shrink-0"
                      title={`删除「${tab.label}」`}
                    >
                      <X size={11} />
                    </button>
                  </div>
                  {/* 子类：点击 = 筛选列表 + 设为顶栏直传目标 */}
                  {expanded && (
                    <div className="ml-2.5 pl-2 border-l border-border space-y-0.5 py-0.5">
                      {subs.map((sub, subIdx) => {
                        const subCount = allDocs.filter((d) => {
                          const s = d.category?.includes('/') ? d.category.split('/')[1] : 'other'
                          return s === sub.key
                        }).length
                        const isRenaming = renamingSub?.group === tab.key && renamingSub.name === sub.key
                        return (
                          <div key={sub.key} className="group/sub flex items-center">
                            {isRenaming ? (
                              <input
                                autoFocus
                                value={renameSubValue}
                                onChange={(e) => setRenameSubValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleRenameSub(tab.key, sub.key)
                                  if (e.key === 'Escape') { setRenamingSub(null) }
                                }}
                                onBlur={() => setRenamingSub(null)}
                                className="flex-1 min-w-0 px-2 py-0.5 text-caption border border-accent-300 rounded-md bg-surface outline-none focus:border-accent-500"
                              />
                            ) : (
                              <button
                                onClick={() => { setActiveTab(tab.key); setActiveSub(sub.key) }}
                                className={`flex-1 min-w-0 flex items-center justify-between px-2 py-1 rounded-md text-caption transition-colors ${
                                  activeSub === sub.key ? 'bg-accent-50 text-accent-700 font-medium' : 'text-ink-soft hover:bg-canvas'
                                }`}
                                title={activeSub === sub.key ? `已选中：顶栏上传将直接传到「${sub.label}」` : '点击筛选该子类，并设为直接上传目标'}
                              >
                                <span className="truncate text-left">{sub.label}</span>
                                <span className="text-muted shrink-0 ml-1">{subCount}</span>
                              </button>
                            )}
                            {/* 重命名（基础子类只改展示标签，自定义子类会后端级联） */}
                            {!isRenaming && (
                              <button
                                onClick={() => { setRenamingSub({ group: tab.key, name: sub.key }); setRenameSubValue(sub.label) }}
                                className="w-4 h-4 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/sub:opacity-100 transition-opacity shrink-0"
                                title={`重命名「${sub.label}」`}
                              >
                                <Pencil size={9} />
                              </button>
                            )}
                            {/* 上下移动（顺序仅为浏览偏好，不改分类存储值） */}
                            {!isRenaming && (
                              <>
                                <button
                                  onClick={() => moveSub(tab.key, sub.key, -1)}
                                  disabled={subIdx === 0}
                                  className="w-4 h-4 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/sub:opacity-100 transition-opacity shrink-0 disabled:invisible"
                                  title="上移"
                                >
                                  <ChevronUp size={9} />
                                </button>
                                <button
                                  onClick={() => moveSub(tab.key, sub.key, 1)}
                                  disabled={subIdx === subs.length - 1}
                                  className="w-4 h-4 flex items-center justify-center rounded text-muted hover:text-accent-600 opacity-0 group-hover/sub:opacity-100 transition-opacity shrink-0 disabled:invisible"
                                  title="下移"
                                >
                                  <ChevronDown size={9} />
                                </button>
                              </>
                            )}
                          </div>
                        )
                      })}
                      {/* 内联新增子类：Enter 确认，Esc/失焦取消 */}
                      {addingSubFor === tab.key && (
                        <input
                          autoFocus
                          value={newNavSubName}
                          onChange={(e) => setNewNavSubName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddNavSub(tab.key)
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

          {/* 新增/重置分类 */}
          <div className="pt-2 border-t border-border">
            {showAddInput ? (
              <div className="flex items-center gap-1">
                <input
                  ref={addInputRef}
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddGroup(); if (e.key === 'Escape') { setShowAddInput(false); setNewGroupName('') } }}
                  placeholder="分类名"
                  className="flex-1 min-w-0 px-2 py-1 text-xs border border-accent-300 rounded-md bg-surface outline-none focus:border-accent-500"
                  autoFocus
                />
                <button onClick={handleAddGroup} className="w-6 h-6 flex items-center justify-center rounded bg-accent-500 text-white shrink-0" title="确认">
                  <CheckCircle size={12} />
                </button>
                <button onClick={() => { setShowAddInput(false); setNewGroupName('') }} className="w-6 h-6 flex items-center justify-center rounded bg-canvas text-muted shrink-0" title="取消">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => { setShowAddInput(true); setTimeout(() => addInputRef.current?.focus(), 50) }}
                  className="flex items-center gap-1 text-caption text-muted hover:text-accent-600 transition-colors"
                >
                  <Plus size={12} /> 添加分类
                </button>
                {!DEFAULT_GROUPS.every((g) => groups.includes(g)) && (
                  <button onClick={handleResetGroups} className="text-caption text-muted hover:text-accent-600">
                    重置
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
      <ResizeHandle onMouseDown={navPanel.startDrag} />

      <div className="flex-1 min-w-0 space-y-4">

      {/* Group Tabs + Add button */}
      {/* Document list */}
      {isLoading && <PageLoader />}
      {isError && <ErrorState message={error?.message} onRetry={refetch} />}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="bg-surface rounded-xl border border-border p-12">
          <EmptyState
            title={activeTab === 'all' ? '知识库为空' : '该分类下暂无资料'}
            description="上传产品手册、技术标准、培训资料等，系统将自动AI结构化处理，供智能问答检索"
          />
        </div>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <>
        {/* 表头：与下方行的列结构对齐（勾选 / 状态 / 文件名 / 分类 / 大类 / 大小 / 索引 / 操作） */}
        <div className="flex items-center gap-2.5 px-3 pb-1 text-caption text-muted border-b border-border">
          <div className="w-5 flex-shrink-0 text-center">
            <input
              type="checkbox"
              checked={allPageChecked}
              onChange={togglePageSelection}
              className="w-3.5 h-3.5 accent-accent-600 cursor-pointer align-middle"
              title="全选当前页"
              aria-label="全选当前页"
            />
          </div>
          <div className="w-6 flex-shrink-0 text-center">状态</div>
          <div className="flex-1 min-w-0">文件名</div>
          <div className="hidden md:block w-[90px] flex-shrink-0">分类</div>
          <div className="hidden lg:block w-[80px] flex-shrink-0">大类</div>
          <div className="w-[52px] flex-shrink-0">大小</div>
          <div className="w-[64px] flex-shrink-0">索引</div>
          <div className="w-[150px] flex-shrink-0 text-right pr-1">操作</div>
        </div>
        <div className="space-y-1">
          {pagedDocs.map((doc) => {
            const { indexed, chunks, reason } = getIndexStatus(doc.parsedText)
            const sub = doc.category?.includes('/') ? doc.category.split('/')[1] : 'other'
            const group = allCategories.find((c) => c.key === sub)?.group || '其他'
            const checked = kbSelected.includes(doc.id)
            return (
              <div key={doc.id} className={`bg-surface rounded-lg border px-3 py-1 flex items-center gap-2.5 hover:shadow-sm transition-shadow ${checked ? 'border-accent-300 bg-accent-50/60' : 'border-border'}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleDocSelection(doc.id)}
                  className="w-3.5 h-3.5 accent-accent-600 cursor-pointer flex-shrink-0"
                  aria-label={`选择 ${doc.title}`}
                />
                <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${indexed ? 'bg-success-fg/10' : 'bg-canvas'}`}>
                  {indexed ? <CheckCircle size={13} className="text-success-fg" /> : <Clock size={13} className="text-muted" />}
                </div>
                {/* 单行：标题占剩余宽度截断，文件名放在 tooltip 里 */}
                <span className="flex-1 min-w-0 text-sm font-medium text-ink truncate" title={doc.fileName}>
                  {doc.title}
                </span>
                <span className={`hidden md:inline text-[9px] px-1.5 py-px rounded-full border whitespace-nowrap flex-shrink-0 ${catColor(doc.category, allCategories)}`}>
                  {catLabel(doc.category, allCategories)}
                </span>
                <span className="hidden lg:inline text-[9px] px-1.5 py-px rounded-full bg-subtle text-muted border border-border whitespace-nowrap flex-shrink-0">
                  {group}
                </span>
                <span className="text-caption text-muted whitespace-nowrap flex-shrink-0">
                  {doc.fileSize >= 1024 * 1024 ? `${(doc.fileSize / 1024 / 1024).toFixed(1)}MB` : `${(doc.fileSize / 1024).toFixed(0)}KB`}
                </span>
                <span className="whitespace-nowrap flex-shrink-0">
                  {doc.status === 'pending' ? (
                    <span className="text-caption text-warning-fg flex items-center gap-0.5" title="请在审批中心审核，审核前不会进行 AI 索引"><Clock size={10} /> 待审核</span>
                  ) : indexed ? (
                    <span className="text-caption text-success-fg flex items-center gap-0.5"><CheckCircle size={10} /> {chunks} 块</span>
                  ) : reason === 'scanned_pdf' ? (
                    <span className="text-caption text-warning-fg flex items-center gap-0.5"><AlertCircle size={10} /> 扫描件</span>
                  ) : (
                    <span className="text-caption text-warning-fg flex items-center gap-0.5"><AlertCircle size={10} /> 待索引</span>
                  )}
                </span>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button onClick={() => handleIndex(doc.id, doc.title)} disabled={indexing === doc.id || doc.status === 'pending'} className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-accent-600 hover:bg-accent-50 transition-colors disabled:opacity-50" title={doc.status === 'pending' ? '人工审核通过后可索引' : '重新AI索引'}>
                    <RefreshCw size={13} className={indexing === doc.id ? 'animate-spin' : ''} />
                  </button>
                  {/*
                    不再看 fileUrl：那是历史遗留的 http://localhost:3001/uploads/... 直链，
                    后端早已撤掉静态目录，点开只会得到"localhost 拒绝了连接请求"。
                    预览与下载一律走带鉴权的 /api/files/documents/:id。
                  */}
                  <button onClick={() => setPreviewDoc(doc)} className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-info-fg hover:bg-info-bg transition-colors" title="预览">
                    <Scan size={13} />
                  </button>
                  <button
                    onClick={() => { setMoveTarget(doc); setMoveCategory(doc.category || '') }}
                    className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-accent-600 hover:bg-accent-50 transition-colors"
                    title="移动分类"
                  >
                    <FolderInput size={13} />
                  </button>
                  <button
                    onClick={() =>
                      downloadFile('documents', doc.id, doc.fileName || doc.title).catch((e: any) =>
                        toast.error(e?.message || '下载失败'),
                      )
                    }
                    className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-ink hover:bg-canvas transition-colors"
                    title="下载"
                  >
                    <Download size={13} />
                  </button>
                  <button onClick={() => setDeletingDoc(doc)} className="w-6 h-6 flex items-center justify-center rounded text-muted hover:text-danger-fg hover:bg-danger-bg transition-colors" title="删除">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        {/* 分页：每页条数 10/15/20 可选，与其它列表页保持一致 */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-center gap-2 mt-3 text-sm">
            <button
              onClick={() => setKbPage(p => Math.max(1, p - 1))}
              disabled={kbPage === 1}
              className="px-3 py-1 rounded border border-border text-muted hover:text-ink hover:bg-canvas disabled:opacity-40"
            >
              上一页
            </button>
            <span className="text-muted">
              共 {filtered.length} 条，第 {kbPage} / {kbTotalPages} 页
            </span>
            <button
              onClick={() => setKbPage(p => Math.min(kbTotalPages, p + 1))}
              disabled={kbPage >= kbTotalPages}
              className="px-3 py-1 rounded border border-border text-muted hover:text-ink hover:bg-canvas disabled:opacity-40"
            >
              下一页
            </button>
            <select
              value={kbPageSize}
              onChange={(e) => { setKbPageSize(Number(e.target.value)); setKbPage(1) }}
              className="px-1.5 py-0.5 border border-border rounded bg-surface text-xs text-ink-soft"
              aria-label="每页显示条数"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} 条/页</option>
              ))}
            </select>
          </div>
        )}
        </>
      )}
      </div>

      {/* Upload Modal */}
      <Modal
        open={uploadModalOpen}
        onClose={() => { if (!uploading) { setUploadModalOpen(false); setPendingFiles([]) } }}
        title="上传知识资料"
        onConfirm={handleUpload}
        loading={uploading}
        confirmText={uploading && uploadProgress ? `正在上传 ${uploadProgress.done}/${uploadProgress.total}…` : `上传 ${pendingFiles.length} 个文件并AI索引`}
        confirmDisabled={pendingFiles.length === 0}
        size="md"
      >
        <div className="space-y-5">
          {/* 拖拽/点选区：继续添加文件 */}
          <div
            onClick={() => modalFileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const files = Array.from(e.dataTransfer?.files || [])
              if (files.length) addFiles(files)
            }}
            className="cursor-pointer rounded-xl border-2 border-dashed border-border hover:border-accent-400 hover:bg-accent-50/30 transition-colors p-6 flex flex-col items-center text-center"
          >
            <Upload size={22} className="text-muted mb-1.5" />
            <p className="text-sm text-ink-soft">拖拽文件到此处，或点击选择（可多选）</p>
            <p className="text-xs text-muted mt-1">
              支持 {ACCEPT_EXTS.join(' / ')}；单个 ≤ {MAX_FILE_SIZE / 1024 / 1024}MB，单次 ≤ {MAX_FILE_COUNT} 个
            </p>
            <input
              ref={modalFileRef}
              type="file"
              multiple
              className="hidden"
              accept={ACCEPT_EXTS.join(',')}
              onChange={() => {
                handleModalFileSelect()
              }}
            />
          </div>

          {/* 待上传列表 */}
          {pendingFiles.length > 0 && (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {pendingFiles.map((f, i) => (
                <div key={`${f.name}-${i}`} className="flex items-center gap-2 bg-canvas rounded-lg px-3 py-2">
                  <FileText size={16} className="text-accent-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink truncate">{f.name}</div>
                    <div className="text-xs text-muted">
                      {f.size >= 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : `${(f.size / 1024).toFixed(0)} KB`}
                    </div>
                  </div>
                  <button
                    onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="p-1 rounded text-muted hover:text-danger-fg flex-shrink-0"
                    title="移除"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div>
            {/* 分类决定 AI 索引时的归属，选错了后面检索会串味 */}
            <label className="text-sm font-medium text-ink block mb-2">资料分类</label>
            <div className="flex flex-wrap gap-2">
              {allGroups.map((g) => (
                <button
                  key={g}
                  onClick={() => {
                    setUploadGroup(g)
                    const firstSub = allCategories.find((c) => c.group === g)
                    setUploadSub(firstSub?.key || g)
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    uploadGroup === g ? 'border-accent-500 bg-accent-50 text-accent-700' : 'border-border text-ink-soft hover:bg-canvas'
                  }`}
                >
                  {groupLabelOf(g)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted block mb-2 flex items-center gap-1">
              {groupLabelOf(uploadGroup)} <ChevronRight size={12} /> 选择子分类
            </label>
            <div className="grid grid-cols-2 gap-2">
              {currentSubs.map((sub) => (
                <button
                  key={sub.key}
                  onClick={() => setUploadSub(sub.key)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors text-left ${
                    uploadSub === sub.key ? 'border-accent-500 bg-accent-50 text-accent-700' : 'border-border text-ink-soft hover:bg-canvas'
                  }`}
                >
                  {sub.label}
                </button>
              ))}
            </div>
            {/* 自定义大类：支持现场新建子类，选完子类再上传 */}
            {!BASE_GROUPS.includes(uploadGroup) && (
              <div className="mt-2.5">
                {currentSubs.length === 1 && currentSubs[0]?.key === uploadGroup && (
                  <p className="text-xs text-warning-fg mb-1.5">该大类还没有子分类，建议先新建子类再上传，便于后续精准检索</p>
                )}
                <div className="flex items-center gap-2">
                  <input
                    value={newSubName}
                    onChange={(e) => setNewSubName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddSub() }}
                    placeholder={`新建子分类（如：设备图纸、客户资料…）`}
                    className="eo-input !py-1.5 !text-sm flex-1"
                  />
                  <Button size="sm" className="!py-1.5 !text-sm" onClick={handleAddSub} disabled={!newSubName.trim()}>
                    <Plus size={13} className="mr-0.5" /> 添加子类
                  </Button>
                </div>
              </div>
            )}
          </div>
          <p className="text-xs text-muted">上传后系统将自动解析文件内容、分块索引到AI知识库，供智能问答检索。</p>
        </div>
      </Modal>

      {/*
        删除确认。
        资料删除是软删（进系统回收站保留 30 天），文案照实说，
        不要写成"不可恢复"吓人，也别漏掉"AI 检索不到了"这个即时后果。
      */}
      <ConfirmDialog
        open={!!deletingDoc}
        onClose={() => setDeletingDoc(null)}
        onConfirm={() => deletingDoc && handleDelete(deletingDoc.id)}
        loading={deletingDocBusy}
        message={<>确定删除知识资料「{deletingDoc?.title || deletingDoc?.fileName}」吗？</>}
        detail="删除后进入系统回收站，保留 30 天内可还原；期间它的 AI 索引会被清除，问答检索不到这份资料。"
      />

      {/* 移动文件到其他分类 */}
      <Modal
        open={!!moveTarget}
        onClose={() => { setMoveTarget(null); setMoveCategory('') }}
        title={`移动「${moveTarget?.title || moveTarget?.fileName || ''}」`}
        onConfirm={() => moveMutation.mutate()}
        loading={moveMutation.isPending}
        confirmText="移动"
        confirmDisabled={!moveCategory}
        size="sm"
      >
        <div className="space-y-2">
          <label className="block eo-label">目标分类</label>
          <select
            value={moveCategory}
            onChange={(e) => setMoveCategory(e.target.value)}
            className="eo-input"
          >
            {allCategories.map((c) => (
              <option key={c.key} value={`${c.group}/${c.key}`}>
                {groupLabelOf(c.group)} / {c.label}
              </option>
            ))}
          </select>
          <p className="text-caption text-muted">移动后该文件归属新分类，左侧导航计数随之更新。</p>
        </div>
      </Modal>

      {/* 分类删除确认：只删导航上的分类，不动任何文件 */}
      <ConfirmDialog
        open={!!deletingGroup}
        onClose={() => setDeletingGroup(null)}
        onConfirm={() => deletingGroup && handleDeleteGroup(deletingGroup)}
        title="确认删除分类"
        message={<>确定删除分类「{deletingGroup}」吗？</>}
        detail="该分类下已没有资料，删除只影响左侧导航结构，不会删除任何文件。"
      />

      {/* 文件预览 */}
      <FilePreview
        isOpen={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        fileName={previewDoc?.fileName || ''}
        mimeType={previewDoc?.mimeType}
        fileSize={previewDoc?.fileSize}
        fileKind="documents"
        fileId={previewDoc?.id}
        // 翻阅范围＝当前筛选后的资料，与用户眼前看到的一致
        siblings={filtered as any}
        onNavigate={(item) => setPreviewDoc(item as any)}
      />
    </div>
    </div>
    </FileDropZone>
  )
}
