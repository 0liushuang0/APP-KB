import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Stamp,
  CheckCircle2,
  XCircle,
  ArrowUpRight,
  Users,
  FileText,
  DollarSign,
  Package,
  Truck,
  FolderKanban,
  Files,
  ClipboardList,
  Eye,
  ScrollText,
} from 'lucide-react'
import { approvalApi } from '../api/services'
import apiClient from '../api/client'
import { openPreview } from '../api/files'
import PageHeader from '../components/PageHeader'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import EmptyState from '../components/EmptyState'
import Modal from '../components/Modal'
import FormTextarea from '../components/FormTextarea'
import Button from '../components/Button'

/** 审批对象类型 → 展示元数据与跳转路径 */
const OBJECT_META: Record<string, { label: string; icon: typeof Users; path: (id: string, category?: string | null) => string }> = {
  customer: { label: '客户', icon: Users, path: (id) => `/customers/${id}` },
  requirement: { label: '需求', icon: ClipboardList, path: (id) => `/requirements/${id}` },
  proposal: { label: '方案', icon: FileText, path: () => '/proposals' },
  quotation: { label: '报价', icon: DollarSign, path: () => '/quotations' },
  contract: { label: '合同', icon: ScrollText, path: () => '/contracts' },
  product: { label: '产品', icon: Package, path: () => '/products' },
  supplier: { label: '供应商', icon: Truck, path: () => '/suppliers' },
  project: { label: '项目', icon: FolderKanban, path: () => '/projects' },
  document: {
    label: '资料',
    icon: Files,
    path: (id, category) => (String(category || '').startsWith('knowledge') ? '/knowledge' : `/documents?highlight=${id}`),
  },
}

const TABS = [
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已驳回' },
]

const CATEGORY_LABEL: Record<string, string> = { 'knowledge/workflow_import': '平台导入' }

interface Row {
  id: string
  objectType: string
  objectId: string
  status: string
  objectTitle?: string | null
  objectCategory?: string | null
  submittedBy?: string
  submittedByName?: string
  reviewedBy?: string
  reviewedByName?: string
  comment?: string
  createdAt?: string
}

/**
 * 审批中心。
 *
 * 原先这页没有挂到导航上（知识库提示「请在审批中心审核」却无处可去），平台导入的资料积压到 690 份。
 * 现在：显示审的是什么（标题）、按类型筛选、资料可直接预览、可多选批量通过；资料通过后系统自动建 AI 索引。
 */
export default function Approvals() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('pending')
  const [type, setType] = useState<string>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState<{ id: string; action: 'approve' | 'reject' } | 'batch' | null>(null)
  const [comment, setComment] = useState('')

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['approvals', tab],
    queryFn: () => approvalApi.list({ status: tab }),
  })
  const all: Row[] = Array.isArray(data) ? data : (data as any)?.list || []
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of all) m.set(r.objectType, (m.get(r.objectType) || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [all])
  const rows = type ? all.filter((r) => r.objectType === type) : all
  const pendingVisible = rows.filter((r) => r.status === 'pending')
  const allChecked = pendingVisible.length > 0 && pendingVisible.every((r) => selected.has(r.id))

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['approvals'] })
    queryClient.invalidateQueries({ queryKey: ['approvals-pending-count'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    queryClient.invalidateQueries({ queryKey: ['ops-health'] })
  }

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (target === 'batch') {
        const r = await apiClient.post('/approvals/batch-approve', { ids: [...selected], comment }).then((x) => x.data)
        return (r as any)?.data ?? r
      }
      const t = target as { id: string; action: 'approve' | 'reject' }
      return t.action === 'approve' ? approvalApi.approve(t.id, comment) : approvalApi.reject(t.id, comment)
    },
    onSuccess: (res: any) => {
      refresh()
      if (target === 'batch') {
        toast.success(`已通过 ${res?.approved ?? selected.size} 条${res?.skipped ? `，${res.skipped} 条已被处理过` : ''}`)
        setSelected(new Set())
      } else {
        toast.success((target as any)?.action === 'approve' ? '已通过' : '已驳回')
      }
      setTarget(null)
      setComment('')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || '操作失败'),
  })

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div>
      <PageHeader title="审批" titleEm="中心" />

      {/* 状态页签 */}
      <div className="flex items-center gap-1 mb-4 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => {
              setTab(t.value)
              setSelected(new Set())
            }}
            className={`px-4 py-2 text-body-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.value ? 'border-accent-500 text-accent-600' : 'border-transparent text-muted hover:text-ink-soft'
            }`}
          >
            {t.label}
            {tab === t.value && all.length > 0 && <span className="ml-1.5 font-mono text-caption text-muted">{all.length}</span>}
          </button>
        ))}
      </div>

      {/* 类型筛选 + 批量操作 */}
      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            onClick={() => setType('')}
            className={`px-3 py-1 rounded-full text-label border ${!type ? 'border-accent-500 text-accent-600 bg-accent-50' : 'border-border text-muted'}`}
          >
            全部 {all.length}
          </button>
          {counts.map(([t, n]) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`px-3 py-1 rounded-full text-label border ${type === t ? 'border-accent-500 text-accent-600 bg-accent-50' : 'border-border text-muted'}`}
            >
              {OBJECT_META[t]?.label || t} {n}
            </button>
          ))}
          {tab === 'pending' && pendingVisible.length > 0 && (
            <div className="ml-auto flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-label text-muted cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-accent-500"
                  checked={allChecked}
                  onChange={() =>
                    setSelected(allChecked ? new Set() : new Set(pendingVisible.map((r) => r.id)))
                  }
                />
                全选本页 {pendingVisible.length} 条
              </label>
              <Button
                className="py-1.5 px-3 text-label"
                disabled={!selected.size}
                onClick={() => {
                  setTarget('batch')
                  setComment('')
                }}
              >
                <CheckCircle2 size={14} className="mr-1" /> 批量通过{selected.size ? `（${selected.size}）` : ''}
              </Button>
            </div>
          )}
        </div>
      )}

      {isLoading && <PageLoader />}
      {isError && <ErrorState message={(error as any)?.message || '加载失败'} onRetry={refetch} />}
      {!isLoading && !isError && rows.length === 0 && (
        <EmptyState
          icon={Stamp}
          title={tab === 'pending' ? '没有待审批的事项' : '暂无记录'}
          description={tab === 'pending' ? '所有提交都已处理完毕' : '该状态下还没有审批记录'}
        />
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="grid gap-2">
          {rows.map((row) => {
            const meta = OBJECT_META[row.objectType] || { label: row.objectType, icon: Stamp, path: () => '/' }
            const Icon = meta.icon
            const isDoc = row.objectType === 'document'
            return (
              <div key={row.id} className="eo-card p-3 flex items-start gap-3">
                {row.status === 'pending' && (
                  <input
                    type="checkbox"
                    className="accent-accent-500 mt-2.5"
                    aria-label={`选择 ${row.objectTitle || row.objectId}`}
                    checked={selected.has(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                )}
                <div className="w-9 h-9 rounded-lg bg-accent-50 text-accent-600 flex items-center justify-center flex-shrink-0">
                  <Icon size={17} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-caption text-muted">{meta.label}</span>
                    {row.objectCategory && CATEGORY_LABEL[row.objectCategory] && (
                      <span className="text-caption rounded bg-info-bg text-info-fg px-1.5">{CATEGORY_LABEL[row.objectCategory]}</span>
                    )}
                    <span className="text-body-sm font-semibold text-ink truncate" title={row.objectTitle || ''}>
                      {row.objectTitle || <span className="font-mono text-muted">{row.objectId?.slice(0, 8)}（对象已删除或无标题）</span>}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted">
                    <span>提交人：{row.submittedByName || row.submittedBy?.slice(0, 8) || '-'}</span>
                    <span className="font-mono">{row.createdAt ? new Date(row.createdAt).toLocaleString('zh-CN') : '-'}</span>
                    {row.reviewedBy && <span>审批人：{row.reviewedByName || row.reviewedBy.slice(0, 8)}</span>}
                  </div>
                  {row.comment && (
                    <p className="mt-2 text-body-sm text-ink-soft bg-subtle rounded-md px-3 py-1.5">{row.comment}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isDoc && (
                    <button
                      onClick={() => openPreview('documents', row.objectId).catch((e) => toast.error(e?.message || '预览失败'))}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-label text-muted hover:text-accent-600 hover:bg-accent-50 rounded-md transition-colors"
                    >
                      <Eye size={13} /> 预览
                    </button>
                  )}
                  <button
                    onClick={() => navigate(meta.path(row.objectId, row.objectCategory))}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-label text-muted hover:text-accent-600 hover:bg-accent-50 rounded-md transition-colors"
                  >
                    查看 <ArrowUpRight size={13} />
                  </button>
                  {row.status === 'pending' && (
                    <>
                      <Button
                        variant="secondary"
                        className="py-1.5 px-3 text-label"
                        onClick={() => {
                          setTarget({ id: row.id, action: 'reject' })
                          setComment('')
                        }}
                      >
                        <XCircle size={14} className="mr-1" /> 驳回
                      </Button>
                      <Button
                        className="py-1.5 px-3 text-label"
                        onClick={() => {
                          setTarget({ id: row.id, action: 'approve' })
                          setComment('')
                        }}
                      >
                        <CheckCircle2 size={14} className="mr-1" /> 通过
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title={target === 'batch' ? `批量通过 ${selected.size} 条` : target?.action === 'approve' ? '通过审批' : '驳回审批'}
        onConfirm={() => actionMutation.mutate()}
        loading={actionMutation.isPending}
        confirmText={target === 'batch' || (target as any)?.action === 'approve' ? '通过' : '驳回'}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">
            {target === 'batch'
              ? `确认通过选中的 ${selected.size} 条？资料通过后系统会自动建立 AI 索引，可被问答检索。`
              : (target as any)?.action === 'approve'
                ? '确认通过该审批？'
                : '确认驳回该审批？驳回后提交人需重新提交。'}
          </p>
          <FormTextarea
            label={target !== 'batch' && (target as any)?.action === 'reject' ? '驳回原因（建议填写）' : '审批意见（可选）'}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
          />
        </div>
      </Modal>
    </div>
  )
}
