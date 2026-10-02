import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Plus, Pencil, Trash2 } from 'lucide-react'
import { userApi, departmentApi, roleApi } from '../../api/services'
import { useFormValidation, required } from '../../hooks/useFormValidation'
import Button from '../../components/Button'
import Modal from '../../components/Modal'
import DataTable from '../../components/DataTable'
import FormInput from '../../components/FormInput'
import FormSelect from '../../components/FormSelect'
import EmptyState from '../../components/EmptyState'
import PageLoader from '../../components/PageLoader'
import ErrorState from '../../components/ErrorState'
import { toast } from 'sonner'

export default function UserManagement() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editing, setEditing] = useState<any | null>(null)
  const initialForm = { username: '', password: '', nickname: '', email: '', departmentId: '', roleIds: [] as string[] }
  const { values: form, errors, isValid, setValue, setValues, validateAll, reset } = useFormValidation({
    initialValues: initialForm,
    rules: {
      username: required('请输入用户名'),
      password: (value) => (!editing && !value ? '请输入密码' : undefined),
    },
  })

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['users-admin'],
    queryFn: () => userApi.list(),
  })

  const { data: departments } = useQuery({
    queryKey: ['departments-admin'],
    queryFn: () => departmentApi.list(),
  })

  const { data: roles } = useQuery({
    queryKey: ['roles-admin'],
    queryFn: () => roleApi.list(),
  })

  const saveMutation = useMutation({
    mutationFn: (dto: any) => editing ? userApi.update(editing.id, dto) : userApi.create(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users-admin'] })
      toast.success(editing ? '用户已更新' : '用户已创建')
      closeModal()
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || '操作失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => userApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users-admin'] })
      toast.success('用户已删除')
      setDeleteId(null)
    },
  })

  const filtered = (data || []).filter((u: any) => u.username?.includes(search) || u.nickname?.includes(search))

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    reset()
  }

  const openEdit = (row: any) => {
    setEditing(row)
    setValues({
      username: row.username,
      password: '',
      nickname: row.nickname || '',
      email: row.email || '',
      departmentId: row.department?.id || '',
      roleIds: row.roles?.map((r: any) => r.id) || [],
    })
    setModalOpen(true)
  }

  const handleSubmit = () => {
    if (!validateAll()) return
    const dto: any = { ...form }
    if (editing && !dto.password) delete dto.password
    saveMutation.mutate(dto)
  }

  const deptOptions = [{ value: '', label: '无' }, ...(departments || []).map((d: any) => ({ value: d.id, label: d.name }))]

  if (isLoading) return <PageLoader />
  if (error) return <ErrorState onRetry={refetch} />

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <h2 className="font-serif text-heading-lg font-medium text-ink">用户管理</h2>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              placeholder="搜索用户名/昵称"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-3 py-2 border border-border rounded-md text-sm w-64"
            />
          </div>
          <Button onClick={() => { reset(); setModalOpen(true) }}><Plus size={16} className="mr-1" /> 新建用户</Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <DataTable
          data={filtered}
          columns={[
            { key: 'username', title: '用户名' },
            { key: 'nickname', title: '昵称' },
            { key: 'email', title: '邮箱' },
            { key: 'department', title: '部门', render: (row: any) => row.department?.name || '-' },
            { key: 'roles', title: '角色', render: (row: any) => row.roles?.map((r: any) => r.name).join(', ') || '-' },
            { key: 'isActive', title: '状态', render: (row: any) => row.isActive ? '启用' : '禁用' },
          ]}
          actions={(row: any) => (
            <div className="flex items-center gap-2">
              <button onClick={() => openEdit(row)} className="text-ink-soft hover:text-ink" title={"编辑"}
              aria-label="编辑">
                <Pencil size={16} />
              </button>
              <button onClick={() => setDeleteId(row.id)} className="text-danger-fg hover:text-danger-fg" title={"删除"}
              aria-label="删除">
                <Trash2 size={16} />
              </button>
            </div>
          )}
        />
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? '编辑用户' : '新建用户'}
        onConfirm={handleSubmit}
        loading={saveMutation.isPending}
        confirmDisabled={!isValid}
        size="lg"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormInput label="用户名" value={form.username} onChange={(e) => setValue('username', e.target.value)} error={errors.username} disabled={!!editing} required />
          <FormInput label={editing ? '密码（留空不修改）' : '密码'} type="password" value={form.password} onChange={(e) => setValue('password', e.target.value)} error={errors.password} required={!editing} />
          <FormInput label="昵称" value={form.nickname} onChange={(e) => setValue('nickname', e.target.value)} />
          <FormInput label="邮箱" value={form.email} onChange={(e) => setValue('email', e.target.value)} />
          <FormSelect label="部门" options={deptOptions} value={form.departmentId} onChange={(e) => setValue('departmentId', e.target.value)} />
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-ink-soft mb-1">角色</label>
            <div className="flex flex-wrap gap-2">
              {(roles || []).map((role: any) => (
                <label key={role.id} className="inline-flex items-center gap-1 px-3 py-1 bg-subtle border border-border rounded-md text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.roleIds.includes(role.id)}
                    onChange={(e) => {
                      const ids = e.target.checked
                        ? [...form.roleIds, role.id]
                        : form.roleIds.filter((id) => id !== role.id)
                      setValue('roleIds', ids)
                    }}
                  />
                  {role.name}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="确认删除"
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
        confirmText="删除"
      >
        <p className="text-sm text-ink-soft">确定要删除该用户吗？删除后无法恢复。</p>
      </Modal>
    </div>
  )
}

