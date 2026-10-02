import { useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, ChevronUp, FolderTree, Folder, Plus, FolderInput, Pencil } from 'lucide-react'
import type { Solution } from '../types'
import { applyOrder, type OrderMap } from '../utils/treeOrder'

interface TreeNode {
  name: string
  path: string
  children: Map<string, TreeNode>
  count: number
}

const UNCATEGORIZED = '未分类'

/**
 * 把方案的 directory（斜杠路径，如 普碳钢/酸洗线）还原成层级树。
 * 目录不落独立表，靠路径字符串表达层级；顺序为本机偏好（见 treeOrder）。
 */
function buildTree(solutions: Solution[]): TreeNode {
  const root: TreeNode = { name: '全部方案', path: '', children: new Map(), count: solutions.length }
  for (const s of solutions) {
    const segments = (s.directory || UNCATEGORIZED)
      .split('/')
      .map((x) => x.trim())
      .filter(Boolean)
    let node = root
    let path = ''
    for (const seg of segments) {
      path = path ? `${path}/${seg}` : seg
      if (!node.children.has(seg)) {
        node.children.set(seg, { name: seg, path, children: new Map(), count: 0 })
      }
      node = node.children.get(seg)!
      node.count += 1
    }
  }
  return root
}

/** 树管理动作（只读时不传） */
export interface DirTreeActions {
  order: OrderMap
  onReorder: (parentPath: string, siblings: string[], key: string, dir: -1 | 1) => void
  onAddChild: (path: string) => void
  onMoveNode: (path: string) => void
  onRenameNode: (path: string) => void
}

function TreeItem({
  node,
  depth,
  parentPath,
  siblings,
  selected,
  onSelect,
  actions,
}: {
  node: TreeNode
  depth: number
  parentPath: string
  siblings: string[]
  selected: string
  onSelect: (path: string) => void
  actions?: DirTreeActions
}) {
  // 默认全展开：目录树是这一页的导航，收着的话每次进来都要一层层点开才知道有什么
  const [open, setOpen] = useState(true)
  const isRoot = depth === 0
  const hasChildren = node.children.size > 0
  const active = selected === node.path

  const childNames = [...node.children.keys()]
  const orderedChildNames = actions ? applyOrder(actions.order, node.path, childNames) : childNames
  const idx = siblings.indexOf(node.name)

  return (
    <div className="group/dir">
      <div
        className={`flex items-center gap-1 rounded-md text-body-sm transition-colors ${
          active ? 'bg-accent-50 text-accent-700 font-medium' : 'text-ink-soft hover:bg-canvas'
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px`, paddingRight: 4 }}
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
        <button
          type="button"
          onClick={() => onSelect(node.path)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left py-1.5"
        >
          {isRoot ? (
            <FolderTree size={14} className="flex-shrink-0 text-muted" />
          ) : (
            <Folder size={13} className="flex-shrink-0 text-muted" />
          )}
          <span className="truncate flex-1">{node.name}</span>
          <span className="font-mono text-caption text-muted flex-shrink-0">{node.count}</span>
        </button>

        {/* 悬停动作 */}
        {actions && (
          <span className="hidden group-hover/dir:flex items-center gap-0.5 flex-shrink-0">
            {!isRoot && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); actions.onReorder(parentPath, siblings, node.name, -1) }}
                  disabled={idx <= 0}
                  className="p-0.5 rounded text-muted hover:text-ink disabled:opacity-30"
                  title="上移"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); actions.onReorder(parentPath, siblings, node.name, 1) }}
                  disabled={idx >= siblings.length - 1}
                  className="p-0.5 rounded text-muted hover:text-ink disabled:opacity-30"
                  title="下移"
                >
                  <ChevronDown size={12} />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); actions.onMoveNode(node.path) }}
                  className="p-0.5 rounded text-muted hover:text-ink"
                  title="移动到其他目录"
                >
                  <FolderInput size={12} />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); actions.onRenameNode(node.path) }}
                  className="p-0.5 rounded text-muted hover:text-ink"
                  title="重命名"
                >
                  <Pencil size={12} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); actions.onAddChild(node.path) }}
              className="p-0.5 rounded text-accent-600 hover:text-accent-700"
              title={isRoot ? '在此新建方案' : `在「${node.name}」下新建方案`}
            >
              <Plus size={13} />
            </button>
          </span>
        )}
      </div>

      {open &&
        orderedChildNames.map((name) => (
          <TreeItem
            key={node.children.get(name)!.path}
            node={node.children.get(name)!}
            depth={depth + 1}
            parentPath={node.path}
            siblings={orderedChildNames}
            selected={selected}
            onSelect={onSelect}
            actions={actions}
          />
        ))}
    </div>
  )
}

interface Props {
  solutions: Solution[]
  selected: string
  onSelect: (path: string) => void
  actions?: DirTreeActions
}

/** 标准方案目录树（左侧导航）。传 actions 时可在节点上新建/排序/移动/重命名。 */
export default function SolutionDirectoryTree({ solutions, selected, onSelect, actions }: Props) {
  const tree = useMemo(() => buildTree(solutions), [solutions])
  return (
    <TreeItem
      node={tree}
      depth={0}
      parentPath=""
      siblings={[]}
      selected={selected}
      onSelect={onSelect}
      actions={actions}
    />
  )
}

/** 某个方案是否属于选中目录（含后代）。selected 为空表示全部。 */
export function inDirectory(solution: Solution, selected: string): boolean {
  if (!selected) return true
  const dir = solution.directory || UNCATEGORIZED
  return dir === selected || dir.startsWith(`${selected}/`)
}
