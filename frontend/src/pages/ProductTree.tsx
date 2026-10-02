import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, ChevronDown, Package, Layers, ArrowUpRight } from 'lucide-react'
import { productApi } from '../api/services'
import type { Product } from '../types'
import PageHeader from '../components/PageHeader'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import EmptyState from '../components/EmptyState'

interface TreeNode {
  name: string
  path: string
  children: Map<string, TreeNode>
  products: Product[]
}

/**
 * 产品分类树。
 *
 * 分类以 `板带精整装备/矫直设备` 这样的斜杠路径存在 product.category 上，
 * 这里按分隔符还原成层级树 —— 后端不需要额外的分类表。
 */
function buildTree(products: Product[]): TreeNode {
  const root: TreeNode = { name: '全部产品', path: '', children: new Map(), products: [] }

  for (const p of products) {
    const segments = (p.category || '未分类').split('/').map((s) => s.trim()).filter(Boolean)
    let node = root
    let path = ''
    for (const seg of segments) {
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

/** 含所有后代的产品总数 */
function countAll(node: TreeNode): number {
  let n = node.products.length
  for (const child of node.children.values()) n += countAll(child)
  return n
}

function TreeItem({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: TreeNode
  depth: number
  selected: string
  onSelect: (path: string) => void
}) {
  // 默认全展开，与产品管理页的分类树保持一致
  const [open, setOpen] = useState(true)
  const hasChildren = node.children.size > 0
  const total = countAll(node)
  const active = selected === node.path

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 rounded-md text-body-sm cursor-pointer transition-colors ${
          active ? 'bg-accent-50 text-accent-700 font-medium' : 'text-ink-soft hover:bg-canvas'
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px`, paddingRight: 8 }}
        onClick={() => onSelect(node.path)}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) setOpen((o) => !o)
          }}
          className={`w-4 h-4 flex items-center justify-center flex-shrink-0 ${
            hasChildren ? 'text-muted hover:text-ink' : 'opacity-0 pointer-events-none'
          }`}
          aria-label={open ? '收起' : '展开'}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {depth === 0 ? (
          <Layers size={14} className="flex-shrink-0 text-muted" />
        ) : (
          <Package size={13} className="flex-shrink-0 text-muted" />
        )}
        <span className="truncate py-1.5 flex-1">{node.name}</span>
        <span className="font-mono text-caption text-muted flex-shrink-0">{total}</span>
      </div>

      {open &&
        [...node.children.values()].map((child) => (
          <TreeItem key={child.path} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
        ))}
    </div>
  )
}

export default function ProductTree() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState('')

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['products', 'tree'],
    queryFn: () => productApi.list(),
  })

  const products: Product[] = Array.isArray(data) ? data : (data as any)?.list || []
  const tree = useMemo(() => buildTree(products), [products])

  // 选中节点及其所有后代的产品
  const visible = useMemo(() => {
    if (!selected) return products
    return products.filter((p) => (p.category || '未分类') === selected || (p.category || '').startsWith(`${selected}/`))
  }, [products, selected])

  if (isLoading) return <PageLoader />
  if (isError) return <ErrorState message={(error as any)?.message || '加载失败'} onRetry={refetch} />

  return (
    <div>
      <PageHeader
        title="产品"
        titleEm="分类"
      />

      <div className="flex flex-col lg:flex-row gap-4">
        {/* 分类树 */}
        <aside className="lg:w-[300px] flex-shrink-0">
          <div className="eo-card p-2 lg:sticky lg:top-4">
            <TreeItem node={tree} depth={0} selected={selected} onSelect={setSelected} />
          </div>
        </aside>

        {/* 产品列表 */}
        <div className="flex-1 min-w-0">
          <div className="eo-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-body-sm font-semibold text-ink truncate">
                  {selected || '全部产品'}
                </div>
                <div className="text-caption text-muted mt-0.5">{visible.length} 个产品</div>
              </div>
              <button
                onClick={() => navigate('/products')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-label text-muted
                  hover:text-accent-600 hover:bg-accent-50 rounded-md transition-colors flex-shrink-0"
              >
                在产品库中管理 <ArrowUpRight size={13} />
              </button>
            </div>

            {visible.length === 0 ? (
              <EmptyState bare title="该分类下暂无产品" description="换一个分类，或到产品库新建" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="border-b border-border bg-subtle">
                      <th className="eo-th text-left py-2.5 px-4">编码</th>
                      <th className="eo-th text-left py-2.5 px-4">产品名称</th>
                      <th className="eo-th text-left py-2.5 px-4">分类</th>
                      <th className="eo-th text-right py-2.5 px-4">参考价</th>
                      <th className="eo-th text-left py-2.5 px-4">单位</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p) => (
                      <tr
                        key={p.id}
                        onClick={() => navigate(`/products?highlight=${p.id}`)}
                        className="border-b border-divider last:border-0 hover:bg-canvas cursor-pointer"
                      >
                        <td className="py-2.5 px-4 font-mono text-label text-muted">{p.code || '-'}</td>
                        <td className="py-2.5 px-4 text-ink">{p.name}</td>
                        <td className="py-2.5 px-4 text-muted text-label">{p.category || '-'}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-ink-soft">
                          {p.price ? `¥${Number(p.price).toLocaleString('zh-CN')}` : '-'}
                        </td>
                        <td className="py-2.5 px-4 text-muted">{p.unit || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

