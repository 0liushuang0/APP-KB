import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Plus, Pencil, Trash2 } from 'lucide-react'
import { departmentApi } from '../../api/services'
import Button from '../../components/Button'
import Modal from '../../components/Modal'
import DataTable from '../../components/DataTable'
import FormInput from '../../components/FormInput'
import FormSelect from '../../components/FormSelect'
import EmptyState from '../../components/EmptyState'
import PageLoader from '../../components/PageLoader'
import ErrorState from '../../components/ErrorState'
import { toast } from 'sonner'

function flattenDepartments(depts: any[], level = 0): any[] {
  return depts?.reduce((acc: any[], d: any) => {
    acc.push({ ...d, level })
    if (d.children?.length) {
      acc.push(...flattenDepartments(d.children, level + 1))
    }
    return acc
  }, []) || []
}

export default function DepartmentManagement() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editing, setEditing] = useState<any | null>(null)
  const [form, setForm] = useState({ name: '', code: '', description: '', parentId: '' })

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['departments-admin'],
    queryFn: () => departmentApi.list(),
  })

  const saveMutation = useMutation({
    mutationFn: (dto: any) => editing ? departmentApi.update(editing.id, dto) : departmentApi.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments-admin'] })
      toast.success(editing ? '部门已更新' : '部门已创建')
      closeModal()
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || '操作失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => departmentApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments-admin'] })
      toast.success('部门已删除')
      setDeleteId(null)
    },
  })

  const flat = flattenDepartments(data || [])
  const filtered = flat.filter((d: any) => d.name?.includes(search) || d.code?.includes(search))

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    setForm({ name: '', code: '', description: '', parentId: '' })
  }

  const openEdit = (row: any) => {
    setEditing(row)
    setForm({ name: row.name, code: row.code || '', description: row.description || '', parentId: row.parentId || '' })
    setModalOpen(true)
  }

  const parentOptions = [{ value: '', label: '无' }, ...flat
    .filter((d: any) => d.id !== editing?.id)
    .map((d: any) => ({ value: d.id, label: `${'- '.repeat(d.level)}${d.name}` }))]

  if (isLoading) return <PageLoader />
  if (error) return <ErrorState onRetry={refetch} />

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <h2 className="font-serif text-heading-lg font-medium text-ink">部门管理</h2>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              placeholder="搜索部门名称/编码"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-3 py-2 border border-border rounded-md text-sm w-64"
            />
          </div>
          <Button onClick={() => setModalOpen(true)}><Plus size={16} className="mr-1" /> 新建部门</Button>
        </div>
      </div>

      {filtered.length === 0 ? <EmptyState /> : (
        <DataTable
          data={filtered}
          columns={[
            { key: 'name', title: '名称', render: (row: any) => `${'- '.repeat(row.level)}${row.name}` },
            { key: 'code', title: '编码' },
            { key: 'description', title: '描述' },
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

      <Modal open={modalOpen} onClose={closeModal} title={editing ? '编辑部门' : '新建部门'} onConfirm={() => saveMutation.mutate(form)} loading={saveMutation.isPending} size="lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput label="部门名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <FormInput label="部门编码" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <FormSelect label="上级部门" options={parentOptions} value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} className="md:col-span-2" />
          <FormInput label="描述" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="md:col-span-2" />
        </div>
      </Modal>

      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="确认删除" onConfirm={() => deleteId && deleteMutation.mutate(deleteId)} loading={deleteMutation.isPending} confirmText="删除" confirmVariant="danger">
        <p className="text-sm text-ink-soft">确定要删除该部门吗？删除后无法恢复。</p>
      </Modal>
    </div>
  )
}

