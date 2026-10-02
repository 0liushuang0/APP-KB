import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Shield } from 'lucide-react'
import { roleApi } from '../../api/services'
import DataTable from '../../components/DataTable'
import PageLoader from '../../components/PageLoader'
import ErrorState from '../../components/ErrorState'
import EmptyState from '../../components/EmptyState'

export default function RoleManagement() {
  const [search, setSearch] = useState('')
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['roles-admin'],
    queryFn: () => roleApi.list(),
  })

  const filtered = (data || []).filter((r: any) => r.name?.includes(search) || r.code?.includes(search))

  if (isLoading) return <PageLoader />
  if (error) return <ErrorState onRetry={refetch} />

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <h2 className="font-serif text-heading-lg font-medium text-ink">角色管理</h2>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            placeholder="搜索角色名称/编码"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-3 py-2 border border-border rounded-md text-sm w-64"
          />
        </div>
      </div>

      {filtered.length === 0 ? <EmptyState /> : (
        <DataTable
          data={filtered}
          columns={[
            { key: 'name', title: '名称' },
            { key: 'code', title: '编码' },
            { key: 'description', title: '描述' },
            { key: 'permissions', title: '权限', render: (row: any) => (row.permissions || []).join(', ') },
            { key: 'isSystem', title: '系统角色', render: (row: any) => row.isSystem ? '是' : '否' },
          ]}
        />
      )}

      <div className="mt-6 bg-info-bg border border-info-line rounded-lg p-4 text-sm text-info-fg">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={16} />
          <span className="font-medium">说明</span>
        </div>
        <p>系统预置角色不可编辑。如需自定义角色，请联系管理员在数据库中维护。</p>
      </div>
    </div>
  )
}

