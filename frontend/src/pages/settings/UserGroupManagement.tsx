import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Plus, Pencil, Trash2, Users } from 'lucide-react'
import { userGroupApi, userApi } from '../../api/services'
import Button from '../../components/Button'
import Modal from '../../components/Modal'
import DataTable from '../../components/DataTable'
import FormInput from '../../components/FormInput'
import FormTextarea from '../../components/FormTextarea'
import PageLoader from '../../components/PageLoader'
import ErrorState from '../../components/ErrorState'
import EmptyState from '../../components/EmptyState'
import { toast } from 'sonner'

export default function UserGroupManagement() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editing, setEditing] = useState<any | null>(null)
  const [form, setForm] = useState({ name: '', code: '', description: '', userIds: [] as string[] })

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['user-groups-admin'],
    queryFn: () => userGroupApi.list(),
  })

  const { data: users } = useQuery({
    queryKey: ['users-admin'],
    queryFn: () => userApi.list(),
  })

  const saveMutation = useMutation({
    mutationFn: (dto: any) => editing ? userGroupApi.update(editing.id, dto) : userGroupApi.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-groups-admin'] })
      toast.success(editing ? '用户组已更新' : '用户组已创建')
      closeModal()
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || '操作失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => userGroupApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-groups-admin'] })
      toast.success('用户组已删除')
      setDeleteId(null)
    },
  })

  const filtered = (data || []).filter((g: any) => g.name?.includes(search) || g.code?.includes(search))

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    setForm({ name: '', code: '', description: '', userIds: [] })
  }

  const openEdit = (row: any) => {
    setEditing(row)
    setForm({
      name: row.name,
      code: row.code || '',
      description: row.description || '',
      userIds: row.users?.map((u: any) => u.id) || [],
    })
    setModalOpen(true)
  }

  if (isLoading) return <PageLoader />
  if (error) return <ErrorState onRetry={refetch} />

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <h2 className="font-serif text-heading-lg font-medium text-ink">用户组管理</h2>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              placeholder="搜索用户组"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-3 py-2 border border-border rounded-md text-sm w-64"
            />
          </div>
          <Button onClick={() => setModalOpen(true)}><Plus size={16} className="mr-1" /> 新建用户组</Button>
        </div>
      </div>

      {filtered.length === 0 ? <EmptyState /> : (
        <DataTable
          data={filtered}
          columns={[
            { key: 'name', title: '名称' },
            { key: 'code', title: '编码' },
            { key: 'description', title: '描述' },
            { key: 'users', title: '成员数', render: (row: any) => row.users?.length || 0 },
          ]}
          actions={(row: any) => (
            <div className="flex items-center gap-2">
              <button onClick={() => openEdit(row)} className="text-ink-soft hover:text-ink" title={"编辑"}
              aria-label="编辑"><Pencil size={16} /></button>
              <button onClick={() => setDeleteId(row.id)} className="text-danger-fg hover:text-danger-fg" title={"删除"}
              aria-label="删除"><Trash2 size={16} /></button>
            </div>
          )}
        />
      )}

      <Modal open={modalOpen} onClose={closeModal} title={editing ? '编辑用户组' : '新建用户组'} onConfirm={() => saveMutation.mutate(form)} loading={saveMutation.isPending} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormInput label="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <FormInput label="编码" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <FormTextarea label="描述" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div>
            <label className="block text-sm font-medium text-ink-soft mb-2">成员</label>
            <div className="max-h-48 overflow-y-auto border border-border rounded-md p-2 space-y-1">
              {(users || []).map((u: any) => (
                <label key={u.id} className="flex items-center gap-2 px-2 py-1 hover:bg-subtle rounded text-sm">
                  <input
                    type="checkbox"
                    checked={form.userIds.includes(u.id)}
                    onChange={(e) => {
                      const ids = e.target.checked
                        ? [...form.userIds, u.id]
                        : form.userIds.filter((id) => id !== u.id)
                      setForm({ ...form, userIds: ids })
                    }}
                  />
                  <Users size={14} className="text-muted" />
                  {u.nickname || u.username}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="确认删除" onConfirm={() => deleteId && deleteMutation.mutate(deleteId)} loading={deleteMutation.isPending} confirmText="删除" confirmVariant="danger">
        <p className="text-sm text-ink-soft">确定要删除该用户组吗？删除后无法恢复。</p>
      </Modal>
    </div>
  )
}

