import { useState } from 'react'
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
} from 'lucide-react'
import { approvalApi } from '../api/services'
import PageHeader from '../components/PageHeader'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import EmptyState from '../components/EmptyState'
import Modal from '../components/Modal'
import FormTextarea from '../components/FormTextarea'
import Button from '../components/Button'

/** 审批对象类型 → 展示元数据与跳转路径 */
const OBJECT_META: Record<string, { label: string; icon: typeof Users; path: (id: string) => string }> = {
  customer: { label: '客户', icon: Users, path: (id) => `/customers/${id}` },
  requirement: { label: '需求', icon: ClipboardList, path: () => '/requirements' },
  proposal: { label: '方案', icon: FileText, path: () => '/proposals' },
  quotation: { label: '报价', icon: DollarSign, path: () => '/quotations' },
  product: { label: '产品', icon: Package, path: () => '/products' },
  supplier: { label: '供应商', icon: Truck, path: () => '/suppliers' },
  project: { label: '项目', icon: FolderKanban, path: () => '/projects' },
  document: { label: '资料', icon: Files, path: () => '/documents' },
}

const TABS = [
  { value: 'pending', label: '待审批' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已驳回' },
]

export default function Approvals() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('pending')
  const [target, setTarget] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null)
  const [comment, setComment] = useState('')

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['approvals', tab],
    queryFn: () => approvalApi.list({ status: tab }),
  })

  const rows: any[] = Array.isArray(data) ? data : (data as any)?.list || []

  const actionMutation = useMutation({
    mutationFn: () =>
      target!.action === 'approve'
        ? approvalApi.approve(target!.id, comment)
        : approvalApi.reject(target!.id, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
      toast.success(target!.action === 'approve' ? '已通过' : '已驳回')
      setTarget(null)
      setComment('')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || '操作失败'),
  })

  return (
    <div>
      <PageHeader title="审批" titleEm="中心" />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-4 py-2 text-body-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.value
                ? 'border-accent-500 text-accent-600'
                : 'border-transparent text-muted hover:text-ink-soft'
            }`}
          >
            {t.label}
            {tab === t.value && rows.length > 0 && (
              <span className="ml-1.5 font-mono text-caption text-muted">{rows.length}</span>
            )}
          </button>
        ))}
      </div>

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
        <div className="grid gap-3">
          {rows.map((row) => {
            const meta = OBJECT_META[row.objectType] || {
              label: row.objectType,
              icon: Stamp,
              path: () => '/',
            }
            const Icon = meta.icon
            return (
              <div key={row.id} className="eo-card p-4 flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg bg-accent-50 text-accent-600 flex items-center justify-center flex-shrink-0">
                  <Icon size={17} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-body-sm font-semibold text-ink">{meta.label}审批</span>
                    <span className="font-mono text-caption text-muted">
                      {row.objectId?.slice(0, 8)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted">
                    <span>提交人：{row.submittedByName || row.submittedBy?.slice(0, 8) || '-'}</span>
                    <span className="font-mono">
                      {row.createdAt ? new Date(row.createdAt).toLocaleString('zh-CN') : '-'}
                    </span>
                    {row.reviewedBy && <span>审批人：{row.reviewedByName || row.reviewedBy.slice(0, 8)}</span>}
                  </div>
                  {row.comment && (
                    <p className="mt-2 text-body-sm text-ink-soft bg-subtle rounded-md px-3 py-2">
                      {row.comment}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => navigate(meta.path(row.objectId))}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-label text-muted
                      hover:text-accent-600 hover:bg-accent-50 rounded-md transition-colors"
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
        title={target?.action === 'approve' ? '通过审批' : '驳回审批'}
        onConfirm={() => actionMutation.mutate()}
        loading={actionMutation.isPending}
        confirmText={target?.action === 'approve' ? '通过' : '驳回'}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">
            {target?.action === 'approve' ? '确认通过该审批？' : '确认驳回该审批？驳回后提交人需重新提交。'}
          </p>
          <FormTextarea
            label={target?.action === 'reject' ? '驳回原因（建议填写）' : '审批意见（可选）'}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
          />
        </div>
      </Modal>
    </div>
  )
}

