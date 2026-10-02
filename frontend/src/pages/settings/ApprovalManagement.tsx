import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, CheckCircle, XCircle } from 'lucide-react'
import { approvalApi } from '../../api/services'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import FormTextarea from '../../components/FormTextarea'
import PageLoader from '../../components/PageLoader'
import ErrorState from '../../components/ErrorState'
import EmptyState from '../../components/EmptyState'
import { toast } from 'sonner'

export default function ApprovalManagement() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('pending')
  const [commentId, setCommentId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [action, setAction] = useState<'approve' | 'reject'>('approve')

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['approvals-admin', filter],
    queryFn: () => approvalApi.list({ status: filter }),
  })

  const actionMutation = useMutation({
    mutationFn: () => action === 'approve'
      ? approvalApi.approve(commentId!, comment)
      : approvalApi.reject(commentId!, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals-admin'] })
      toast.success(action === 'approve' ? '审批已通过' : '审批已驳回')
      setCommentId(null)
      setComment('')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || '操作失败'),
  })

  const typeMap: Record<string, string> = {
    customer: '客户',
    proposal: '方案',
    quotation: '报价',
    product: '产品',
    supplier: '供应商',
    project: '项目',
    document: '文档',
  }

  const filtered = (data || []).filter((a: any) =>
    (typeMap[a.objectType] || a.objectType)?.includes(search) ||
    a.objectId?.includes(search)
  )

  if (isLoading) return <PageLoader />
  if (error) return <ErrorState onRetry={refetch} />

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <h2 className="font-serif text-heading-lg font-medium text-ink">审批管理</h2>
        <div className="flex items-center gap-3">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="px-3 py-2 border border-border rounded-md text-sm">
            <option value="pending">待审核</option>
            <option value="approved">已通过</option>
            <option value="rejected">已驳回</option>
          </select>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              placeholder="搜索类型/对象ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-3 py-2 border border-border rounded-md text-sm w-64"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? <EmptyState /> : (
        <DataTable
          data={filtered}
          columns={[
            { key: 'objectType', title: '类型', render: (row: any) => typeMap[row.objectType] || row.objectType },
            { key: 'objectId', title: '对象ID', render: (row: any) => row.objectId?.slice(0, 8) + '...' },
            { key: 'status', title: '状态', render: (row: any) =>
              row.status === 'approved' ? <span className="text-success-fg">已通过</span> :
              row.status === 'rejected' ? <span className="text-danger-fg">已驳回</span> :
              <span className="text-warning-fg">待审核</span>
            },
            { key: 'comment', title: '备注' },
            { key: 'createdAt', title: '提交时间', render: (row: any) => new Date(row.createdAt).toLocaleString() },
          ]}
          actions={(row: any) => row.status === 'pending' ? (
            <div className="flex items-center gap-2">
              <button onClick={() => { setCommentId(row.id); setAction('approve'); setComment('') }} className="text-success-fg hover:text-success-fg" title={"通过"}
              aria-label="通过"><CheckCircle size={16} /></button>
              <button onClick={() => { setCommentId(row.id); setAction('reject'); setComment('') }} className="text-danger-fg hover:text-danger-fg" title={"驳回"}
              aria-label="驳回"><XCircle size={16} /></button>
            </div>
          ) : null}
        />
      )}

      <Modal open={!!commentId} onClose={() => setCommentId(null)} title={action === 'approve' ? '通过审批' : '驳回审批'} onConfirm={() => actionMutation.mutate()} loading={actionMutation.isPending} confirmText={action === 'approve' ? '通过' : '驳回'}>
        <div className="space-y-4">
          <p className="text-sm text-ink-soft">{action === 'approve' ? '确认通过该审批？' : '确认驳回该审批？'}</p>
          <FormTextarea label="审批意见（可选）" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
        </div>
      </Modal>
    </div>
  )
}

