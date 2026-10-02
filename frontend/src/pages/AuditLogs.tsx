import { useState } from 'react'
import { Search, Eye, History } from 'lucide-react'
import { auditLogApi } from '../api/services'
import { useDebounce } from '../hooks/useDebounce'
import { usePagedQuery } from '../hooks/usePagedQuery'
import type { AuditLog } from '../types'
import Drawer from '../components/Drawer'
import DataTable from '../components/DataTable'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'

export default function AuditLogs() {
  const [action, setAction] = useState('')
  const [objectType, setObjectType] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const debouncedAction = useDebounce(action, 300)
  const debouncedObjectType = useDebounce(objectType, 300)
  const [selected, setSelected] = useState<AuditLog | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 之前用裸 useQuery 且 page/pageSize 既没进 queryKey 也没传给 API，
  // 导致切页只改本地状态、数据永远停在第一页（假分页）。改用 usePagedQuery
  // 把分页参数真正下发到服务端。
  const filters = {
    action: debouncedAction || undefined,
    objectType: debouncedObjectType || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  }
  const {
    list: listData,
    isLoading,
    isError,
    error,
    refetch,
    pagination,
  } = usePagedQuery<AuditLog>({
    key: ['audit-logs'],
    fetcher: (params) => auditLogApi.list(params),
    filters,
    initialPageSize: 15,
  })

  const openDetail = (row: AuditLog) => {
    setSelected(row)
    setDrawerOpen(true)
  }

  const isJson = (text?: string) => {
    if (!text) return false
    try {
      JSON.parse(text)
      return true
    } catch {
      return false
    }
  }

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <h1 className="font-serif text-[28px] font-medium text-ink tracking-tight">操作日志</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              placeholder="操作动作"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="pl-9 pr-3 py-2 border border-border rounded-md text-sm w-40"
            />
          </div>
          <input
            placeholder="对象类型"
            value={objectType}
            onChange={(e) => setObjectType(e.target.value)}
            className="px-3 py-2 border border-border rounded-md text-sm w-40"
          />
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 border border-border rounded-md text-sm"
          />
          <span className="text-muted text-sm">至</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 border border-border rounded-md text-sm"
          />
        </div>
      </div>

      {isLoading && listData.length === 0 && <PageLoader />}
      {isError && <ErrorState message={error?.message || '加载失败'} onRetry={refetch} />}
      {!isLoading && !isError && (
        <DataTable
          loading={isLoading}
          data={listData}
          columns={[
            { key: 'createdAt', title: '时间', render: (row) => (row.createdAt ? new Date(row.createdAt).toLocaleString() : '-') },
            { key: 'action', title: '动作' },
            { key: 'objectType', title: '对象类型' },
            { key: 'objectId', title: '对象 ID', render: (row) => row.objectId || '-' },
            { key: 'userId', title: '用户 ID', render: (row) => row.userId || '-' },
            { key: 'ip', title: 'IP', render: (row) => row.ip || '-' },
            { key: 'detail', title: '详情', render: (row) => (row.detail ? (row.detail.length > 30 ? `${row.detail.slice(0, 30)}...` : row.detail) : '-') },
          ]}
          rowKey={(row) => row.id}
          onRowDoubleClick={(row) => openDetail(row)}
          pagination={pagination}
          actions={(row) => (
            <div className="flex items-center gap-2">
              <button onClick={() => openDetail(row)} className="text-accent-600 hover:text-accent-700" title={"查看"}
              aria-label="查看">
                <Eye size={16} />
              </button>
            </div>
          )}
        />
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="日志详情" width="w-[520px]">
        {selected ? (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-accent-50 rounded-lg">
                <History size={24} className="text-accent-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-ink">{selected.action}</h3>
                <p className="text-sm text-muted">{selected.objectType}</p>
              </div>
            </div>

            <div className="bg-subtle rounded-md p-4 text-sm space-y-2">
              <div className="flex justify-between"><span className="text-muted">时间</span><span>{selected.createdAt ? new Date(selected.createdAt).toLocaleString() : '-'}</span></div>
              <div className="flex justify-between"><span className="text-muted">动作</span><span>{selected.action}</span></div>
              <div className="flex justify-between"><span className="text-muted">对象类型</span><span>{selected.objectType}</span></div>
              <div className="flex justify-between"><span className="text-muted">对象 ID</span><span>{selected.objectId || '-'}</span></div>
              <div className="flex justify-between"><span className="text-muted">用户 ID</span><span>{selected.userId || '-'}</span></div>
              <div className="flex justify-between"><span className="text-muted">IP</span><span>{selected.ip || '-'}</span></div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-ink mb-2">详情</h4>
              {selected.detail ? (
                isJson(selected.detail) ? (
                  <pre className="text-xs bg-subtle p-3 rounded-md overflow-auto">{JSON.stringify(JSON.parse(selected.detail), null, 2)}</pre>
                ) : (
                  <p className="text-sm text-ink-soft bg-subtle p-3 rounded-md whitespace-pre-wrap break-all">{selected.detail}</p>
                )
              ) : (
                <p className="text-sm text-muted">无</p>
              )}
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  )
}
