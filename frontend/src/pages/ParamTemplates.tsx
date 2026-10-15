import { useMemo, useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { usePageActions } from '../contexts/PageActionsContext'
import {
  Search,
  X,
  Plus,
  Pencil,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Box,
  SlidersHorizontal,
  Ruler,
  Trash2,
  Code,
  FolderInput,
  ListTree,
  Rows3,
  CheckCircle2,
} from 'lucide-react'
import { paramTemplateApi } from '../api/services'
import { useFormValidation, required } from '../hooks/useFormValidation'
import { useResizablePanel, ResizeHandle } from '../hooks/useResizablePanel'
import { useNavPageSize, clampNavPage } from '../hooks/useNavPageSize'
import type { ParamTemplate } from '../types'
import Button from '../components/Button'
import Modal from '../components/Modal'
import FormSelect from '../components/FormSelect'
import FormTextarea from '../components/FormTextarea'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import StatusBadge from '../components/StatusBadge'
import NavPager from '../components/NavPager'
import FieldEditorModal, { typeLabel, type TemplateField } from '../components/FieldEditorModal'
import StatCards from '../components/StatCards'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'

const initialForm = { category: '', fields: '', status: 'draft' }

/**
 * 字段定义留空时送合法的空数组。
 *
 * 之前留空送的是 '' ，后端 JSON.parse('') 直接抛错，
 * 回一句「fields 必须是合法的 JSON 数组字符串」——
 * 于是“先建模板、字段稍后在表格里加”这条最自然的路子根本走不通。
 */
const normalizeFields = (raw: string) => (raw.trim() === '' ? '[]' : raw.trim())


const statusOptions = [
  { value: 'draft', label: '草稿' },
  { value: 'approved', label: '启用' },
  { value: 'archived', label: '归档' },
]

const fieldsPlaceholder = '[\n  {"key":"diameter","label":"直径","unit":"mm","type":"number","required":true}\n]'

const categoryIcons: Record<string, typeof Box> = {
  '零部件': Ruler,
  '装备': Box,
  '产线': SlidersHorizontal,
  '新产品': Plus,
}

function parseFields(raw?: string): any[] {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

interface TreeLeafNode {
  /** 三级名，如「重载联轴器」 */
  name: string
  fullName: string
  template: ParamTemplate
}

interface TreeSubNode {
  subCategory: string
  fullName: string
  /** 子类自身的模板；三级分类下子类可能只是分组，没有自己的模板 */
  template: ParamTemplate | null
  /** 三级分类。两级分类时为空数组 */
  children: TreeLeafNode[]
}
interface TreeParentNode {
  parent: string
  subs: TreeSubNode[]
  expanded: boolean
}

export default function ParamTemplates() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const setPageActions = usePageActions()
  // 左侧模板树可拖拽调宽（宽度存本地，右侧随 flex 伸缩）
  const navPanel = useResizablePanel('aikb-nav-width-param-templates', 260)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 「全部」视图：右侧总览所有模板；入口在顶栏（原来在左侧导航顶部） */
  const [viewAll, setViewAll] = useState(true)
  const pickTemplate = (id: string) => {
    setViewAll(false)
    setSelectedId(id)
  }

  /*
   * 顶栏操作区。
   *
   * 必须放在 viewAll / selectedId 声明**之后** —— 里面要读这两个状态，
   * 放在前面会撞上暂时性死区。原来它在最上面且依赖数组为空，
   * 是因为那时不需要读任何状态。
   */
  useEffect(() => {
    setPageActions(
      <>
        {/* 「全部」从左侧导航顶部挪到这里：左侧要留给分类树 */}
        {!viewAll && (
          <button
            onClick={() => { setViewAll(true); setSelectedId(null) }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-sm text-ink-soft border border-border hover:border-accent-300 hover:text-accent-600 transition-colors"
            title="返回全部模板总览"
          >
            <X size={13} /> 全部
          </button>
        )}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            placeholder="搜索模板…"
            onChange={(e) => setSearch(e.target.value)}
            className="eo-input !w-60 !pl-8 !py-1 !text-sm"
          />
        </div>
        <Button onClick={() => openCreate()} size="sm" className="!py-1 !text-sm">
          <Plus size={13} className="mr-0.5" /> 新建模板
        </Button>
      </>
    )
    return () => setPageActions(null)
     
  }, [viewAll])
  /*
   * 记「收起的大类」而不是「展开的大类」：默认全部展开。
   * 原来写死 ['零部件','装备'] 两个，后来新建的大类进来一律是收起的，
   * 用户以为分类丢了；存收起集就没有这个问题。
   */
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['来料信息', '设备信息']))
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ParamTemplate | null>(null)
  const [subOrders, setSubOrders] = useState<Record<string, string[]>>({})
  /** 三级子项顺序，key 为子类全路径（如 零部件/联轴器），value 为叶子名数组 */
  const [leafOrders, setLeafOrders] = useState<Record<string, string[]>>({})
  const [parentOrderState, setParentOrderState] = useState<string[]>([])
  const [movingSub, setMovingSub] = useState<{ template: ParamTemplate; sub: string } | null>(null)
  const [moveTargetParent, setMoveTargetParent] = useState('')

  // 右侧「全部」总览：按大类分页（每页一个大类，组内子类分组+卡片，底部翻大类）。
  // 此前是 71 张卡片平铺、无分组无翻页，查询不便。
  const [allViewPage, setAllViewPage] = useState(1)
  // 「全部」视图里收起的子类（按 sub.fullName），默认全部展开
  const [collapsedAllSubs, setCollapsedAllSubs] = useState<Set<string>>(new Set())

  // 左侧大类「+」添加子类：内联输入。参考业务资料左侧导航的同款交互。
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null)
  const [newSubName, setNewSubName] = useState('')
  const handleAddSub = async (parent: string) => {
    const name = newSubName.trim()
    setAddingSubFor(null)
    setNewSubName('')
    if (!name) return
    if (name.includes('/')) { toast.error('名称不能包含 /'); return }
    const category = `${parent}/${name}`
    if (allTemplates.some((t) => t.category === category)) { toast.warning('该子类已存在'); return }
    try {
      // 添加子类 = 在该大类下新建一个空模板（草稿）。后续可在详情页补字段或加末级。
      await paramTemplateApi.create({ category, fields: '[]', status: 'draft' })
      await queryClient.invalidateQueries({ queryKey: ['param-templates'] })
      toast.success(`子类「${name}」已添加到「${parent}」`)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || '添加失败')
    }
  }

  // 子类（分组节点，如 联轴器）「+」添加末级：在 大类/子类 下新建末级模板。
  const [addingGrandSubFor, setAddingGrandSubFor] = useState<string | null>(null)
  const [newGrandSubName, setNewGrandSubName] = useState('')
  const handleAddGrandSub = async (subFullName: string) => {
    const name = newGrandSubName.trim()
    setAddingGrandSubFor(null)
    setNewGrandSubName('')
    if (!name) return
    if (name.includes('/')) { toast.error('名称不能包含 /'); return }
    const category = `${subFullName}/${name}`
    if (allTemplates.some((t) => t.category === category)) { toast.warning('该末级已存在'); return }
    try {
      await paramTemplateApi.create({ category, fields: '[]', status: 'draft' })
      await queryClient.invalidateQueries({ queryKey: ['param-templates'] })
      toast.success(`末级「${name}」已添加`)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || '添加失败')
    }
  }

  // 字段级编辑
  const [fieldModalOpen, setFieldModalOpen] = useState(false)
  const [editingField, setEditingField] = useState<TemplateField | null>(null)
  const [newFieldSection, setNewFieldSection] = useState<string | undefined>()
  const [deletingField, setDeletingField] = useState<TemplateField | null>(null)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonDraft, setJsonDraft] = useState('')

  // 模板级删除（两段式：先问后端有多少需求在引用，再确认）
  const [deletingTemplate, setDeletingTemplate] = useState<ParamTemplate | null>(null)
  const [usageCount, setUsageCount] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('aikb-param-template-order')
      if (saved) setSubOrders(JSON.parse(saved))
      const savedLeaves = localStorage.getItem('aikb-param-template-leaf-order')
      if (savedLeaves) setLeafOrders(JSON.parse(savedLeaves))
      const savedParents = localStorage.getItem('aikb-param-template-parent-order')
      if (savedParents) setParentOrderState(JSON.parse(savedParents))
    } catch {
      // 本地排序偏好损坏或读不到时忽略，退回默认顺序即可
    }
  }, [])

  const { values: form, errors, isValid, setValue, setValues, validateAll, reset } = useFormValidation({
    initialValues: initialForm,
    rules: { category: required('请选择分类') },
  })

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['param-templates'],
    queryFn: () => paramTemplateApi.list(),
  })

  const allTemplates = useMemo(() => {
    const list = Array.isArray(data) ? data : data?.list || []
    return list as ParamTemplate[]
  }, [data])

  const selectedTemplate = useMemo(
    () => allTemplates.find((t) => t.id === selectedId) || null,
    [allTemplates, selectedId],
  )

  /** 模板字段数：「全部」总览卡片用，解析失败算 0 */
  const fieldCountOf = (t: ParamTemplate) => {
    try {
      const parsed = JSON.parse(t.fields || '[]')
      return Array.isArray(parsed) ? parsed.length : 0
    } catch {
      return 0
    }
  }

  /*
   * 页面助手上下文。
   *
   * 选中某个模板时，把它的字段逐条展开送进去 —— 用户在这一页最常问的就是
   * "这个模板要填哪些参数""还缺什么"，只给模板名字答不了。
   *
   * 注意必须放在 fieldCountOf 之后：context 是立即求值的 IIFE，
   * 引用还没初始化的 const 会撞上暂时性死区。
   */
  useRegisterPageAssistant({
    key: 'param-templates',
    label: '需求模板',
    sourceTypes: ['requirement', 'solution', 'product'],
    questions: [
      '当前选中的模板需要填哪些参数？',
      '这个大类下有哪些模板，分别用在什么场景？',
      '对比两个模板，参数差异在哪？',
      '哪些模板的字段偏少、可能不够用？',
      '按这个模板，客户还需要补充什么信息？',
    ],
    context: (() => {
      const lines: string[] = [
        `页面：需求模板（共 ${allTemplates.length} 个模板）`,
        search ? `搜索关键词：${search}` : '',
      ]
      if (selectedTemplate) {
        lines.push(
          `当前选中模板：${selectedTemplate.category || '—'}` +
            `（版本 ${selectedTemplate.version ?? '—'}｜状态 ${selectedTemplate.status || '—'}）`,
        )
        try {
          const fields = JSON.parse(selectedTemplate.fields || '[]')
          if (Array.isArray(fields) && fields.length) {
            lines.push('该模板的参数字段：')
            lines.push(
              ...fields
                .slice(0, 60)
                .map(
                  (f: any, i: number) =>
                    `  ${i + 1}. ${f.label || f.key || ''}${f.unit ? `（${f.unit}）` : ''}` +
                    `${f.type ? `｜${f.type}` : ''}${f.required ? '｜必填' : ''}` +
                    `${Array.isArray(f.options) && f.options.length ? `｜可选 ${f.options.slice(0, 6).join('/')}` : ''}`,
                ),
            )
          }
        } catch {
          // 字段是坏 JSON 时不影响其余上下文
        }
      }
      lines.push('模板清单：')
      lines.push(
        ...allTemplates
          .slice(0, 40)
          .map(
            (t, i) =>
              `${i + 1}. ${t.category || '—'}｜${fieldCountOf(t)} 个字段｜状态 ${t.status || '—'}`,
          ),
      )
      return lines.filter(Boolean).join('\n')
    })(),
  })

  // 模板全量在前端，卡片与左侧分类树同源
  const templateCards = useMemo(() => {
    const cats = allTemplates.map((t) => t.category).filter(Boolean) as string[]
    const fieldCount = allTemplates.reduce((sum, t) => {
      try {
        const parsed = JSON.parse(t.fields || '[]')
        return sum + (Array.isArray(parsed) ? parsed.length : 0)
      } catch {
        return sum
      }
    }, 0)
    return [
      { label: '模板总数', value: allTemplates.length, icon: SlidersHorizontal },
      { label: '大类', value: new Set(cats.map((c) => c.split('/')[0])).size, icon: Box },
      { label: '细分分类', value: new Set(cats).size, icon: ListTree },
      { label: '参数字段', value: fieldCount, icon: Rows3 },
      {
        label: '启用中',
        value: allTemplates.filter((t) => !t.status || t.status === 'active' || t.status === 'approved').length,
        icon: CheckCircle2,
      },
    ]
  }, [allTemplates])

  const tree = useMemo(() => {
    const filtered = search
      ? allTemplates.filter((t) => t.category?.toLowerCase().includes(search.toLowerCase()))
      : allTemplates

    const parentOrder = parentOrderState.length ? parentOrderState : ['零部件', '装备', '生产线', '新产品']
    const parentMap = new Map<string, TreeSubNode[]>()

    /*
     * 分类支持两级和三级混用：
     *   装备/矫直设备            —— 两级，子类自己就是模板
     *   零部件/联轴器/重载联轴器  —— 三级，子类是分组，模板挂在第三级
     * 两者可以共存：「零部件/联轴器」有自己的模板，同时下面还挂着若干三级细分。
     */
    for (const t of filtered) {
      const cat = t.category || '其他'
      const parts = cat.split('/').map((x) => x.trim()).filter(Boolean)
      const parent = parts[0] || cat
      const sub = parts[1] || ''
      const leaf = parts[2] || ''

      if (!parentMap.has(parent)) parentMap.set(parent, [])
      const subs = parentMap.get(parent)!
      let node = subs.find((x) => x.subCategory === sub)
      if (!node) {
        node = { subCategory: sub, fullName: `${parent}/${sub}`, template: null, children: [] }
        subs.push(node)
      }

      if (leaf) node.children.push({ name: leaf, fullName: cat, template: t })
      else node.template = t
    }

    const allParents = [...parentOrder, ...Array.from(parentMap.keys()).filter((p) => !parentOrder.includes(p))]
    const nodes: TreeParentNode[] = []
    for (const parent of allParents) {
      const subs = parentMap.get(parent)
      if (!subs) continue
      const order = subOrders[parent]
      if (order && order.length > 0) {
        subs.sort((a, b) => {
          const ia = order.indexOf(a.subCategory)
          const ib = order.indexOf(b.subCategory)
          return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
        })
      } else {
        subs.sort((a, b) => (a.subCategory < b.subCategory ? -1 : 1))
      }
      subs.forEach((x) => {
        // 三级子项顺序：有手动排序就用它，否则按名称排序
        const leafOrder = leafOrders[x.fullName]
        if (leafOrder && leafOrder.length > 0) {
          x.children.sort((a, b) => {
            const ia = leafOrder.indexOf(a.name)
            const ib = leafOrder.indexOf(b.name)
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
          })
        } else {
          x.children.sort((a, b) => (a.name < b.name ? -1 : 1))
        }
      })
      nodes.push({ parent, subs, expanded: !collapsedCats.has(parent) })
    }
    return nodes
  }, [allTemplates, search, collapsedCats, subOrders, leafOrders, parentOrderState])

  // 模板树翻页：每页大类数随屏高自适应，窗口拉高多显示几个大类，底部不留白
  const navPageSize = useNavPageSize({ rowHeight: 40, min: 5 })
  const [navPage, setNavPage] = useState(1)
  const navTotalPages = Math.max(1, Math.ceil(tree.length / navPageSize))
  const pagedTree = tree.slice((navPage - 1) * navPageSize, navPage * navPageSize)
  // 模板增删/每页条数变化时把页码收敛回合法区间
  useEffect(() => { setNavPage((p) => clampNavPage(p, navTotalPages)) }, [navTotalPages])
  // 搜索回到第 1 页：命中的大类可能在别的页上
  useEffect(() => { setNavPage(1) }, [search])

  // 「全部」视图大类翻页同样要在搜索/大类数变化时收敛回合法区间，并回到第 1 页
  const allViewTotalPages = Math.max(1, tree.length)
  useEffect(() => { setAllViewPage((p) => clampNavPage(p, allViewTotalPages)) }, [allViewTotalPages])
  useEffect(() => { setAllViewPage(1) }, [search])

  const toggleAllSub = (fullName: string) => {
    setCollapsedAllSubs((prev) => {
      const next = new Set(prev)
      if (next.has(fullName)) next.delete(fullName)
      else next.add(fullName)
      return next
    })
  }

  const toggleCat = (cat: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  /**
   * 大类排序。
   *
   * 大类不是实体、只是分类名里斜杠前的一段，没有可以写回的地方，
   * 所以顺序按本机偏好存 localStorage —— 单机产品够用，也不会影响别人。
   */
  const moveParent = (parent: string, direction: -1 | 1) => {
    // 以当前实际展示顺序为基准（而非可能含已改名旧项的存档），避免改名后 indexOf 失败导致无反应
    const current = tree.map((n) => n.parent)
    const idx = current.indexOf(parent)
    if (idx === -1) return
    const to = idx + direction
    if (to < 0 || to >= current.length) return
    ;[current[idx], current[to]] = [current[to], current[idx]]
    setParentOrderState(current)
    localStorage.setItem('aikb-param-template-parent-order', JSON.stringify(current))
  }

  /**
   * 把子类挪到另一个大类下。
   *
   * 分类就是 `大类/子类` 这一个字符串，所以"移动"本质上是改分类名。
   * 它会改变模板的身份：正在引用旧分类的需求要一并跟过去，
   * 否则这些需求会突然找不到模板。
   */
  const confirmMoveSub = async () => {
    if (!movingSub || !moveTargetParent.trim()) return
    const next = `${moveTargetParent.trim()}/${movingSub.sub}`
    if (next === movingSub.template.category) {
      setMovingSub(null)
      return
    }
    try {
      await paramTemplateApi.update(movingSub.template.id, { category: next })
      await queryClient.invalidateQueries({ queryKey: ['param-templates'] })
      await queryClient.invalidateQueries({ queryKey: ['product-categories'] })
      toast.success(`已移动到「${moveTargetParent.trim()}」下`)
      setMovingSub(null)
      setMoveTargetParent('')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || '移动失败')
    }
  }

  const moveSub = (parent: string, subCategory: string, direction: -1 | 1) => {
    setSubOrders((prev) => {
      const parentNode = tree.find((n) => n.parent === parent)
      if (!parentNode) return prev
      // 以当前实际展示顺序为基准：存档里可能残留改名前的旧名称，直接用它 indexOf 会失败导致无反应
      const currentOrder = parentNode.subs.map((s) => s.subCategory)
      const idx = currentOrder.indexOf(subCategory)
      if (idx === -1) return prev
      const newIdx = idx + direction
      if (newIdx < 0 || newIdx >= currentOrder.length) return prev
      const next = { ...prev }
      const arr = [...currentOrder]
      ;[arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]]
      next[parent] = arr
      localStorage.setItem('aikb-param-template-order', JSON.stringify(next))
      return next
    })
  }

  /**
   * 三级子项排序（如把 工作辊 移到 中间辊 上方）。
   * 与子类排序同理：顺序只是浏览偏好，存 localStorage，不影响分类字符串本身。
   */
  const moveLeaf = (subFullName: string, leafName: string, direction: -1 | 1) => {
    setLeafOrders((prev) => {
      let children: TreeLeafNode[] | null = null
      for (const node of tree) {
        const sub = node.subs.find((s) => s.fullName === subFullName)
        if (sub) { children = sub.children; break }
      }
      if (!children) return prev
      // 同上：用当前实际顺序，不信任可能含旧名称的存档
      const currentOrder = children.map((c) => c.name)
      const idx = currentOrder.indexOf(leafName)
      if (idx === -1) return prev
      const newIdx = idx + direction
      if (newIdx < 0 || newIdx >= currentOrder.length) return prev
      const next = { ...prev }
      const arr = [...currentOrder]
      ;[arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]]
      next[subFullName] = arr
      localStorage.setItem('aikb-param-template-leaf-order', JSON.stringify(next))
      return next
    })
  }

  const toggleSection = (sec: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sec)) next.delete(sec)
      else next.add(sec)
      return next
    })
  }

  const openEdit = (t: ParamTemplate) => {
    setEditing(t)
    setValues({
      category: t.category || '',
      fields: t.fields || '',
      status: t.status || 'draft',
    })
    setModalOpen(true)
  }

  const openCreate = (prefillCategory?: string) => {
    setEditing(null)
    reset()
    // 从灰色分组节点进来时预填分类，省得再打一遍
    if (prefillCategory) setValues((v) => ({ ...v, category: prefillCategory }))
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    reset()
  }

  const fields: TemplateField[] = parseFields(selectedTemplate?.fields)
  const editingFields = parseFields(form.fields)

  /** 分组顺序：先按业务习惯的固定顺序，其余按首次出现顺序补在后面 */
  const groupedSections = useMemo(() => {
    const preferred = ['来料信息', '设备信息', '成品参数', '电源及公用工程', '现场条件', '配套选项']
    const map = new Map<string, TemplateField[]>()
    for (const f of fields) {
      const sec = f.section || '其他'
      if (!map.has(sec)) map.set(sec, [])
      map.get(sec)!.push(f)
    }
    const ordered = [
      ...preferred.filter((s) => map.has(s)),
      ...Array.from(map.keys()).filter((s) => !preferred.includes(s)),
    ]
    return ordered.map((section) => ({ section, items: map.get(section)! }))
  }, [fields])

  /** 库里已经存在的分类，供选择面板展示 */
  const knownCategories = useMemo(
    () => Array.from(new Set(allTemplates.map((t) => t.category).filter(Boolean))).sort(),
    [allTemplates],
  )

  /**
   * 分类 combobox：输入框可直接打字（新建品类零额外步骤），
   * 聚焦时原地展开面板，输入内容实时筛选、点选即填入。
   */
  const [catPanelOpen, setCatPanelOpen] = useState(false)
  const catPanelRef = useRef<HTMLDivElement>(null)

  const catGroups = useMemo(() => {
    const kw = form.category.trim().toLowerCase()
    const cats = kw ? knownCategories.filter((c) => c.toLowerCase().includes(kw)) : knownCategories
    const groups: Record<string, string[]> = {}
    for (const c of cats) {
      const top = c.split('/')[0]
      ;(groups[top] ||= []).push(c)
    }
    return Object.entries(groups)
  }, [knownCategories, form.category])

  // 点面板外关闭
  useEffect(() => {
    if (!catPanelOpen) return
    const onDown = (e: MouseEvent) => {
      if (catPanelRef.current && !catPanelRef.current.contains(e.target as Node)) setCatPanelOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [catPanelOpen])

  const allSectionNames = useMemo(
    () => Array.from(new Set(fields.map((f) => f.section || '其他'))),
    [fields],
  )

  /**
   * 字段改动统一走这里：整份 fields 序列化后 PATCH 回去。
   * 后端 update 会校验它是合法 JSON 数组，改坏了不会写进库。
   */
  const persistFields = async (next: TemplateField[], successMsg: string) => {
    if (!selectedTemplate) return
    try {
      await paramTemplateApi.update(selectedTemplate.id, { fields: JSON.stringify(next, null, 2) })
      await queryClient.invalidateQueries({ queryKey: ['param-templates'] })
      toast.success(successMsg)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || '保存失败')
    }
  }

  const openFieldEditor = (field: TemplateField | null, section?: string) => {
    setEditingField(field)
    setNewFieldSection(section)
    setFieldModalOpen(true)
  }

  const handleSaveField = async (field: TemplateField) => {
    const next = [...fields]
    if (editingField) {
      const idx = next.findIndex((f) => f.key === editingField.key)
      if (idx >= 0) next[idx] = field
    } else {
      next.push(field)
    }
    setFieldModalOpen(false)
    setEditingField(null)
    await persistFields(next, editingField ? '字段已更新' : '字段已新增')
  }

  const handleDeleteField = async () => {
    if (!deletingField) return
    const target = deletingField
    setDeletingField(null)
    await persistFields(
      fields.filter((f) => f.key !== target.key),
      `已删除字段「${target.label}」`,
    )
  }

  const moveField = async (idx: number, dir: -1 | 1) => {
    const to = idx + dir
    if (to < 0 || to >= fields.length) return
    const next = [...fields]
    ;[next[idx], next[to]] = [next[to], next[idx]]
    await persistFields(next, '顺序已调整')
  }

  /**
   * 模板删除。
   *
   * 需求表按 templateCategory（分类名）引用模板，没有外键约束，
   * 所以删掉不会报错、但那些需求会安静地失去参数定义。
   * 先向后端问引用数，把后果摆给用户看，再让他决定。
   */
  const askDeleteTemplate = async (t: ParamTemplate) => {
    setDeletingTemplate(t)
    setUsageCount(null)
    try {
      const { count } = await paramTemplateApi.usage(t.id)
      setUsageCount(count)
    } catch {
      setUsageCount(0)
    }
  }

  const confirmDeleteTemplate = async () => {
    if (!deletingTemplate) return
    setDeleting(true)
    try {
      // 引用数已经展示给用户并得到确认，这里直接 force
      await paramTemplateApi.remove(deletingTemplate.id, true)
      await queryClient.invalidateQueries({ queryKey: ['param-templates'] })
      if (selectedId === deletingTemplate.id) setSelectedId(null)
      toast.success(`已删除模板「${deletingTemplate.category}」`)
      setDeletingTemplate(null)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 统计卡片：与业务概览/客户中心同一套组件 */}
      <StatCards loading={isLoading} skeletonCount={5} items={templateCards} />

      <div className="flex flex-col lg:flex-row gap-4">
      {/* ===================== Left: Tree sidebar（同知识资料布局） ===================== */}
      <aside className="lg:w-[260px] flex-shrink-0" style={navPanel.panelStyle}>
        <div className="eo-card p-3 lg:sticky lg:top-4">
          {/* 「全部」已挪到顶栏（见 setPageActions）：左侧要留给分类树，
              这一行占的高度在分类多时很吃紧 */}
          {isLoading && <div className="py-8"><PageLoader /></div>}
          {isError && <ErrorState message={error?.message} onRetry={refetch} />}
          {!isLoading && !isError && tree.length === 0 && (
            <div className="text-center py-8 text-sm text-muted">暂无需求模板</div>
          )}
          {pagedTree.map((node, i) => {
            const pIdx = (navPage - 1) * navPageSize + i
            const isExpanded = search ? true : node.expanded
            const Icon = categoryIcons[node.parent] || Box
            const count = node.subs.filter((s) => s.template).length
            return (
              <div key={node.parent} className="mb-0.5 group/parent">
                <div className="w-full flex items-center gap-1 px-2 py-1.5 rounded-md text-sm font-medium transition-colors text-ink hover:bg-canvas">
                  <button
                    onClick={() => !search && toggleCat(node.parent)}
                    className="flex items-center gap-1 flex-1 min-w-0 text-left"
                  >
                    {isExpanded ? <ChevronDown size={14} className="text-muted flex-shrink-0" /> : <ChevronRight size={14} className="text-muted flex-shrink-0" />}
                    <Icon size={15} className="flex-shrink-0 text-muted" />
                    <span className="flex-1 truncate">{node.parent}</span>
                  </button>
                  <span className="text-xs text-muted bg-canvas px-1.5 py-0.5 rounded-full">{count}</span>
                  {/* 大类顺序只影响本机浏览习惯，存 localStorage 即可 */}
                  <span className="hidden group-hover/parent:flex items-center gap-0.5 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setAddingSubFor(node.parent)
                        setNewSubName('')
                        if (collapsedCats.has(node.parent)) toggleCat(node.parent)
                      }}
                      className="p-0.5 rounded text-muted hover:text-accent-600"
                      title={`在「${node.parent}」下添加子类`}
                    >
                      <Plus size={13} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveParent(node.parent, -1) }}
                      disabled={pIdx === 0}
                      className="p-0.5 rounded text-muted hover:text-ink disabled:opacity-30"
                      title="大类上移"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveParent(node.parent, 1) }}
                      disabled={pIdx === tree.length - 1}
                      className="p-0.5 rounded text-muted hover:text-ink disabled:opacity-30"
                      title="大类下移"
                    >
                      <ChevronDown size={13} />
                    </button>
                  </span>
                </div>

                {isExpanded && (
                  <div className="ml-3 border-l border-border">
                    {/* 大类「+」添加子类的内联输入 */}
                    {addingSubFor === node.parent && (
                      <div className="ml-3 my-1">
                        <input
                          autoFocus
                          value={newSubName}
                          onChange={(e) => setNewSubName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddSub(node.parent)
                            if (e.key === 'Escape') { setAddingSubFor(null); setNewSubName('') }
                          }}
                          onBlur={() => { setAddingSubFor(null); setNewSubName('') }}
                          placeholder="子类名，Enter 确认"
                          className="w-full px-2 py-0.5 text-sm border border-accent-300 rounded-md bg-surface outline-none focus:border-accent-500"
                        />
                      </div>
                    )}
                    {node.subs.map((sub, subIdx) => {
                      const active = sub.template?.id === selectedId
                      return (
                        <div key={sub.fullName}>
                          <div className="group relative flex items-center">
                          <button
                            onClick={() => sub.template && pickTemplate(sub.template.id)}
                            className={`flex-1 flex items-center gap-2 pl-3 pr-2 py-1.5 -ml-px border-l-2 text-sm transition-colors ${
                              active
                                ? 'border-accent-500 bg-accent-50/50 text-accent-700 font-medium'
                                : 'border-transparent text-ink-soft hover:bg-canvas hover:text-ink'
                            } ${!sub.template && sub.children.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <SlidersHorizontal size={14} className={`flex-shrink-0 ${active ? 'text-accent-500' : 'text-muted'}`} />
                            <span className="flex-1 text-left truncate">{sub.subCategory || sub.fullName.split('/')[0]}</span>
                            {sub.children.length > 0 && (
                              <span className="text-caption text-muted bg-canvas px-1 rounded">
                                {sub.children.length}
                              </span>
                            )}
                            {!sub.template && sub.children.length === 0 && (
                              <span className="text-caption text-muted">未配置</span>
                            )}
                          </button>
                          <div className="hidden group-hover:flex items-center gap-0.5 pr-1 flex-shrink-0">
                            {/*
              分组子类（如 联轴器，无模板、下挂末级）的「+」用于添加末级（常规/特殊/球头…）。
              叶子子类（有模板）不再显示「+」——在它下面再加层会重新制造"中间层挂模板"。
            */}
                            {!sub.template && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setAddingGrandSubFor(sub.fullName); setNewGrandSubName('') }}
                                className="p-0.5 rounded text-accent-500 hover:text-accent-600"
                                title={`在「${sub.subCategory}」下添加末级`}
                              >
                                <Plus size={13} />
                              </button>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); moveSub(node.parent, sub.subCategory, -1) }}
                              disabled={subIdx === 0}
                              className="p-0.5 rounded text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                              title="上移"
                            >
                              <ChevronUp size={13} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); moveSub(node.parent, sub.subCategory, 1) }}
                              disabled={subIdx === node.subs.length - 1}
                              className="p-0.5 rounded text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                              title="下移"
                            >
                              <ChevronDown size={13} />
                            </button>
                            {/* 重命名 = 改分类名；删除 = 删模板。分类本身没有独立实体 */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                if (!sub.template) return
                                setMovingSub({ template: sub.template, sub: sub.subCategory })
                                setMoveTargetParent(node.parent)
                              }}
                              disabled={!sub.template}
                              className="p-0.5 rounded text-muted hover:text-ink disabled:opacity-30"
                              title="移动到其他大类"
                            >
                              <FolderInput size={13} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); if (sub.template) openEdit(sub.template) }}
                              disabled={!sub.template}
                              className="p-0.5 rounded text-muted hover:text-ink disabled:opacity-30"
                              title="重命名 / 改状态"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); if (sub.template) askDeleteTemplate(sub.template) }}
                              disabled={!sub.template}
                              className="p-0.5 rounded text-muted hover:text-danger-fg disabled:opacity-30"
                              title="删除该分类及其模板"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                          {/* 三级分类，如 零部件/联轴器/重载联轴器；点「+」加末级时也展开此区 */}
                          {(sub.children.length > 0 || addingGrandSubFor === sub.fullName) && (
                            <div className="ml-4 border-l border-border">
                              {/* 子类「+」添加末级的内联输入 */}
                              {addingGrandSubFor === sub.fullName && (
                                <div className="ml-3 my-1">
                                  <input
                                    autoFocus
                                    value={newGrandSubName}
                                    onChange={(e) => setNewGrandSubName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleAddGrandSub(sub.fullName)
                                      if (e.key === 'Escape') { setAddingGrandSubFor(null); setNewGrandSubName('') }
                                    }}
                                    onBlur={() => { setAddingGrandSubFor(null); setNewGrandSubName('') }}
                                    placeholder="末级名，Enter 确认"
                                    className="w-full px-2 py-0.5 text-sm border border-accent-300 rounded-md bg-surface outline-none focus:border-accent-500"
                                  />
                                </div>
                              )}
                              {sub.children.map((leaf, leafIdx) => {
                                const leafActive = leaf.template.id === selectedId
                                return (
                                  <div key={leaf.fullName} className="group/leaf flex items-center">
                                    <button
                                      onClick={() => pickTemplate(leaf.template.id)}
                                      className={`flex-1 flex items-center gap-2 pl-3 pr-2 py-1 -ml-px border-l-2 text-sm transition-colors ${
                                        leafActive
                                          ? 'border-accent-500 bg-accent-50/50 text-accent-700 font-medium'
                                          : 'border-transparent text-ink-soft hover:bg-canvas hover:text-ink'
                                      }`}
                                    >
                                      <span className="w-1 h-1 rounded-full bg-muted flex-shrink-0" />
                                      <span className="flex-1 text-left truncate">{leaf.name}</span>
                                    </button>
                                    <div className="hidden group-hover/leaf:flex items-center gap-0.5 pr-1 flex-shrink-0">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); moveLeaf(sub.fullName, leaf.name, -1) }}
                                        disabled={leafIdx === 0}
                                        className="p-0.5 rounded text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                                        title="上移"
                                      >
                                        <ChevronUp size={12} />
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); moveLeaf(sub.fullName, leaf.name, 1) }}
                                        disabled={leafIdx === sub.children.length - 1}
                                        className="p-0.5 rounded text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                                        title="下移"
                                      >
                                        <ChevronDown size={12} />
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); openEdit(leaf.template) }}
                                        className="p-0.5 rounded text-muted hover:text-ink"
                                        title="重命名 / 改状态"
                                      >
                                        <Pencil size={12} />
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); askDeleteTemplate(leaf.template) }}
                                        className="p-0.5 rounded text-muted hover:text-danger-fg"
                                        title="删除该分类及其模板"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          {/* 大类翻页：分类多时逐页浏览，每页条数随屏高自适应 */}
          <NavPager page={navPage} totalPages={navTotalPages} onChange={setNavPage} label="分类" />
        </div>
      </aside>
      <ResizeHandle onMouseDown={navPanel.startDrag} />

      {/* ===================== Right: 「全部」总览 / Detail panel ===================== */}
      <div className="flex-1 min-w-0">
        {viewAll ? (
          <div className="max-w-[960px]">
            <div className="flex items-center gap-3 text-sm flex-wrap mb-4">
              <span className="font-medium text-ink">全部需求模板</span>
              <span className="text-muted">
                共 {allTemplates.length} 个模板 · {tree.length} 个大类
              </span>
            </div>
            {allTemplates.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted">暂无需求模板，点右上角「新建模板」创建</div>
            ) : tree.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted">没有匹配的模板</div>
            ) : (
              (() => {
                // 方案 A：每页展示一个大类，组内按子类分组+卡片，底部翻大类
                const node = tree[Math.min(allViewPage - 1, tree.length - 1)]
                if (!node) return null
                const Icon = categoryIcons[node.parent] || Box
                // 该大类下模板总数（含直属模板 + 三级叶子）
                const totalInParent = node.subs.reduce(
                  (sum, s) => sum + (s.template ? 1 : 0) + s.children.length,
                  0,
                )
                return (
                  <div>
                    {/* 大类标题 */}
                    <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-border">
                      <div className="w-9 h-9 rounded-lg bg-accent-50 flex items-center justify-center">
                        <Icon size={18} className="text-accent-600" />
                      </div>
                      <h3 className="text-base font-serif font-semibold text-ink">{node.parent}</h3>
                      <span className="text-xs text-muted bg-canvas px-2 py-0.5 rounded-full">
                        {totalInParent} 个模板
                      </span>
                      <span className="ml-auto text-xs text-muted">
                        第 {allViewPage} / {allViewTotalPages} 个大类
                      </span>
                    </div>

                    {/* 子类分组（每个子类一块，可折叠，内含卡片网格） */}
                    <div className="space-y-3">
                      {node.subs.map((sub) => {
                        // 子类下的卡片：直属模板（两级分类）+ 三级叶子
                        const cards: ParamTemplate[] = [
                          ...(sub.template ? [sub.template] : []),
                          ...sub.children.map((c) => c.template),
                        ]
                        if (cards.length === 0) return null
                        const collapsed = collapsedAllSubs.has(sub.fullName)
                        return (
                          <div key={sub.fullName} className="eo-card overflow-hidden">
                            <button
                              onClick={() => toggleAllSub(sub.fullName)}
                              className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-canvas/60 transition-colors"
                            >
                              {collapsed ? (
                                <ChevronRight size={15} className="text-muted flex-shrink-0" />
                              ) : (
                                <ChevronDown size={15} className="text-muted flex-shrink-0" />
                              )}
                              <SlidersHorizontal size={14} className="text-accent-500 flex-shrink-0" />
                              <span className="text-sm font-medium text-ink flex-1">
                                {sub.subCategory || sub.fullName.split('/').slice(1).join('/') || node.parent}
                              </span>
                              <span className="text-xs text-muted bg-canvas px-1.5 py-0.5 rounded-full">
                                {cards.length}
                              </span>
                            </button>
                            {!collapsed && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 px-4 pb-4 pt-1">
                                {cards.map((t) => (
                                  <button
                                    key={t.id}
                                    onClick={() => pickTemplate(t.id)}
                                    className="bg-surface border border-border rounded-lg p-3.5 text-left hover:border-accent-300 hover:shadow-card transition-all"
                                    title={`查看「${t.category}」模板`}
                                  >
                                    <div className="flex items-center gap-1.5 mb-1">
                                      <span className="flex-1 min-w-0 truncate text-body-sm font-medium text-ink">
                                        {t.category?.split('/').pop() || t.category || '未分类'}
                                      </span>
                                      <StatusBadge kind="library" status={t.status} />
                                    </div>
                                    <p className="text-caption text-muted mt-1">
                                      {fieldCountOf(t)} 个字段 · v{t.version}
                                    </p>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* 大类翻页 */}
                    <div className="mt-5">
                      <NavPager
                        page={allViewPage}
                        totalPages={allViewTotalPages}
                        onChange={setAllViewPage}
                        label="大类"
                      />
                    </div>
                  </div>
                )
              })()
            )}
          </div>
        ) : !selectedTemplate ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-20 h-20 rounded-2xl bg-canvas flex items-center justify-center mx-auto mb-4">
                <SlidersHorizontal size={36} className="text-muted" />
              </div>
              <h3 className="text-base font-medium text-ink mb-1">选择左侧分类查看需求模板</h3>
              <p className="text-sm text-muted">需求模板定义了各类产品的技术参数字段</p>
            </div>
          </div>
        ) : (
          <div className="p-6">
            {/* Header card */}
            <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden mb-5">
              <div className="flex items-start gap-4 p-5">
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-accent-500/10 to-accent-300/10 border border-accent-200/30 flex items-center justify-center flex-shrink-0">
                  <SlidersHorizontal size={30} className="text-accent-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-lg font-serif font-semibold text-ink">
                      {selectedTemplate.category?.split('/').pop() || selectedTemplate.category}
                    </h2>
                    <StatusBadge kind="library" status={selectedTemplate.status} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span>分类: {selectedTemplate.category?.includes('/') ? selectedTemplate.category.split('/').join(' › ') : selectedTemplate.category}</span>
                    <span>版本: v{selectedTemplate.version}</span>
                    <span>字段数: {fields.length}</span>
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(selectedTemplate)} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-canvas transition-colors" title="编辑基本信息">
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => askDeleteTemplate(selectedTemplate)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-danger-fg hover:bg-danger-bg transition-colors"
                    title="删除模板"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>

            {/*
              字段定义表。
              模板是需求卡片的结构定义，下游技术方案模块（人工比对或智能匹配）
              要逐字段对齐 key / 单位 / 必填，所以这里按表格呈现：
              同一列纵向可比，一眼能看出缺单位、缺必填、key 命名不一致。
              原先的三列卡片网格做不到这件事。
            */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-ink">
                字段定义
                <span className="ml-2 text-xs font-normal text-muted">
                  共 {fields.length} 项 · {fields.filter((f: any) => f.required).length} 必填
                </span>
              </h3>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setJsonDraft(JSON.stringify(fields, null, 2))
                    setJsonOpen(true)
                  }}
                >
                  <Code size={14} className="mr-1" /> JSON
                </Button>
                <Button size="sm" onClick={() => openFieldEditor(null)}>
                  <Plus size={14} className="mr-1" /> 新增字段
                </Button>
              </div>
            </div>

            {fields.length === 0 ? (
              <div className="bg-surface rounded-xl border border-border shadow-card p-10 text-center">
                <Ruler size={28} className="text-muted mx-auto mb-3" />
                <p className="text-sm text-ink mb-1">该模板还没有定义字段</p>
                <p className="text-xs text-muted mb-4">
                  字段定义决定了客户需求能被结构化成哪些参数，也是方案匹配的比对依据
                </p>
                <Button size="sm" onClick={() => openFieldEditor(null)}>
                  <Plus size={14} className="mr-1" /> 新增第一个字段
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {groupedSections.map(({ section, items }) => {
                  const expanded = expandedSections.has(section)
                  return (
                    <div key={section} className="bg-surface rounded-xl border border-border shadow-card overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-3 bg-canvas border-b border-border">
                        <button
                          onClick={() => toggleSection(section)}
                          className="flex items-center gap-2 flex-1 text-left"
                        >
                          {expanded ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />}
                          <Ruler size={15} className="text-accent-500" />
                          <span className="text-sm font-semibold text-ink">{section}</span>
                          <span className="text-xs text-muted bg-surface border border-border px-2 py-0.5 rounded-full">
                            {items.length} 字段
                          </span>
                          <span className="text-xs text-muted">
                            {items.filter((f: any) => f.required).length} 必填
                          </span>
                        </button>
                        <button
                          onClick={() => openFieldEditor(null, section)}
                          className="text-xs text-accent-600 hover:text-accent-700 px-2 py-1 rounded hover:bg-surface transition-colors"
                        >
                          + 添加
                        </button>
                      </div>

                      {expanded && (
                        <div className="overflow-x-auto">
                          {/*
                            列宽必须固定：不给宽度时浏览器会为了塞下「可选值」那一列
                            把「类型」「必填」压到一个字的宽度，表头就竖排成了「类 型」。
                            min-w 让它宁可横向滚动，也不把窄列挤变形。
                          */}
                          <table className="w-full text-sm min-w-[860px]">
                            <thead>
                              <tr className="text-left text-xs text-muted border-b border-border">
                                <th className="px-4 py-2 font-medium whitespace-nowrap w-[13%]">字段名</th>
                                <th className="px-3 py-2 font-medium whitespace-nowrap w-[15%]">标识 (key)</th>
                                <th className="px-3 py-2 font-medium whitespace-nowrap w-[7%]">类型</th>
                                <th className="px-3 py-2 font-medium whitespace-nowrap w-[6%]">单位</th>
                                <th className="px-3 py-2 font-medium whitespace-nowrap text-center w-[6%]">必填</th>
                                <th className="px-3 py-2 font-medium whitespace-nowrap w-[20%]">可选值</th>
                                <th className="px-3 py-2 font-medium whitespace-nowrap">说明</th>
                                <th className="px-3 py-2 font-medium text-right whitespace-nowrap w-[104px]">操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((f: any) => {
                                const globalIdx = fields.indexOf(f)
                                return (
                                  <tr key={f.key} className="border-b border-border/60 last:border-0 hover:bg-canvas/60 group">
                                    <td className="px-4 py-2.5 text-ink font-medium">{f.label}</td>
                                    <td className="px-3 py-2.5">
                                      <code className="text-xs font-mono text-accent-600">{f.key}</code>
                                    </td>
                                    <td className="px-3 py-2.5 text-ink-soft">{typeLabel(f.type)}</td>
                                    <td className="px-3 py-2.5 text-ink-soft">{f.unit || <span className="text-muted">—</span>}</td>
                                    <td className="px-3 py-2.5 text-center">
                                      {f.required ? (
                                        <span className="text-[10px] text-danger-fg bg-danger-bg border border-danger-line px-1.5 py-0.5 rounded">必填</span>
                                      ) : (
                                        <span className="text-xs text-muted">选填</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5 text-xs text-muted max-w-[240px]">
                                      {/*
                                        可选值单行展示，超长尾部省略号、悬浮看全部。
                                        此前可选值是会换行的标签 + 说明挤同一列，常撑成三行。
                                      */}
                                      <div className="truncate" title={(f.options || []).join('、') || ''}>
                                        {f.options?.length > 0 ? f.options.join('、') : <span>—</span>}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2.5 text-xs text-muted max-w-[300px]">
                                      <div className="truncate" title={f.remark || ''}>
                                        {f.remark || <span>—</span>}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2.5">
                                      {/*
                                        常驻显示，不再悬停才出现。
                                        这张表存在的意义就是改字段，把编辑入口藏在 hover 后面，
                                        用户会以为字段不可改 —— 实际点了半天没找到按钮。
                                      */}
                                      <div className="flex items-center justify-end gap-0.5">
                                        <button
                                          onClick={() => moveField(globalIdx, -1)}
                                          disabled={globalIdx === 0}
                                          className="p-1 rounded text-muted hover:text-ink disabled:opacity-30"
                                          title="上移"
                                        >
                                          <ChevronUp size={14} />
                                        </button>
                                        <button
                                          onClick={() => moveField(globalIdx, 1)}
                                          disabled={globalIdx === fields.length - 1}
                                          className="p-1 rounded text-muted hover:text-ink disabled:opacity-30"
                                          title="下移"
                                        >
                                          <ChevronDown size={14} />
                                        </button>
                                        <button
                                          onClick={() => openFieldEditor(f)}
                                          className="p-1 rounded text-muted hover:text-ink"
                                          title="编辑"
                                        >
                                          <Pencil size={14} />
                                        </button>
                                        <button
                                          onClick={() => setDeletingField(f)}
                                          className="p-1 rounded text-muted hover:text-danger-fg"
                                          title="删除"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
      </div>

      {/* ===================== Modal ===================== */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? '编辑需求模板' : '新建需求模板'}
        onConfirm={async () => {
          if (!validateAll()) return
          // 强制叶子级：所选分类下若已有子分类，则它是中间节点，禁止在此挂模板
          // （否则又会出现"中间层挂模板、下面又挂叶子"的混用）。
          const cat = form.category.trim()
          if (cat && knownCategories.some((c) => c.startsWith(cat + '/'))) {
            toast.error('该分类下已有子分类，模板只能建在末级。请选择或输入一个末级分类（如 大类/子类/末级）。')
            return
          }
          try {
            if (editing) {
              await paramTemplateApi.update(editing.id, { ...form, fields: normalizeFields(form.fields) })
            } else {
              await paramTemplateApi.create({ ...form, fields: normalizeFields(form.fields) })
            }
            queryClient.invalidateQueries({ queryKey: ['param-templates'] })
            if (editing && form.category !== editing.category) {
              // 后端会把改名级联到子模板/需求/产品，相关缓存一并刷新
              queryClient.invalidateQueries({ queryKey: ['product-categories'] })
              queryClient.invalidateQueries({ queryKey: ['products'] })
              queryClient.invalidateQueries({ queryKey: ['requirements'] })
            }
            closeModal()
            toast.success(editing ? '模板已更新' : '模板已创建')
          } catch (err: any) {
            toast.error(err?.response?.data?.message || err?.message || '操作失败')
          }
        }}
        confirmDisabled={!isValid}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/*
              分类 combobox：
              ・选已有：输入几个字筛选，面板里点一下即可；
              ・新建品类：直接打全名（大类/子类 格式）保存，零额外步骤。
              分类 = param_templates.category 唯一，产品与需求的分类都取自这里。
            */}
            <div>
              <label className="block eo-label mb-1.5">
                分类<span className="text-accent-500 ml-0.5">*</span>
              </label>
              <div className="relative" ref={catPanelRef}>
                <div className="relative">
                  <input
                    value={form.category}
                    onChange={(e) => {
                      setValue('category', e.target.value)
                      setCatPanelOpen(true)
                    }}
                    onFocus={() => setCatPanelOpen(true)}
                    onKeyDown={(e) => {
                      // Esc 只收面板，不关整个弹窗
                      if (e.key === 'Escape' && catPanelOpen) {
                        e.stopPropagation()
                        setCatPanelOpen(false)
                      }
                    }}
                    placeholder="输入筛选已有分类，或直接打新名称新建"
                    className={`eo-input !pr-9 ${errors.category ? '!border-danger-fg' : ''}`}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setCatPanelOpen((v) => !v)}
                    title="展开 / 收起分类面板"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-muted hover:text-ink hover:bg-canvas"
                  >
                    <ListTree size={15} />
                  </button>
                </div>
                {catPanelOpen && (
                  <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
                    <div className="max-h-60 overflow-y-auto p-1.5">
                      {form.category.trim() !== '' && !knownCategories.includes(form.category.trim()) && (
                        <div className="px-2.5 py-1.5 mb-1 text-xs text-accent-600 bg-accent-50 rounded">
                          没有同名分类，保存后将新建品类「{form.category.trim()}」
                        </div>
                      )}
                      {catGroups.length === 0 ? (
                        <p className="px-2 py-3 text-xs text-muted text-center">没有匹配的已有分类</p>
                      ) : (
                        catGroups.map(([top, cats]) => (
                          <div key={top} className="mb-1">
                            <p className="px-2 pt-1 pb-0.5 text-caption text-muted font-medium">{top}</p>
                            {cats.map((c) => {
                              const depth = c.split('/').length - 1
                              const selected = c === form.category
                              return (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => {
                                    setValue('category', c)
                                    setCatPanelOpen(false)
                                  }}
                                  style={{ paddingLeft: `${8 + depth * 14}px` }}
                                  className={`w-full text-left pr-2 py-1 text-sm rounded transition-colors ${
                                    selected
                                      ? 'bg-accent-50 text-accent-600 font-medium'
                                      : 'text-ink-soft hover:bg-canvas hover:text-ink'
                                  }`}
                                >
                                  {c.slice(top.length + 1) || c}
                                </button>
                              )
                            })}
                          </div>
                        ))
                      )}
                    </div>
                    <p className="px-3 py-1.5 border-t border-border text-caption text-muted">
                      点选已有分类；直接输入新名称即可新建品类
                    </p>
                  </div>
                )}
              </div>
              {errors.category ? (
                <p className="mt-1 text-xs text-danger-fg">{errors.category}</p>
              ) : (
                <p className="mt-1 text-xs text-muted">
                  用「大类/子类」或「大类/子类/三级」格式，例如 装备/矫直设备、零部件/联轴器/重载联轴器。
                </p>
              )}
            </div>
            <FormSelect label="状态" options={statusOptions} value={form.status} onChange={(e) => setValue('status', e.target.value)} />
          </div>
          {/*
            新建时仍允许直接粘一份 JSON（从别的模板复制过来最快）；
            已存在的模板改字段请走表格，不必在这里手写。
          */}
          {!editing && (
            <FormTextarea
              label="字段定义（JSON，可留空后续在表格里逐条添加）"
              value={form.fields}
              onChange={(e) => setValue('fields', e.target.value)}
              placeholder={fieldsPlaceholder}
              rows={8}
            />
          )}
          {!editing && editingFields.length > 0 && (
            <div className="bg-canvas rounded-lg p-3 border border-border">
              <div className="text-xs text-muted mb-2">预览（{editingFields.length} 个字段）</div>
              <div className="flex flex-wrap gap-1.5">
                {editingFields.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-surface border border-border rounded-full">
                    <span className="font-medium text-ink">{f.label}</span>
                    {f.unit && <span className="text-muted">{f.unit}</span>}
                    {f.required && <span className="text-danger-fg">*</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ===================== 字段编辑 ===================== */}
      <FieldEditorModal
        open={fieldModalOpen}
        onClose={() => {
          setFieldModalOpen(false)
          setEditingField(null)
        }}
        onSave={handleSaveField}
        field={editingField}
        sections={allSectionNames}
        defaultSection={newFieldSection}
        existingKeys={fields
          .filter((f) => f.key !== editingField?.key)
          .map((f) => f.key)}
      />

      {/* ===================== 删除字段 ===================== */}
      <Modal
        open={!!deletingField}
        onClose={() => setDeletingField(null)}
        title="删除字段"
        onConfirm={handleDeleteField}
        confirmText="删除"
        size="sm"
      >
        <p className="text-sm text-ink-soft">
          确定删除字段 <span className="font-medium text-ink">{deletingField?.label}</span>
          （<code className="text-xs font-mono text-accent-600">{deletingField?.key}</code>）？
        </p>
        <p className="text-xs text-muted mt-2">
          已按此模板结构化过的历史需求不会被改动，但今后该参数不再被采集和比对。
        </p>
      </Modal>

      {/* ===================== 删除模板 ===================== */}
      <Modal
        open={!!deletingTemplate}
        onClose={() => setDeletingTemplate(null)}
        title="删除需求模板"
        onConfirm={confirmDeleteTemplate}
        confirmText="确认删除"
        loading={deleting}
        confirmDisabled={usageCount === null}
        size="md"
      >
        <div className="space-y-3 text-sm">
          <p className="text-ink-soft">
            即将删除模板{' '}
            <span className="font-medium text-ink">{deletingTemplate?.category}</span>
            （{parseFields(deletingTemplate?.fields).length} 个字段）。
          </p>

          {usageCount === null ? (
            <p className="text-muted">正在检查引用情况…</p>
          ) : usageCount > 0 ? (
            <div className="bg-danger-bg border border-danger-line rounded-md p-3 text-danger-fg">
              有 <strong>{usageCount}</strong> 条需求正在使用该模板。
              删除后这些需求的参数定义会失效，详情页将无法再渲染结构化参数表。
            </div>
          ) : (
            <div className="bg-canvas border border-border rounded-md p-3 text-ink-soft">
              目前没有需求引用该模板，可以安全删除。
            </div>
          )}

          <p className="text-xs text-muted">删除不可撤销。如只是暂时停用，把状态改为「归档」更合适。</p>
        </div>
      </Modal>

      {/* ===================== 移动子类到其他大类 ===================== */}
      <Modal
        open={!!movingSub}
        onClose={() => { setMovingSub(null); setMoveTargetParent('') }}
        title="移动到其他大类"
        onConfirm={confirmMoveSub}
        confirmText="移动"
        confirmDisabled={!moveTargetParent.trim()}
        size="md"
      >
        <div className="space-y-3 text-sm">
          <p className="text-ink-soft">
            把 <span className="font-medium text-ink">{movingSub?.sub}</span> 移到哪个大类下？
          </p>
          <div>
            <input
              list="parent-options"
              value={moveTargetParent}
              onChange={(e) => setMoveTargetParent(e.target.value)}
              placeholder="如：零部件"
              className="eo-input"
            />
            <datalist id="parent-options">
              {tree.map((n) => (
                <option key={n.parent} value={n.parent} />
              ))}
            </datalist>
            <p className="mt-1 text-xs text-muted">
              可选已有大类，也可输入新大类名
            </p>
          </div>
          {movingSub && moveTargetParent.trim() && (
            <div className="bg-canvas border border-border rounded-md p-3 text-ink-soft">
              分类将由 <code className="text-xs">{movingSub.template.category}</code> 改为{' '}
              <code className="text-xs text-accent-600">{moveTargetParent.trim()}/{movingSub.sub}</code>
            </div>
          )}
          <p className="text-xs text-muted">
            改名后，子模板、需求引用和产品分类会自动跟随新分类（后端级联），无需手工处理。
          </p>
        </div>
      </Modal>

      {/* ===================== JSON 视图（高级/排错用） ===================== */}
      <Modal
        open={jsonOpen}
        onClose={() => setJsonOpen(false)}
        title="字段定义 JSON"
        onConfirm={async () => {
          try {
            const parsed = JSON.parse(jsonDraft)
            if (!Array.isArray(parsed)) throw new Error('必须是数组')
            setJsonOpen(false)
            await persistFields(parsed, '字段定义已保存')
          } catch (err: any) {
            toast.error(`JSON 格式有误：${err.message}`)
          }
        }}
        size="xl"
      >
        <div className="space-y-2">
          <p className="text-xs text-muted">
            批量调整或从其他模板整体复制时用它；日常增删改请直接在表格里操作。
          </p>
          <textarea
            value={jsonDraft}
            onChange={(e) => setJsonDraft(e.target.value)}
            rows={18}
            spellCheck={false}
            className="w-full font-mono text-xs p-3 border border-border rounded-md focus:outline-none focus:border-accent-400"
          />
        </div>
      </Modal>
    </div>
  )
}

