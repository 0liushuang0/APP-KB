/**
 * Documents 页面的独立弹窗子组件。
 * 从 Documents.tsx 提取 LinkModal + MoveCategoryPicker，主文件减负 ~200 行。
 */
import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CheckCircle2, Search } from 'lucide-react'
import {
  customerApi, requirementApi, proposalApi, quotationApi, projectApi, solutionApi,
} from '../api/services'
import Modal from '../components/Modal'
import FormSelect from '../components/FormSelect'

const handleError = (error: any) => {
  toast.error(error?.response?.data?.message || error?.message || '操作失败')
}

export type LinkEntityType = 'customer' | 'requirement' | 'proposal' | 'quotation' | 'project' | 'solution'

const LINK_ENTITY_OPTIONS = [
  { value: 'requirement', label: '需求' },
  { value: 'customer', label: '客户' },
  { value: 'proposal', label: '方案' },
  { value: 'quotation', label: '报价' },
  { value: 'project', label: '项目' },
  { value: 'solution', label: '标准方案' },
]

interface Document {
  id: string
  title: string
  [key: string]: any
}

/**
 * 关联弹窗：把当前资料关联到某个业务对象（客户/需求/方案/报价/项目）。
 */
export function LinkModal({
  doc,
  onClose,
  onDone,
}: {
  doc: Document | null
  onClose: () => void
  onDone: () => void
}) {
  const [entityType, setEntityType] = useState<LinkEntityType>('requirement')
  const [entityId, setEntityId] = useState('')
  const [linkRole, setLinkRole] = useState('source')

  const optionsQuery = useQuery({
    queryKey: ['link-options', entityType],
    queryFn: async () => {
      const pick = (r: any) => (Array.isArray(r) ? r : r?.list || [])
      switch (entityType) {
        case 'customer':
          return pick(await customerApi.list()).map((x: any) => ({ value: x.id, label: x.name }))
        case 'requirement':
          return pick(await requirementApi.list()).map((x: any) => ({ value: x.id, label: `${x.requirementNo} ${x.title}` }))
        case 'proposal':
          return pick(await proposalApi.list()).map((x: any) => ({ value: x.id, label: `${x.proposalNo} ${x.title}` }))
        case 'quotation':
          return pick(await quotationApi.list()).map((x: any) => ({ value: x.id, label: x.quotationNo }))
        case 'project':
          return pick(await projectApi.list()).map((x: any) => ({ value: x.id, label: `${x.projectNo} ${x.name}` }))
        case 'solution':
          return pick(await solutionApi.list()).map((x: any) => ({ value: x.id, label: x.name }))
        default:
          return []
      }
    },
    enabled: !!doc,
  })

  const mutation = useMutation({
    mutationFn: () => documentApi.createLink(doc!.id, { entityType, entityId, linkRole }),
    onSuccess: () => {
      toast.success('已建立关联')
      setEntityId('')
      onDone()
    },
    onError: handleError,
  })

  return (
    <Modal
      open={!!doc}
      onClose={onClose}
      title={`关联「${doc?.title || ''}」`}
      onConfirm={() => mutation.mutate()}
      loading={mutation.isPending}
      confirmDisabled={!entityId}
      confirmText="建立关联"
    >
      <div className="space-y-4">
        <p className="text-body-sm text-muted">
          关联后，这份资料会出现在对应客户 / 需求 / 方案 / 报价的资料列表里，实现全链路回查。
        </p>
        <FormSelect
          label="关联对象类型"
          options={LINK_ENTITY_OPTIONS}
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value as LinkEntityType)
            setEntityId('')
          }}
        />
        <FormSelect
          label="选择对象"
          options={[{ value: '', label: optionsQuery.isLoading ? '加载中…' : '请选择' }, ...(optionsQuery.data || [])]}
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
        />
        <FormSelect
          label="扮演角色"
          options={[
            { value: 'source', label: '原始资料（客户提供）' },
            { value: 'deliverable', label: '交付物（我方产出）' },
            { value: 'reference', label: '参考资料' },
          ]}
          value={linkRole}
          onChange={(e) => setLinkRole(e.target.value)}
        />
      </div>
    </Modal>
  )
}

// documentApi 需要在文件顶层引入（LinkModal 内部使用）
import { documentApi } from '../api/services'

/**
 * 可搜索的分类选择器（树形下拉，支持中文模糊搜索）。
 */
export function MoveCategoryPicker({
  search,
  onSearchChange,
  selected,
  onSelect,
  groups,
  subMap,
  grandSubMap,
  displayLabel,
}: {
  search: string
  onSearchChange: (v: string) => void
  selected: string
  onSelect: (v: string) => void
  groups: { value: string; label: string }[]
  subMap: Record<string, { value: string; label: string }[]>
  grandSubMap: Record<string, { value: string; label: string }[]>
  displayLabel: (value: string, fallback?: string) => string
}) {
  const [open, setOpen] = useState(false)

  const flatList = useMemo(() => {
    const list: { value: string; label: string; indent: number; path: string }[] = []
    for (const g of groups) {
      const gLabel = displayLabel(g.value, g.label)
      list.push({ value: g.value, label: gLabel, indent: 0, path: gLabel })
      const subs = subMap[g.value] || []
      for (const s of subs) {
        const sLabel = displayLabel(s.value, s.label)
        list.push({ value: s.value, label: sLabel, indent: 1, path: `${gLabel} / ${sLabel}` })
        const grands = grandSubMap[s.value] || []
        for (const gs of grands) {
          const gsLabel = displayLabel(gs.value, gs.label)
          list.push({ value: gs.value, label: gsLabel, indent: 2, path: `${gLabel} / ${sLabel} / ${gsLabel}` })
        }
      }
    }
    return list
  }, [groups, subMap, grandSubMap, displayLabel])

  const filtered = search
    ? flatList.filter(item =>
        item.label.toLowerCase().includes(search.toLowerCase()) ||
        item.path.toLowerCase().includes(search.toLowerCase())
      )
    : flatList

  const selectedItem = flatList.find(i => i.value === selected)

  return (
    <div className="space-y-2">
      {selectedItem && (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent-50 border border-accent-200 rounded-md">
          <CheckCircle2 size={14} className="text-accent-600 shrink-0" />
          <span className="text-sm text-accent-700 truncate">{selectedItem.path}</span>
          <button onClick={() => onSelect('')} className="text-muted hover:text-danger-fg ml-auto shrink-0 text-xs">
            清除
          </button>
        </div>
      )}

      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(e) => { onSearchChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="搜索分类名称…"
          className="eo-input w-full !pl-8 !py-1.5 !text-sm"
        />
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="relative z-50 max-h-64 overflow-y-auto bg-surface border border-border rounded-lg shadow-pop">
            {filtered.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted">未找到匹配分类</div>
            ) : (
              filtered.map(item => (
                <button
                  key={item.value}
                  onClick={() => { onSelect(item.value); setOpen(false); onSearchChange('') }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent-50 transition-colors flex items-center gap-1 ${
                    selected === item.value ? 'bg-accent-50 text-accent-700 font-medium' : 'text-ink-soft'
                  }`}
                  style={{ paddingLeft: `${12 + item.indent * 16}px` }}
                >
                  {item.indent > 0 && <span className="text-border">├</span>}
                  <span className="truncate">{item.label}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
