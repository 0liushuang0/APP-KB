import { useEffect, useMemo, useState, useRef } from 'react'
import ProductGapList from '../components/ProductGapList'
import ProductSupplySources from '../components/ProductSupplySources'
import DeleteImpact from '../components/DeleteImpact'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Package,
  Paperclip,
  Upload,
  Download,
  FileText,
  Scan,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  FolderInput,
  Box,
  DollarSign,
  Ruler,
  FileCheck,
  Hash,
  Tags,
} from 'lucide-react'
import { productApi, documentApi } from '../api/services'
import { downloadFile } from '../api/files'
import { toList } from '../utils/apiList'
import { usePageActions } from '../contexts/PageActionsContext'
import { useProductCategories, withLegacyCategory } from '../hooks/useProductCategories'
import { loadOrder, saveOrder, reorder as reorderOrder, applyOrder, type OrderMap } from '../utils/treeOrder'
import { useFormValidation, required } from '../hooks/useFormValidation'
import { useResizablePanel, ResizeHandle } from '../hooks/useResizablePanel'
import type { Product } from '../types'
import type { ProductPriceItem, ProductSpecItem } from '../types'
import Button from '../components/Button'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import FormInput from '../components/FormInput'
import SearchableSelect from '../components/SearchableSelect'
import StatCards from '../components/StatCards'
import ProductCompletenessBar from '../components/ProductCompletenessBar'
import FormTextarea from '../components/FormTextarea'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import StatusBadge from '../components/StatusBadge'
import FilePreview from '../components/FilePreview'
import { FormSection, FieldGrid } from '../components/layout-kit'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'

// 价格不再在弹窗里录：多档价格统一走详情页「型号价格表」；BOM 明细一并下线
const initialForm = {
  name: '',
  code: '',
  category: '',
  unit: '',
  description: '',
}


const attachmentTypeOptions = [
  { value: 'cad', label: 'CAD 图纸' },
  { value: 'agreement', label: '技术协议' },
  { value: 'quotation', label: '报价模板' },
  { value: 'manual', label: '产品手册' },
  { value: 'other', label: '其他' },
]

const attachmentTypeIcons: Record<string, typeof FileText> = {
  cad: Ruler,
  agreement: FileCheck,
  quotation: DollarSign,
  manual: FileText,
  other: FileText,
}

const handleError = (error: any) => {
  toast.error(error?.response?.data?.message || error?.message || '操作失败')
}

const specLabels: Record<string, string> = {
  // 通用
  line_type: '产线类型',
  strip_width_max: '最大板宽',
  strip_thickness_max: '最大板厚',
  strip_thickness_range: '板厚范围',
  max_line_speed: '最大线速',
  elongation: '延伸率',
  tension: '张力',
  roller_count: '辊数',
  roller_diameter: '辊径',
  roller_length: '辊身长度',
  drive_mode: '驱动方式',
  mode: '模式',
  // 剪切
  cut_width_accuracy: '切宽精度',
  cut_accuracy: '剪切精度',
  shear_force: '剪切力',
  edge_quality: '切边质量',
  trim_width_min: '最小切边宽',
  shearing_accuracy: '剪切精度',
  knife_material: '刀片材质',
  // 辊涂
  coating_type: '涂层类型',
  coating_speed: '涂覆速度',
  coating_thickness_range: '涂厚范围',
  coating_thickness_min: '最小涂厚',
  coating_thickness_max: '最大涂厚',
  coating_uniformity: '涂层均匀度',
  roller_config: '辊系配置',
  coating_head_type: '涂头形式',
  // 零部件
  application: '应用场景',
  material: '材质',
  surface_hardness: '表面硬度',
  surface_treatment: '表面处理',
  runout: '跳动精度',
  bearing: '轴承配置',
  // 联轴器
  torque_max: '最大扭矩',
  speed_max: '最大转速',
  shaft_diameter: '轴径范围',
  angular_misalignment: '角度补偿',
  // 液压锁紧
  clamping_force: '锁紧力',
  stroke: '行程',
  working_pressure: '工作压力',
  medium: '介质',
  mounting: '安装方式',
  control: '控制方式',
  explosion_proof: '防爆等级',
  // 燃油输送
  flow_rate: '流量',
  head: '扬程',
  power: '功率',
  filtration: '过滤精度',
  // 开收卷
  coil_od_max: '最大卷径',
  coil_weight_max: '最大卷重',
  uncoil_speed: '开卷速度',
  mandrel_diameter: '卷筒直径',
  recoil_speed: '卷取速度',
  expansion_method: '胀缩方式',
  welding: '焊接方式',
  type: '类型',
}

function parseSpecs(description?: string): Record<string, string> {
  if (!description) return {}
  const match = description.match(/\[规格\]\s*(.+?)(?:\[特点\]|$)/s)
  if (!match) return {}
  const specText = match[1].trim()
  const specs: Record<string, string> = {}
  for (const pair of specText.split(';')) {
    const idx = pair.indexOf(':')
    if (idx > 0) {
      const key = pair.substring(0, idx).trim()
      const val = pair.substring(idx + 1).trim()
      if (key && val) specs[key] = val
    }
  }
  return specs
}

function parseFeatures(description?: string): string[] {
  if (!description) return []
  const match = description.match(/\[特点\]\s*(.+?)(?:$)/s)
  if (!match) return []
  return match[1].split(';').map((s) => s.trim()).filter(Boolean)
}

function parseDescription(description?: string): string {
  if (!description) return ''
  const idx = description.indexOf('[规格]')
  return idx > 0 ? description.substring(0, idx).trim() : description.trim()
}

interface CatNode {
  name: string
  path: string
  children: Map<string, CatNode>
  products: Product[]
}

/** 按 product.category 的完整斜杠路径还原成层级树，产品挂在最深叶子 */
function buildProductTree(products: Product[]): CatNode {
  const root: CatNode = { name: '', path: '', children: new Map(), products: [] }
  for (const p of products) {
    const segs = (p.category || '其他').split('/').map((s) => s.trim()).filter(Boolean)
    let node = root
    let path = ''
    for (const seg of segs) {
      path = path ? `${path}/${seg}` : seg
      if (!node.children.has(seg)) {
        node.children.set(seg, { name: seg, path, children: new Map(), products: [] })
      }
      node = node.children.get(seg)!
    }
    node.products.push(p)
  }
  return root
}

function countProducts(node: CatNode): number {
  let n = node.products.length
  for (const c of node.children.values()) n += countProducts(c)
  return n
}

/** 递归目录节点：分类节点可展开/排序，产品是最深处可选中、可移动的叶子 */
function ProductTreeNode({
  node,
  depth,
  parentPath,
  siblings,
  order,
  forceOpen,
  selectedId,
  onSelectProduct,
  onReorderCat,
  onMoveProduct,
  onAddInCategory,
}: {
  node: CatNode
  depth: number
  parentPath: string
  siblings: string[]
  order: OrderMap
  forceOpen: boolean
  selectedId: string | null
  onSelectProduct: (id: string) => void
  onReorderCat: (parentPath: string, siblings: string[], key: string, dir: -1 | 1) => void
  onMoveProduct: (p: Product) => void
  onAddInCategory: (categoryPath: string) => void
}) {
  // 默认全展开：分类树是这一页的导航，收着的话每次进来都要一层层点开才知道有什么
  const [open, setOpen] = useState(true)
  const isOpen = forceOpen || open
  const total = countProducts(node)
  const idx = siblings.indexOf(node.name)
  const childNames = [...node.children.keys()]
  const orderedChildNames = applyOrder(order, node.path, childNames)
  return (
    <div className="mb-0.5 group/cat">
      <div
        className="w-full flex items-center gap-1 px-2 py-1.5 rounded-md text-sm font-medium text-ink hover:bg-canvas transition-colors"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 flex-1 min-w-0 text-left">
          {isOpen ? (
            <ChevronDown size={14} className="text-muted flex-shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-muted flex-shrink-0" />
          )}
          <Box size={15} className="flex-shrink-0 text-muted" />
          <span className="flex-1 text-left truncate">{node.name}</span>
        </button>
        <span className="text-xs text-muted bg-canvas px-1.5 py-0.5 rounded-full flex-shrink-0">{total}</span>
        <span className="hidden group-hover/cat:flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onReorderCat(parentPath, siblings, node.name, -1) }}
            disabled={idx <= 0}
            className="p-0.5 rounded text-muted hover:text-ink disabled:opacity-30"
            title="上移"
          >
            <ChevronUp size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onReorderCat(parentPath, siblings, node.name, 1) }}
            disabled={idx >= siblings.length - 1}
            className="p-0.5 rounded text-muted hover:text-ink disabled:opacity-30"
            title="下移"
          >
            <ChevronDown size={12} />
          </button>
          {/* 在本分类下直接新建：省掉「点新建 → 再从下拉里找回这个分类」两步 */}
          <button
            onClick={(e) => { e.stopPropagation(); onAddInCategory(node.path) }}
            className="p-0.5 rounded text-accent-600 hover:text-accent-700"
            title={`在「${node.name}」下新建产品`}
          >
            <Plus size={13} />
          </button>
        </span>
      </div>

      {isOpen && (
        <div>
          {orderedChildNames.map((name) => (
            <ProductTreeNode
              key={node.children.get(name)!.path}
              node={node.children.get(name)!}
              depth={depth + 1}
              parentPath={node.path}
              siblings={orderedChildNames}
              order={order}
              forceOpen={forceOpen}
              selectedId={selectedId}
              onSelectProduct={onSelectProduct}
              onReorderCat={onReorderCat}
              onMoveProduct={onMoveProduct}
              onAddInCategory={onAddInCategory}
            />
          ))}
          {node.products.map((p) => {
            const active = p.id === selectedId
            return (
              <div key={p.id} className="group/prod flex items-center" style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
                <button
                  onClick={() => onSelectProduct(p.id)}
                  className={`flex-1 min-w-0 flex items-center gap-2 pr-2 py-1.5 text-sm transition-colors ${
                    active ? 'bg-accent-50/60 text-accent-700 font-medium' : 'text-ink-soft hover:bg-canvas hover:text-ink'
                  }`}
                >
                  <Package size={14} className={`flex-shrink-0 ${active ? 'text-accent-500' : 'text-muted'}`} />
                  <span className="flex-1 text-left truncate">{p.name}</span>
                  {p.code && <span className="text-caption font-mono text-muted flex-shrink-0">{p.code}</span>}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onMoveProduct(p) }}
                  className="hidden group-hover/prod:block p-0.5 rounded text-muted hover:text-ink flex-shrink-0"
                  title="移动到其他分类"
                >
                  <FolderInput size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Products() {
  const queryClient = useQueryClient()
  const { options: categoryOptions, isLoading: categoriesLoading } = useProductCategories()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get('highlight') || ''
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 分类显示顺序（本机偏好）+ 移动产品弹窗
  const [catOrder, setCatOrder] = useState<OrderMap>(() => loadOrder('aikb-product-cat-order'))
  const [moveProduct, setMoveProduct] = useState<Product | null>(null)
  const [moveCategory, setMoveCategory] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  // kind 区分预览走哪个下载端点：产品资料在 documents，历史附件仍在 products
  const [previewAtt, setPreviewAtt] = useState<
    { id: string; fileName: string; mimeType?: string; fileSize?: number; kind?: 'documents' | 'products' } | null
  >(null)
  const [editing, setEditing] = useState<Product | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const setPageActions = usePageActions()
  // 左侧产品树可拖拽调宽（宽度存本地，右侧随 flex 伸缩）
  const navPanel = useResizablePanel('aikb-nav-width-products', 260)

  const { values: form, errors, isValid, setValue, setValues, validateAll, reset } = useFormValidation({
    initialValues: initialForm,
    rules: {
      name: required('请输入产品名称'),
    },
  })

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['products'],
    /*
     * 必须显式给 pageSize：/products 默认只回第一页 20 条，
     * 而这一页是把全部产品还原成分类树来浏览的 —— 不传的话库里 34 个产品只出来 20 个，
     * 左侧树凭空少掉一截，看起来像产品被删了。
     * 200 是后端 PaginationQueryDto 的上限，再大会被校验挡下返回 400。
     */
    queryFn: () => productApi.list({ pageSize: 200 }),
  })

  const allProducts = useMemo(() => {
    const list = Array.isArray(data) ? data : data?.list || []
    return list
  }, [data])

  const selectedProduct = useMemo(() => {
    return allProducts.find((p) => p.id === selectedId) || null
  }, [allProducts, selectedId])

  /*
   * 页面助手上下文。
   *
   * 选中某个产品时把它的技术参数和型号价格一并送进去 ——
   * "这个型号多少钱""参数是多少"是这一页最高频的问法，
   * 只给产品名的话助手只能去全库检索，答得比用户眼前看到的还差。
   */
  useRegisterPageAssistant({
    key: 'products',
    label: '产品管理',
    sourceTypes: ['product', 'solution', 'supplier', 'quotation'],
    questions: [
      '当前选中的产品有哪些技术参数？',
      '这个产品各型号的价格分别是多少？',
      '产品按分类是怎么分布的？',
      '哪些产品还没填编码或价格？',
      '这类设备通常配哪些零部件？',
    ],
    context: (() => {
      const lines = [`页面：产品管理（共 ${allProducts.length} 个产品）`]
      if (selectedProduct) {
        const p: any = selectedProduct
        lines.push(
          `当前选中产品：${p.name}（编码 ${p.code || '—'}｜分类 ${p.category || '—'}｜单位 ${p.unit || '—'}｜标准单价 ${p.price ? Number(p.price).toLocaleString('zh-CN') : '—'}）`,
        )
        if (p.description) lines.push(`说明：${p.description}`)
        const parse = (raw: any) => {
          if (!raw) return null
          if (typeof raw === 'object') return raw
          try {
            return JSON.parse(String(raw))
          } catch {
            return null
          }
        }
        const specs = parse(p.specs)
        if (Array.isArray(specs) && specs.length) {
          lines.push(
            '技术参数：' + specs.slice(0, 40).map((s: any) => `${s.name}=${s.value}`).join('，'),
          )
        }
        const prices = parse(p.priceList)
        if (Array.isArray(prices) && prices.length) {
          lines.push('型号价格：')
          lines.push(
            ...prices
              .slice(0, 30)
              .map(
                (m: any, i: number) =>
                  `  ${i + 1}. ${m.model || '—'}${m.spec ? `（${m.spec}）` : ''}` +
                  `${m.salePrice ? `｜销售价 ${Number(m.salePrice).toLocaleString('zh-CN')}` : ''}` +
                  `${m.referencePrice ? `｜参考价 ${Number(m.referencePrice).toLocaleString('zh-CN')}` : ''}`,
              ),
          )
        }
      }
      lines.push('产品清单：')
      lines.push(
        ...allProducts
          .slice(0, 40)
          .map(
            (p: any, i: number) =>
              `${i + 1}. ${p.name}｜编码 ${p.code || '—'}｜分类 ${p.category || '—'}`,
          ),
      )
      return lines.join('\n')
    })(),
  })

  // 产品全量在前端，卡片直接由树的同一份数据算，和左侧树永远对得上
  const productCards = useMemo(() => {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
    const cats = allProducts.map((p) => p.category).filter(Boolean) as string[]
    return [
      { label: '产品总数', value: allProducts.length, icon: Package },
      { label: '大类', value: new Set(cats.map((c) => c.split('/')[0])).size, icon: Box },
      { label: '细分分类', value: new Set(cats).size, icon: FolderInput },
      { label: '有编码', value: allProducts.filter((p) => !!p.code).length, icon: Hash },
      {
        label: '本月新增',
        value: allProducts.filter((p) => p.createdAt && new Date(p.createdAt).getTime() >= monthStart).length,
        icon: Plus,
      },
    ]
  }, [allProducts])

  useEffect(() => {
    if (!highlightId || !allProducts.some((product) => product.id === highlightId)) return
    setSelectedId(highlightId)
  }, [highlightId, allProducts])

  /** 产品被引用情况：报过哪些价，供再次报价时参考 */
  const usageQuery = useQuery({
    queryKey: ['product-usage', selectedId],
    queryFn: () => productApi.usage(selectedId!),
    enabled: !!selectedId,
  })

  const detailQuery = useQuery({
    queryKey: ['product', selectedId],
    queryFn: () => (selectedId ? productApi.get(selectedId) : null),
    enabled: !!selectedId,
  })

  const filteredProducts = useMemo(() => {
    if (!search) return allProducts
    const q = search.toLowerCase()
    return allProducts.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.code?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q),
    )
  }, [allProducts, search])

  const productTree = useMemo(() => buildProductTree(filteredProducts), [filteredProducts])

  const handleReorderCat = (parentPath: string, siblings: string[], key: string, dir: -1 | 1) => {
    const next = reorderOrder(catOrder, parentPath, siblings, key, dir)
    setCatOrder(next)
    saveOrder('aikb-product-cat-order', next)
  }
  const openMoveProduct = (p: Product) => {
    setMoveProduct(p)
    setMoveCategory(p.category || '')
  }
  const moveProductMutation = useMutation({
    mutationFn: ({ id, category }: { id: string; category: string }) => productApi.update(id, { category }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setMoveProduct(null)
      refetch()
      toast.success('已移动到新分类')
    },
    onError: handleError,
  })

  const saveMutation = useMutation({
    mutationFn: (dto: any) => {
      if (editing) return productApi.update(editing.id, dto)
      return productApi.create(dto)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      closeModal()
      refetch()
    },
    onError: handleError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => productApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      setDeleteId(null)
      setSelectedId(null)
      refetch()
    },
    onError: handleError,
  })

  const openCreate = () => {
    setEditing(null)
    reset()
    setModalOpen(true)
  }

  /**
   * 从树上的分类节点直接新建产品：把该节点的完整路径预填进「分类」。
   * 原来只有顶栏一个「新建产品」，建完还得在几十项的分类里翻回刚才那一类。
   */
  const openCreateInCategory = (categoryPath: string) => {
    setEditing(null)
    setValues({ ...initialForm, category: categoryPath })
    setModalOpen(true)
  }

  // 顶栏操作区：搜索框 + 新建产品（与其他列表页保持一致的主题按钮布局）
  useEffect(() => {
    setPageActions(
      <>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          {/* 非受控：受控 value 在 IME 组字时被重渲染打断（拼音乱码），搜索只靠 onChange */}
          <input
            placeholder="搜索产品名称、编码、分类"
            onChange={(e) => setSearch(e.target.value)}
            className="eo-input !w-60 !pl-8 !py-1 !text-sm"
          />
        </div>
        <Button onClick={openCreate} size="sm" className="!py-1 !text-sm">
          <Plus size={13} className="mr-0.5" /> 新建产品
        </Button>
      </>
    )
    return () => setPageActions(null)
     
  }, [])

  const openEdit = (product: Product) => {
    setEditing(product)
    setValues({
      name: product.name || '',
      code: product.code || '',
      category: product.category || '',
      unit: product.unit || '',
      description: product.description || '',
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    reset()
  }

  const selectProduct = (id: string) => {
    setSelectedId(id)
  }

  const handleSubmit = () => {
    if (!validateAll()) return
    saveMutation.mutate({ ...form })
  }

  /*
   * 产品资料改走「业务资料」。
   *
   * 原来存在 product_attachments 里，只有产品页看得见，业务资料库里根本没有它们；
   * 上传时那个「CAD图纸/技术协议/报价模板」下拉也是这套私有分类，和业务资料的分类体系对不上。
   * 现在统一传进 documents，分类用 `product:产品名` —— 业务资料页会把这类分类
   * 自动归到「产品资料」大类下，等于每个产品在资料库里自动有了一个文件夹。
   */
  const productDocCategory = selectedProduct ? `product:${selectedProduct.name}` : ''

  const productDocsQuery = useQuery({
    queryKey: ['product-docs', productDocCategory],
    queryFn: () => documentApi.list({ category: productDocCategory, pageSize: 200 }),
    enabled: !!productDocCategory,
  })
  const productDocs = toList<any>(productDocsQuery.data)

  const [uploadingDoc, setUploadingDoc] = useState(false)

  const uploadProductDocs = async (files: FileList | File[] | null) => {
    const list = Array.from(files || [])
    if (!list.length || !selectedProduct) return
    setUploadingDoc(true)
    let ok = 0
    for (const file of list) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', file.name)
      fd.append('category', productDocCategory)
      fd.append('visibility', 'public')
      try {
        await documentApi.upload(fd)
        ok++
      } catch (err) {
        handleError(err)
      }
    }
    setUploadingDoc(false)
    if (fileRef.current) fileRef.current.value = ''
    if (ok) {
      queryClient.invalidateQueries({ queryKey: ['product-docs', productDocCategory] })
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['module-stats'] })
      toast.success(`已上传 ${ok} 个文件到「${selectedProduct.name}」资料`)
    }
  }

  const detail = detailQuery.data

  /*
   * 产品资料 / 历史附件的删除。
   *
   * 这两处原来是 onClick 里直接调接口：删除图标要鼠标划过卡片才浮现，
   * 且紧挨着预览和下载 —— 手一歪资料就没了。改成走确认弹窗。
   */
  const [deletingDoc, setDeletingDoc] = useState<{ id: string; name: string } | null>(null)
  const [deletingAtt, setDeletingAtt] = useState<{ id: string; name: string } | null>(null)

  const deleteProductDocMutation = useMutation({
    mutationFn: (id: string) => documentApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-docs', productDocCategory] })
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      setDeletingDoc(null)
      toast.success('已删除，可在「系统设置 → 回收站」还原')
    },
    onError: handleError,
  })

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attId: string) => productApi.removeAttachment(detail!.id, attId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', detail?.id] })
      setDeletingAtt(null)
      toast.success('已删除')
    },
    onError: handleError,
  })

  /*
   * 型号价格表：一个系列下多个型号（如 BJ125D-1450）各自一档价格。
   * 本地编辑、点保存整体覆盖 —— 行级单独保存会把接口次数打散，
   * 且行与行之间的删除/新增本来就是一个整体变更。
   */
  const [priceRows, setPriceRows] = useState<ProductPriceItem[]>([])
  useEffect(() => {
    setPriceRows((detail?.priceList || []).map((r) => ({ ...r })))
    // 切换产品或服务端数据刷新时重新同步本地草稿
     
  }, [detail?.id, detail?.updatedAt])

  const priceDirty = useMemo(
    () => JSON.stringify(priceRows) !== JSON.stringify(detail?.priceList || []),
    [priceRows, detail?.priceList],
  )

  const updatePriceRow = (idx: number, field: keyof ProductPriceItem, value: any) => {
    setPriceRows((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)))
  }
  const removePriceRow = (idx: number) => setPriceRows((rows) => rows.filter((_, i) => i !== idx))

  const savePriceListMutation = useMutation({
    mutationFn: (rows: ProductPriceItem[]) => productApi.update(detail!.id, { priceList: rows }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', detail?.id] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      detailQuery.refetch()
      toast.success('型号价格表已保存')
    },
    onError: handleError,
  })

  const savePriceList = () => {
    // 空型号行直接丢掉，避免存进一堆无名行；同步写入最近修改时间
    const rows = priceRows
      .filter((r) => r.model?.trim())
      .map((r) => ({ ...r, model: r.model.trim(), updatedAt: new Date().toISOString() }))
    savePriceListMutation.mutate(rows)
  }

  /*
   * 技术参数：结构化 specs 字段优先；旧产品（如化涂机）的参数写在描述
   * [规格] 段里，解析后兼容展示与编辑，保存后统一落到 specs 字段。
   * 卡片对所有产品（含全部叶子产品）常驻，不再只在有参数时才显示。
   */
  const legacySpecs = useMemo<ProductSpecItem[]>(() => {
    const parsed = parseSpecs(detail?.description)
    return Object.entries(parsed).map(([key, val]) => ({
      name: specLabels[key] || key,
      value: String(val),
    }))
     
  }, [detail?.id, detail?.description])
  const baseSpecs = detail?.specs ?? legacySpecs

  const [specRows, setSpecRows] = useState<ProductSpecItem[]>([])
  useEffect(() => {
    setSpecRows(baseSpecs.map((r) => ({ ...r })))
    // 切换产品或服务端数据刷新时重新同步本地草稿
     
  }, [detail?.id, detail?.updatedAt])

  const specDirty = useMemo(
    () => JSON.stringify(specRows) !== JSON.stringify(baseSpecs),
    [specRows, baseSpecs],
  )

  const updateSpecRow = (idx: number, field: keyof ProductSpecItem, value: string) => {
    setSpecRows((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)))
  }
  const addSpecRow = () => setSpecRows((rows) => [...rows, { name: '', value: '' }])
  const removeSpecRow = (idx: number) => setSpecRows((rows) => rows.filter((_, i) => i !== idx))

  const saveSpecsMutation = useMutation({
    mutationFn: (rows: ProductSpecItem[]) => productApi.update(detail!.id, { specs: rows }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', detail?.id] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      detailQuery.refetch()
      toast.success('技术参数已保存')
    },
    onError: handleError,
  })

  const saveSpecs = () => {
    // 参数名为空的行直接丢掉；值统一去首尾空格
    const rows = specRows
      .filter((r) => r.name?.trim())
      .map((r) => ({ name: r.name.trim(), value: (r.value || '').trim() }))
    saveSpecsMutation.mutate(rows)
  }

  /*
   * 添加型号走弹窗：型号多了以后行内无限加行会撑爆布局，
   * 弹窗只录入型号与多档价格，确认后直接落库。
   */
  const emptyAddForm: {
    model: string
    costPrice?: number
    referencePrice?: number
    standardPrice?: number
    salePrice?: number
    unit: string
    remark: string
  } = { model: '', costPrice: undefined, referencePrice: undefined, standardPrice: undefined, salePrice: undefined, unit: '', remark: '' }
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState(emptyAddForm)
  const priceImportRef = useRef<HTMLInputElement>(null)

  // 「查询」弹窗：列表展示所有已添加型号的报价信息，支持弹窗内搜索
  const [viewOpen, setViewOpen] = useState(false)
  const [viewSearch, setViewSearch] = useState('')

  const openAddModal = () => {
    setAddForm(emptyAddForm)
    setAddOpen(true)
  }

  const confirmAddModel = () => {
    const model = addForm.model.trim()
    if (!model || !detail) return
    const row: ProductPriceItem = { ...addForm, model, updatedAt: new Date().toISOString() }
    setAddOpen(false)
    // 确认即落库：弹窗录入是明确动作，不应再依赖外层「保存」
    savePriceListMutation.mutate([...priceRows.filter((r) => r.model?.trim()), row])
  }

  const filteredViewRows = useMemo(() => {
    const q = viewSearch.trim().toLowerCase()
    if (!q) return priceRows
    return priceRows.filter((r) =>
      [r.model, r.spec, r.remark].some((v) => v && String(v).toLowerCase().includes(q)),
    )
  }, [priceRows, viewSearch])

  /** 型号价格表导出：fetch + blob，认证在 httpOnly Cookie */
  const exportPriceList = async () => {
    if (!detail) return
    try {
      const res = await fetch(productApi.priceListExportUrl(detail.id), { credentials: 'include' })
      if (!res.ok) throw new Error(res.status === 403 ? '无权导出' : '导出失败')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `aikb-${detail.name}-型号价格表-${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('导出完成')
    } catch (e: any) {
      toast.error(e?.message || '导出失败')
    }
  }

  /** 型号价格表导入：后端按型号匹配合并（已有更新/新增追加）后直接落库 */
  const handlePriceImport = (files: FileList | null) => {
    const file = files?.[0]
    if (!file || !detail) return
    if (priceDirty) toast.warning('本地有未保存的修改，导入将以服务端数据为准')
    const fd = new FormData()
    fd.append('file', file)
    productApi
      .importPriceList(detail.id, fd)
      .then((res) => {
        toast.success(`导入完成：新增 ${res.added} 个型号，更新 ${res.updated} 个`)
        if (res.errors?.length) toast.warning(`${res.errors.length} 行导入失败`)
        queryClient.invalidateQueries({ queryKey: ['product', detail.id] })
        detailQuery.refetch()
      })
      .catch(handleError)
      .finally(() => {
        if (priceImportRef.current) priceImportRef.current.value = ''
      })
  }

  const features = detail ? parseFeatures(detail.description) : []
  const descText = detail ? parseDescription(detail.description) : ''
  const categoryBreadcrumb = detail?.category?.includes('/')
    ? detail.category.split('/')
    : detail?.category
      ? [detail.category]
      : []

  /*
   * 档案价与型号价格表联动：型号表里的销售价才是对外报价基准，
   * 头部与「标准单价」优先按型号表汇总成销售价区间；
   * 没有型号表时回退到档案上的单个 price 字段。
   */
  const savedPriceList = detail?.priceList || []
  const effectivePrices = (() => {
    const fromTable = savedPriceList.map((r) => Number(r.salePrice)).filter((n) => n > 0)
    if (fromTable.length) return fromTable
    const single = Number(detail?.price) || 0
    return single > 0 ? [single] : []
  })()
  const priceMin = effectivePrices.length ? Math.min(...effectivePrices) : 0
  const priceMax = effectivePrices.length ? Math.max(...effectivePrices) : 0
  const priceFromTable = effectivePrices.length > 0 && savedPriceList.length > 0
  const priceSummary = !effectivePrices.length
    ? ''
    : priceMin === priceMax
      ? `¥${priceMin.toLocaleString('zh-CN')}`
      : `¥${priceMin.toLocaleString('zh-CN')} ~ ¥${priceMax.toLocaleString('zh-CN')}`

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] -m-6 overflow-hidden">
      {/* 统计卡片：与业务概览/客户中心同一套组件 */}
      <div className="px-6 pt-4 pb-3 border-b border-border flex-shrink-0">
        <StatCards loading={isLoading} skeletonCount={5} items={productCards} />
        <ProductCompletenessBar onPick={setSelectedId} />
      </div>

      <div className="flex gap-0 flex-1 overflow-hidden">
      {/* ===================== Left: Tree sidebar ===================== */}
      <aside className="w-[260px] flex-shrink-0 flex flex-col bg-surface border-r border-border overflow-hidden" style={navPanel.panelStyle}>
        {/* Tree */}
        <div className="flex-1 overflow-y-auto py-2 px-1.5 eo-scroll">
          {isLoading && <div className="py-8"><PageLoader /></div>}
          {isError && <ErrorState message={error?.message} onRetry={refetch} />}
          {!isLoading && !isError && productTree.children.size === 0 && (
            <div className="text-center py-8 text-sm text-muted">暂无产品</div>
          )}
          {applyOrder(catOrder, '', [...productTree.children.keys()]).map((name) => (
            <ProductTreeNode
              key={productTree.children.get(name)!.path}
              node={productTree.children.get(name)!}
              depth={0}
              parentPath=""
              siblings={applyOrder(catOrder, '', [...productTree.children.keys()])}
              order={catOrder}
              forceOpen={!!search}
              selectedId={selectedId}
              onSelectProduct={selectProduct}
              onReorderCat={handleReorderCat}
              onMoveProduct={openMoveProduct}
              onAddInCategory={openCreateInCategory}
            />
          ))}
        </div>
      </aside>
      <ResizeHandle onMouseDown={navPanel.startDrag} />

      {/* ===================== Right: Detail panel ===================== */}
      <div className="flex-1 overflow-y-auto eo-scroll">
        {!selectedProduct ? (
          /* Empty state */
          <ProductGapList onPick={setSelectedId} />
        ) : detailQuery.isLoading ? (
          <div className="p-6"><PageLoader /></div>
        ) : detailQuery.isError ? (
          <div className="p-6"><ErrorState message={detailQuery.error?.message} onRetry={() => detailQuery.refetch()} /></div>
        ) : detail ? (
          <div className="p-6 max-w-[1400px]">
            {/* === Header card === */}
            <div className="bg-surface rounded-xl border border-border shadow-card overflow-hidden mb-4">
              <div className="flex items-start gap-4 p-5">
                {/* Product icon/thumbnail */}
                <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-accent-500/10 to-accent-300/10 border border-accent-200/30 flex items-center justify-center flex-shrink-0">
                  <Package size={30} className="text-accent-500" />
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-lg font-serif font-semibold text-ink">{detail.name}</h2>
                    <StatusBadge kind="library" status={detail.status} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted mb-2">
                    {detail.code && <span className="font-mono">编码: {detail.code}</span>}
                    {categoryBreadcrumb.length > 0 && (
                      <span>分类: {categoryBreadcrumb.join(' › ')}</span>
                    )}
                    {detail.unit && <span>单位: {detail.unit}</span>}
                  </div>
                  {descText && <p className="text-sm text-ink-soft leading-relaxed">{descText}</p>}
                  {features.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {features.map((f) => (
                        <span
                          key={f}
                          className="inline-flex items-center px-2 py-0.5 text-caption font-medium text-accent-700 bg-accent-50 border border-accent-200/50 rounded-full"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {/* Price + actions：优先展示型号价格表汇总出的销售价区间 */}
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  {effectivePrices.length > 0 && (
                    <div className="text-right">
                      <div className="text-xl font-serif font-bold text-accent-600">{priceSummary}</div>
                      <div className="text-xs text-muted">
                        {priceFromTable ? `销售价区间 · ${savedPriceList.length} 个型号` : detail.unit || '件'}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEdit(detail)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-canvas transition-colors"
                      title="编辑"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => setDeleteId(detail.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-danger-fg hover:bg-danger-bg transition-colors"
                      title="删除"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/*
              被引用情况。
              产品页此前是个孤岛：能看参数、能改价，却答不上业务上最常问的
              「这个型号我们报过几次、报什么价、卖给过谁」—— 而那正是再次报价的定价依据。
            */}
            <div className="bg-surface rounded-xl border border-border shadow-card p-5 mb-4">
              {/*
                这里是产品档案里的「价格信息」，是下方「型号价格表」的汇总视图：
                标准单价 = 型号表各型号销售价的汇总（区间），没有型号表时回退到档案单价；
                成交价区间仍取自报价明细的实际成交，作为定价校验。
                报价单是客户业务侧的单据，这里只存档案口径。
              */}
              <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
                <DollarSign size={16} className="text-accent-500" /> 价格信息
                {usageQuery.data?.stats?.count ? (
                  <span className="text-xs font-normal text-muted">
                    含 {usageQuery.data.stats.count} 条成交参考
                  </span>
                ) : null}
              </h3>

              {/* 档案价：产品自身的挂牌信息，与有没有报过价无关 */}
              <div className="overflow-x-auto mb-3">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-border">
                      <td className="py-2 pr-4 text-muted whitespace-nowrap w-28">型号规格</td>
                      <td className="py-2 text-ink font-medium">{detail.name}{detail.code ? ` / ${detail.code}` : ''}</td>
                      <td className="py-2 pr-4 text-muted whitespace-nowrap w-28">计价单位</td>
                      <td className="py-2 text-ink">{detail.unit || '—'}</td>
                    </tr>
                    <tr className="border-b border-border">
                      <td className="py-2 pr-4 text-muted whitespace-nowrap">标准单价</td>
                      <td className="py-2 eo-num text-ink">
                        {effectivePrices.length ? (
                          <>
                            {priceSummary}
                            {priceFromTable && (
                              <span className="text-xs text-muted ml-1.5">来自下方型号价格表销售价汇总</span>
                            )}
                          </>
                        ) : (
                          '未定价'
                        )}
                      </td>
                      <td className="py-2 pr-4 text-muted whitespace-nowrap">所属分类</td>
                      <td className="py-2 text-ink">{categoryBreadcrumb.join(' › ') || '—'}</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 text-muted whitespace-nowrap align-top">成交价区间</td>
                      <td className="py-2 eo-num text-ink" colSpan={3}>
                        {usageQuery.data?.stats?.count
                          ? `¥${(usageQuery.data.stats.minPrice ?? 0).toLocaleString('zh-CN')} ~ ¥${(usageQuery.data.stats.maxPrice ?? 0).toLocaleString('zh-CN')}\u3000（均价 ¥${Math.round(usageQuery.data.stats.avgPrice ?? 0).toLocaleString('zh-CN')}）`
                          : '暂无成交记录'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="eo-label mb-1.5">历史成交参考</div>
              {usageQuery.isLoading ? (
                <p className="text-sm text-muted py-2">加载中…</p>
              ) : !usageQuery.data?.quotations?.length ? (
                <div className="text-sm text-muted py-1">
                  暂无成交记录。
                  <span className="text-xs">
                    （只统计在报价明细里明确选了本产品的记录；早期手工录入的明细没有这个关联）
                  </span>
                </div>
              ) : (
                /* 列表式：一行一条成交，字段横向对齐才好比价 */
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted bg-canvas">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium rounded-l-md whitespace-nowrap">报价单号</th>
                        <th className="text-left px-3 py-2 font-medium">客户</th>
                        <th className="text-left px-3 py-2 font-medium">项目</th>
                        <th className="text-right px-3 py-2 font-medium whitespace-nowrap">成交单价</th>
                        <th className="text-right px-3 py-2 font-medium whitespace-nowrap">数量</th>
                        <th className="text-right px-3 py-2 font-medium rounded-r-md whitespace-nowrap">小计</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageQuery.data.quotations.map((q: any) => (
                        <tr
                          key={q.quotationId}
                          onClick={() => navigate(`/quotations?highlight=${q.quotationId}`)}
                          className="border-t border-border hover:bg-accent-50/40 transition-colors cursor-pointer"
                          title="打开该报价单"
                        >
                          <td className="px-3 py-2 eo-num text-xs text-accent-700 whitespace-nowrap">{q.quotationNo}</td>
                          <td className="px-3 py-2 text-muted truncate max-w-[10rem]">{q.customerShortName || '—'}</td>
                          <td className="px-3 py-2 text-ink truncate max-w-[14rem]">{q.projectName || '未关联项目'}</td>
                          <td className="px-3 py-2 text-right eo-num text-ink whitespace-nowrap">
                            ¥{Number(q.unitPrice || 0).toLocaleString('zh-CN')}
                          </td>
                          <td className="px-3 py-2 text-right text-muted whitespace-nowrap">{q.quantity}</td>
                          <td className="px-3 py-2 text-right eo-num text-ink whitespace-nowrap">
                            ¥{(Number(q.unitPrice || 0) * Number(q.quantity || 0)).toLocaleString('zh-CN')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/*
              型号价格表：系列内各型号的多档价格（成本/参考/标配/销售）。
              后续新增型号（如 BJ125D-1450）点「添加型号」弹窗录入（含历史报价参考），
              每个叶子产品（液压螺母、两弯一矫、单塔圆盘剪等）都有这张表，支持 Excel 导入/导出。
            */}
            <div className="bg-surface rounded-xl border border-border shadow-card p-5 mb-4">
              <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
                <Tags size={16} className="text-accent-500" /> 型号价格表
                <span className="text-xs text-muted font-normal">
                  {priceRows.length ? `${priceRows.length} 个型号` : '暂无型号，点右侧添加'}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setViewSearch('')
                      setViewOpen(true)
                    }}
                    className="!py-1 !text-xs"
                  >
                    <Search size={13} className="mr-0.5" /> 查询
                  </Button>
                  <input
                    ref={priceImportRef}
                    type="file"
                    accept=".xlsx,.csv"
                    className="hidden"
                    onChange={(e) => handlePriceImport(e.target.files)}
                  />
                  <Button variant="secondary" size="sm" onClick={() => priceImportRef.current?.click()} className="!py-1 !text-xs">
                    <Upload size={13} className="mr-0.5" /> 导入
                  </Button>
                  <Button variant="secondary" size="sm" onClick={exportPriceList} className="!py-1 !text-xs">
                    <Download size={13} className="mr-0.5" /> 导出
                  </Button>
                  <Button variant="secondary" size="sm" onClick={openAddModal} className="!py-1 !text-xs">
                    <Plus size={13} className="mr-0.5" /> 添加型号
                  </Button>
                  <Button
                    size="sm"
                    onClick={savePriceList}
                    disabled={!priceDirty}
                    loading={savePriceListMutation.isPending}
                    className="!py-1 !text-xs"
                  >
                    保存
                  </Button>
                </div>
              </h3>

              {priceRows.length === 0 ? (
                <p className="text-sm text-muted py-1">
                  尚未录入型号价格。系列内新增型号时在此加行，逐型号记录成本价、参考价、标配价、销售价。
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted bg-canvas">
                      <tr>
                        <th className="text-left px-2 py-2 font-medium rounded-l-md whitespace-nowrap">型号规格 *</th>
                        <th className="text-left px-2 py-2 font-medium whitespace-nowrap">关键参数</th>
                        <th className="text-right px-2 py-2 font-medium whitespace-nowrap">成本价</th>
                        <th className="text-right px-2 py-2 font-medium whitespace-nowrap">参考价</th>
                        <th className="text-right px-2 py-2 font-medium whitespace-nowrap">标配价</th>
                        <th className="text-right px-2 py-2 font-medium whitespace-nowrap">销售价</th>
                        <th className="text-right px-2 py-2 font-medium whitespace-nowrap">毛利率</th>
                        <th className="text-left px-2 py-2 font-medium">备注</th>
                        <th className="w-8 rounded-r-md"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {priceRows.map((row, idx) => {
                        const margin =
                          row.salePrice && row.costPrice && row.salePrice > row.costPrice
                            ? (((row.salePrice - row.costPrice) / row.salePrice) * 100).toFixed(1)
                            : null
                        return (
                          <tr key={idx} className="border-t border-border hover:bg-canvas/40 transition-colors">
                            <td className="px-2 py-1.5">
                              <input
                                placeholder="如 BJ125D-1450"
                                value={row.model}
                                onChange={(e) => updatePriceRow(idx, 'model', e.target.value)}
                                className="w-36 px-2 py-1 border border-border rounded text-sm"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                placeholder="参数/配置"
                                value={row.spec || ''}
                                onChange={(e) => updatePriceRow(idx, 'spec', e.target.value)}
                                className="w-32 px-2 py-1 border border-border rounded text-sm"
                              />
                            </td>
                            {(['costPrice', 'referencePrice', 'standardPrice', 'salePrice'] as const).map((f) => (
                              <td key={f} className="px-2 py-1.5">
                                <input
                                  type="number"
                                  placeholder="0"
                                  value={row[f] ?? ''}
                                  onChange={(e) =>
                                    updatePriceRow(idx, f, e.target.value === '' ? undefined : Number(e.target.value))
                                  }
                                  className="w-24 px-2 py-1 border border-border rounded text-sm text-right eo-num"
                                />
                              </td>
                            ))}
                            <td className="px-2 py-1.5 text-right eo-num whitespace-nowrap">
                              {margin ? (
                                <span className={Number(margin) >= 20 ? 'text-success-fg' : 'text-warning-fg'}>{margin}%</span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                placeholder="备注"
                                value={row.remark || ''}
                                onChange={(e) => updatePriceRow(idx, 'remark', e.target.value)}
                                className="w-28 px-2 py-1 border border-border rounded text-sm"
                              />
                            </td>
                            <td className="px-1 py-1.5">
                              <button
                                onClick={() => removePriceRow(idx)}
                                className="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-danger-fg hover:bg-danger-bg transition-colors"
                                title="删除该行"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {priceDirty && priceRows.length > 0 && (
                <p className="text-caption text-warning-fg mt-2">有未保存的修改，点右上「保存」生效</p>
              )}
            </div>

            {/* === Technical Parameters（结构化可编辑，所有产品常驻） === */}
            <div className="bg-surface rounded-xl border border-border shadow-card p-5 mb-4">
              <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
                <Ruler size={16} className="text-accent-500" /> 技术参数
                <span className="text-xs text-muted font-normal">
                  {specRows.length ? `${specRows.length} 项` : '暂无参数，点右侧添加'}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={addSpecRow} className="!py-1 !text-xs">
                    <Plus size={13} className="mr-0.5" /> 添加参数
                  </Button>
                  <Button
                    size="sm"
                    onClick={saveSpecs}
                    disabled={!specDirty}
                    loading={saveSpecsMutation.isPending}
                    className="!py-1 !text-xs"
                  >
                    保存
                  </Button>
                </div>
              </h3>
              {specRows.length === 0 ? (
                <p className="text-sm text-muted py-1">
                  暂无技术参数。点右上「添加参数」逐行录入（如 涂覆速度、辊径、适用带宽）。
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {specRows.map((row, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 bg-gradient-to-br from-canvas to-white border border-border rounded-lg px-2.5 py-2 transition-all hover:border-accent-200"
                    >
                      <input
                        placeholder="参数名"
                        value={row.name}
                        onChange={(e) => updateSpecRow(idx, 'name', e.target.value)}
                        className="w-32 flex-shrink-0 px-2 py-1 border border-border rounded text-sm"
                      />
                      <input
                        placeholder="参数值，如 0~30 m/min"
                        value={row.value}
                        onChange={(e) => updateSpecRow(idx, 'value', e.target.value)}
                        className="flex-1 min-w-0 px-2 py-1 border border-border rounded text-sm"
                      />
                      <button
                        onClick={() => removeSpecRow(idx)}
                        className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded text-muted hover:text-danger-fg hover:bg-danger-bg transition-colors"
                        title="删除该参数"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {specDirty && specRows.length > 0 && (
                <p className="text-caption text-warning-fg mt-2">有未保存的修改，点右上「保存」生效</p>
              )}
            </div>

            {/* === 采购来源：供应产品 → 本产品，报价自动带成本 === */}
            <ProductSupplySources productId={detail.id} />

            {/* === BOM Table === */}
            {detail.boms && detail.boms.length > 0 && (
              <div className="bg-surface rounded-xl border border-border shadow-card p-5 mb-4">
                <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
                  <Box size={16} className="text-accent-500" /> BOM 物料清单
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted bg-canvas">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium rounded-l-md">物料名称</th>
                        <th className="text-left px-3 py-2 font-medium">规格</th>
                        <th className="text-right px-3 py-2 font-medium">数量</th>
                        <th className="text-left px-3 py-2 font-medium">单位</th>
                        <th className="text-right px-3 py-2 font-medium rounded-r-md">成本</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.boms.map((bom, idx) => (
                        <tr key={idx} className="border-t border-border hover:bg-canvas/50 transition-colors">
                          <td className="px-3 py-2 font-medium text-ink">{bom.materialName}</td>
                          <td className="px-3 py-2 text-muted">{bom.specification || '-'}</td>
                          <td className="px-3 py-2 text-right text-ink">{bom.quantity}</td>
                          <td className="px-3 py-2 text-muted">{bom.unit || '-'}</td>
                          <td className="px-3 py-2 text-right text-muted">{bom.cost ? `¥${Number(bom.cost).toLocaleString()}` : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* === Related Documents === */}
            <div className="bg-surface rounded-xl border border-border shadow-card p-5">
              <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
                <Paperclip size={16} className="text-accent-500" /> 相关文档
                <span className="text-xs text-muted font-normal">({productDocs.length})</span>
                <span className="ml-auto text-caption text-muted font-normal">
                  归入业务资料 · 产品资料 / {detail.name}
                </span>
              </h3>

              {/* 上传区：点整块就能选文件，也可直接拖进来 */}
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); uploadProductDocs(e.dataTransfer.files) }}
                className="cursor-pointer border-2 border-dashed border-border rounded-lg py-5 text-center hover:border-accent-300 hover:bg-accent-50/30 transition-colors mb-3"
              >
                <Upload size={20} className="text-muted mx-auto mb-1.5" />
                <p className="text-sm text-muted">
                  {uploadingDoc ? '上传中…' : '点击或拖拽文件到此处上传'}
                </p>
                <p className="text-caption text-muted mt-0.5">
                  自动归档到业务资料的「{detail.name}」文件夹，在业务资料页也能找到
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => uploadProductDocs(e.target.files)}
                />
              </div>

              {productDocsQuery.isLoading ? (
                <p className="text-sm text-muted py-2">加载中…</p>
              ) : productDocs.length > 0 ? (
                <div className="space-y-1.5">
                  {productDocs.map((doc: any) => (
                    <div
                      key={doc.id}
                      className="group flex items-center gap-3 bg-canvas border border-border rounded-lg px-3 py-2 hover:border-accent-200 transition-all"
                    >
                      <FileText size={16} className="text-accent-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-ink truncate">{doc.title || doc.fileName}</div>
                        <div className="text-caption text-muted">
                          {doc.fileSize ? `${(doc.fileSize / 1024).toFixed(0)}KB` : ''}
                          {doc.createdAt ? ` · ${new Date(doc.createdAt).toLocaleDateString('zh-CN')}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() =>
                            setPreviewAtt({
                              id: doc.id,
                              fileName: doc.fileName || doc.title || 'preview',
                              mimeType: doc.mimeType,
                              fileSize: doc.fileSize,
                              kind: 'documents',
                            })
                          }
                          className="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-accent-600 hover:bg-accent-50 transition-colors"
                          title="预览"
                        >
                          <Scan size={15} />
                        </button>
                        <button
                          onClick={() =>
                            downloadFile('documents', doc.id, doc.fileName || doc.title || 'download').catch(
                              (e: { message?: string }) => toast.error(e?.message || '下载失败'),
                            )
                          }
                          className="w-7 h-7 flex items-center justify-center rounded text-accent-600 hover:bg-accent-50 transition-colors"
                          title="下载"
                        >
                          <Download size={15} />
                        </button>
                        <button
                          onClick={() => setDeletingDoc({ id: doc.id, name: doc.title || doc.fileName || '该资料' })}
                          className="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-danger-fg hover:bg-danger-bg transition-colors"
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted py-1">
                  暂无产品资料。可上传图纸、样本、说明书等，供出方案时直接取用。
                </p>
              )}

              {/* 历史附件：老数据存在 product_attachments 里，只读展示，不再新增 */}
              {detail.attachments && detail.attachments.length > 0 && (
                <>
                <div className="eo-label mt-4 mb-1.5">历史附件（旧存储，仅供查看下载）</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-3">
                  {detail.attachments.map((att) => {
                    const Icon = attachmentTypeIcons[att.attachmentType || 'other'] || FileText
                    return (
                      <div
                        key={att.id}
                        className="group flex items-center gap-3 bg-gradient-to-r from-canvas to-white border border-border rounded-lg p-3 hover:border-accent-200 hover:shadow-sm transition-all"
                      >
                        <div className="w-9 h-9 rounded-lg bg-accent-50 flex items-center justify-center flex-shrink-0">
                          <Icon size={17} className="text-accent-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-ink truncate">{att.fileName}</div>
                          <div className="text-xs text-muted">
                            {attachmentTypeOptions.find((o) => o.value === att.attachmentType)?.label || '其他'}
                            {' · '}
                            {(att.fileSize / 1024).toFixed(0)}KB
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() =>
                              setPreviewAtt({
                                id: att.id,
                                fileName: att.fileName || 'preview',
                                mimeType: att.mimeType,
                                fileSize: att.fileSize,
                              })
                            }
                            className="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-accent-600 hover:bg-accent-50 transition-colors"
                            title="预览"
                            aria-label="预览"
                          >
                            <Scan size={15} />
                          </button>
                          <button
                            onClick={() =>
                              downloadFile('products', att.id, att.fileName).catch((e: { message?: string }) =>
                                toast.error(e?.message || '下载失败'),
                              )
                            }
                            className="w-7 h-7 flex items-center justify-center rounded text-accent-600 hover:bg-accent-50 transition-colors"
                            title="下载"
                            aria-label="下载"
                          >
                            <Download size={15} />
                          </button>
                          <button
                            onClick={() => setDeletingAtt({ id: att.id, name: att.fileName || '该附件' })}
                            className="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-danger-fg hover:bg-danger-bg transition-colors"
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
      </div>

      {/* ===================== Modals ===================== */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? '编辑产品' : '新建产品'}
        onConfirm={handleSubmit}
        loading={saveMutation.isPending}
        confirmDisabled={!isValid}
        size="lg"
      >
        <div className="space-y-6">
          <FormSection title="基本信息" icon={Package}>
          <FieldGrid>
            <FormInput label="产品名称" value={form.name} onChange={(e) => setValue('name', e.target.value)} error={errors.name} required />
            <FormInput label="产品编码" value={form.code} onChange={(e) => setValue('code', e.target.value)} />
            <SearchableSelect
              label="分类"
              options={withLegacyCategory(categoryOptions, form.category)}
              value={form.category}
              onChange={(v) => setValue('category', v)}
              groupBySlash
              placeholder={categoriesLoading ? '加载中…' : '输入以筛选，或点击展开选择'}
              emptyText="没有匹配的分类"
              helper="分类来自「需求模板」，新增分类请到需求模板页新建模板"
            />
            <FormInput label="单位" value={form.unit} onChange={(e) => setValue('unit', e.target.value)} />
            <div className="md:col-span-2">
              <FormTextarea label="描述" value={form.description} onChange={(e) => setValue('description', e.target.value)} rows={3} />
            </div>
          </FieldGrid>
          </FormSection>
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
        <p className="text-sm text-ink-soft">确定要删除该产品吗？</p>
        <DeleteImpact type="product" id={deleteId} />
      </Modal>

      {/* 产品资料：软删，进系统回收站 */}
      <ConfirmDialog
        open={!!deletingDoc}
        onClose={() => setDeletingDoc(null)}
        onConfirm={() => deletingDoc && deleteProductDocMutation.mutate(deletingDoc.id)}
        loading={deleteProductDocMutation.isPending}
        message={<>确定删除产品资料「{deletingDoc?.name}」吗？</>}
        detail="删除后进入系统回收站，保留 30 天内可还原；期间出方案时取不到这份资料。"
      />

      {/* 历史附件：老存储里的文件，删了就没了 */}
      <ConfirmDialog
        open={!!deletingAtt}
        onClose={() => setDeletingAtt(null)}
        onConfirm={() => deletingAtt && deleteAttachmentMutation.mutate(deletingAtt.id)}
        loading={deleteAttachmentMutation.isPending}
        message={<>确定删除历史附件「{deletingAtt?.name}」吗？</>}
        detail="历史附件存在旧存储里，不进回收站，删除后无法恢复。"
      />

      {/* 移动产品到其他分类（分类来自需求模板） */}
      <Modal
        open={!!moveProduct}
        onClose={() => setMoveProduct(null)}
        title="移动产品到其他分类"
        onConfirm={() => moveProduct && moveProductMutation.mutate({ id: moveProduct.id, category: moveCategory })}
        loading={moveProductMutation.isPending}
        confirmDisabled={!moveCategory || moveCategory === moveProduct?.category}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">把「{moveProduct?.name}」移动到：</p>
          <SearchableSelect
            label="目标分类"
            options={withLegacyCategory(categoryOptions, moveProduct?.category)}
            value={moveCategory}
            onChange={setMoveCategory}
            groupBySlash
            placeholder={categoriesLoading ? '加载中…' : '输入以筛选，或点击展开选择'}
            emptyText="没有匹配的分类"
            helper="分类来自「需求模板」；如需新增分类请到需求模板页新建"
          />
        </div>
      </Modal>

      {/*
        添加型号弹窗：聚焦型号与多档价格录入，备注在底部大输入框。
        全部已添加型号的浏览/搜索走卡片上的「查询」弹窗，确认后直接落库。
      */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={`添加型号${detail ? ` · ${detail.name}` : ''}`}
        onConfirm={confirmAddModel}
        confirmText="确认添加"
        confirmDisabled={!addForm.model.trim()}
        loading={savePriceListMutation.isPending}
        size="lg"
      >
        <FormSection title="新型号信息" icon={Tags}>
          <FieldGrid>
            <FormInput
              label="型号规格"
              value={addForm.model}
              onChange={(e) => setAddForm((f) => ({ ...f, model: e.target.value }))}
              placeholder="如 BJ125D-1450"
              required
            />
            <FormInput
              label="单位"
              value={addForm.unit}
              onChange={(e) => setAddForm((f) => ({ ...f, unit: e.target.value }))}
              placeholder={detail?.unit || '如 套'}
            />
            {(
              [
                ['costPrice', '成本价'],
                ['referencePrice', '参考价'],
                ['standardPrice', '标配价'],
                ['salePrice', '销售价'],
              ] as const
            ).map(([key, label]) => (
              <FormInput
                key={key}
                label={label}
                type="number"
                value={addForm[key] ?? ''}
                onChange={(e) =>
                  setAddForm((f) => ({
                    ...f,
                    [key]: e.target.value === '' ? undefined : Number(e.target.value),
                  }))
                }
              />
            ))}
            <div className="md:col-span-2">
              <FormTextarea
                label="备注"
                value={addForm.remark}
                onChange={(e) => setAddForm((f) => ({ ...f, remark: e.target.value }))}
                rows={4}
                placeholder="定价依据、配置差异、交期等补充说明"
              />
            </div>
          </FieldGrid>
        </FormSection>
      </Modal>

      {/* 查询弹窗：列表展示所有已添加型号的报价信息，支持弹窗内搜索 */}
      <Modal
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        title={`型号报价信息${detail ? ` · ${detail.name}` : ''}`}
        onConfirm={() => setViewOpen(false)}
        confirmText="关闭"
        size="xl"
      >
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-muted">
              {viewSearch ? `匹配 ${filteredViewRows.length} / ${priceRows.length} 个型号` : `共 ${priceRows.length} 个型号`}
            </span>
            <div className="ml-auto relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                className="eo-input !w-56 !pl-7 !py-1 !text-xs"
                placeholder="搜索型号 / 关键参数 / 备注"
                value={viewSearch}
                onChange={(e) => setViewSearch(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          {filteredViewRows.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">
              {priceRows.length === 0 ? '尚未添加型号，点「添加型号」录入' : '没有匹配的型号'}
            </p>
          ) : (
            <div className="border border-border rounded-lg overflow-auto max-h-[60vh] eo-scroll">
              <table className="w-full text-xs">
                <thead className="bg-canvas/60 text-muted sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium whitespace-nowrap">型号规格</th>
                    <th className="text-left px-2 py-1.5 font-medium whitespace-nowrap">关键参数</th>
                    <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">成本价</th>
                    <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">参考价</th>
                    <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">标配价</th>
                    <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">销售价</th>
                    <th className="text-right px-2 py-1.5 font-medium whitespace-nowrap">毛利率</th>
                    <th className="text-left px-2 py-1.5 font-medium whitespace-nowrap">单位</th>
                    <th className="text-left px-2 py-1.5 font-medium whitespace-nowrap">备注</th>
                    <th className="text-left px-2 py-1.5 font-medium whitespace-nowrap">最近修改</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredViewRows.map((row, idx) => {
                    const margin =
                      row.salePrice && row.costPrice && row.salePrice > row.costPrice
                        ? (((row.salePrice - row.costPrice) / row.salePrice) * 100).toFixed(1)
                        : null
                    return (
                      <tr key={idx} className="border-t border-border hover:bg-canvas/40 transition-colors">
                        <td className="px-2 py-1.5 whitespace-nowrap font-medium text-ink">{row.model}</td>
                        <td className="px-2 py-1.5 max-w-[160px] truncate" title={row.spec}>{row.spec || '—'}</td>
                        {(['costPrice', 'referencePrice', 'standardPrice', 'salePrice'] as const).map((f) => (
                          <td key={f} className="px-2 py-1.5 text-right whitespace-nowrap eo-num">
                            {row[f] != null ? `¥${Number(row[f]).toLocaleString('zh-CN')}` : '—'}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-right whitespace-nowrap eo-num">
                          {margin ? (
                            <span className={Number(margin) >= 20 ? 'text-success-fg' : 'text-warning-fg'}>{margin}%</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{row.unit || '—'}</td>
                        <td className="px-2 py-1.5 max-w-[160px] truncate" title={row.remark}>{row.remark || '—'}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-muted">{row.updatedAt ? row.updatedAt.slice(0, 10) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      <FilePreview
        isOpen={!!previewAtt}
        onClose={() => setPreviewAtt(null)}
        fileKind={previewAtt?.kind || 'products'}
        fileId={previewAtt?.id}
        fileName={previewAtt?.fileName || ''}
        mimeType={previewAtt?.mimeType}
        fileSize={previewAtt?.fileSize}
      />
    </div>
  )
}

