import { useMemo, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Search, Plus, Pencil, Trash2, Settings, X } from 'lucide-react'
import { systemConfigApi } from '../../api/services'
import { useFormValidation, required } from '../../hooks/useFormValidation'
import { useSystemNameStore } from '../../store/systemNameStore'
import type { SystemConfigItem } from '../../types'
import Button from '../../components/Button'
import Modal from '../../components/Modal'
import FormInput from '../../components/FormInput'
import FormTextarea from '../../components/FormTextarea'
import PageLoader from '../../components/PageLoader'
import ErrorState from '../../components/ErrorState'

const initialForm = {
  key: '',
  value: '',
  category: '',
  description: '',
}

const handleError = (error: any) => {
  toast.error(error?.response?.data?.message || error?.message || '操作失败')
}

export default function SystemConfigPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [editing, setEditing] = useState<SystemConfigItem | null>(null)
  const { values: form, errors, isValid, setValue, setValues, validateAll, reset } = useFormValidation({
    initialValues: initialForm,
    rules: {
      key: required('请输入配置 Key'),
      value: required('请输入配置值'),
    },
  })

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['system-configs'],
    queryFn: () => systemConfigApi.list(),
  })

  const allData: SystemConfigItem[] = Array.isArray(data) ? data : []

  // Inline editing for system name and admin title
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [subtitleInput, setSubtitleInput] = useState('')
  const [editingSubtitle, setEditingSubtitle] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const systemNameStore = useSystemNameStore()

  useEffect(() => {
    const nameItem = allData.find((it) => it.key === 'system_name')
    if (nameItem?.value) setNameInput(nameItem.value)
    const subItem = allData.find((it) => it.key === 'system_subtitle')
    if (subItem?.value) setSubtitleInput(subItem.value)
    const titleItem = allData.find((it) => it.key === 'admin_title')
    if (titleItem?.value) setTitleInput(titleItem.value)
  }, [allData])

  const groups = useMemo(() => {
    const filtered = search
      ? allData.filter((it) => it.key?.toLowerCase().includes(search.toLowerCase()) || it.category?.toLowerCase().includes(search.toLowerCase()))
      : allData
    const map = new Map<string, SystemConfigItem[]>()
    filtered.forEach((c) => {
      const cat = c.category || '未分类'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(c)
    })
    return Array.from(map.entries())
  }, [allData, search])

  const saveMutation = useMutation({
    mutationFn: (dto: any) => (editing ? systemConfigApi.update(editing.id, dto) : systemConfigApi.set(dto)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-configs'] })
      closeModal()
      refetch()
    },
    onError: handleError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => systemConfigApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-configs'] })
      setDeleteId(null)
      refetch()
    },
    onError: handleError,
  })

  const openCreate = () => {
    setEditing(null)
    reset()
    setModalOpen(true)
  }

  const openEdit = (row: SystemConfigItem) => {
    setEditing(row)
    setValues({
      key: row.key || '',
      value: row.value || '',
      category: row.category || '',
      description: row.description || '',
    })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
    reset()
  }

  const handleSubmit = () => {
    if (!validateAll()) return
    saveMutation.mutate({ ...form })
  }

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <h2 className="text-lg font-semibold">系统配置</h2>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              placeholder="搜索 Key / 分类"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-3 py-2 border border-border rounded-md text-sm w-64"
            />
          </div>
          <Button onClick={openCreate}>
            <Plus size={16} className="mr-1" /> 新建配置
          </Button>
        </div>
      </div>

      {isLoading && !data && <PageLoader />}
      {isError && <ErrorState message={error?.message || '加载失败'} onRetry={refetch} />}
      {!isLoading && !isError && (
        <>
          {/* Inline system name & admin title editing */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="bg-surface border border-border rounded-lg p-4">
              <label className="eo-label block mb-2">系统名称</label>
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() }
                      if (e.key === 'Escape') setEditingName(false)
                    }}
                    onBlur={async () => {
                      const val = nameInput.trim()
                      if (val) {
                        try {
                          await systemConfigApi.set({ key: 'system_name', value: val, category: 'system', description: '系统名称（显示在导航栏和浏览器标签）' })
                          systemNameStore.setName(val)
                          toast.success('系统名称已更新')
                          refetch()
                        } catch { toast.error('保存失败') }
                      }
                      setEditingName(false)
                    }}
                    className="eo-input flex-1"
                    placeholder="输入系统名称"
                  />
                  <button onClick={() => setEditingName(false)} className="text-muted hover:text-ink" title={"取消"}
                  aria-label="取消">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-ink font-medium">{nameInput || 'BOYA 智能运营中心'}</span>
                  <button onClick={() => setEditingName(true)} className="text-muted hover:text-accent-600" title={"编辑"}
                  aria-label="编辑">
                    <Pencil size={15} />
                  </button>
                </div>
              )}
            </div>

            {/* 副标题原来写死在 Layout 和登录页里，改不了 —— 现在也可配 */}
            <div className="bg-surface border border-border rounded-lg p-4">
              <label className="eo-label block mb-2">系统副标题</label>
              {editingSubtitle ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={subtitleInput}
                    onChange={(e) => setSubtitleInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() }
                      if (e.key === 'Escape') setEditingSubtitle(false)
                    }}
                    onBlur={async () => {
                      const val = subtitleInput.trim()
                      if (val) {
                        try {
                          await systemConfigApi.set({ key: 'system_subtitle', value: val, category: 'system', description: '系统副标题（logo 下方小字）' })
                          systemNameStore.setSubtitle(val)
                          toast.success('副标题已更新')
                          refetch()
                        } catch { toast.error('保存失败') }
                      }
                      setEditingSubtitle(false)
                    }}
                    className="eo-input flex-1"
                    placeholder="如 CUSTOMER RESPONSE COPILOT"
                  />
                  <button onClick={() => setEditingSubtitle(false)} className="text-muted hover:text-ink" title={"取消"}
                  aria-label="取消">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-ink font-medium truncate">{subtitleInput || 'CUSTOMER RESPONSE COPILOT'}</span>
                  <button onClick={() => setEditingSubtitle(true)} className="text-muted hover:text-accent-600 shrink-0" title={"编辑"}
                  aria-label="编辑">
                    <Pencil size={15} />
                  </button>
                </div>
              )}
            </div>

            <div className="bg-surface border border-border rounded-lg p-4">
              <label className="eo-label block mb-2">管理员头衔</label>
              {editingTitle ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() }
                      if (e.key === 'Escape') setEditingTitle(false)
                    }}
                    onBlur={async () => {
                      const val = titleInput.trim()
                      if (val) {
                        try {
                          await systemConfigApi.set({ key: 'admin_title', value: val, category: 'system', description: '管理员头衔显示名称' })
                          systemNameStore.setAdminTitle(val)
                          toast.success('管理员头衔已更新')
                          refetch()
                        } catch { toast.error('保存失败') }
                      }
                      setEditingTitle(false)
                    }}
                    className="eo-input flex-1"
                    placeholder="输入头衔"
                  />
                  <button onClick={() => setEditingTitle(false)} className="text-muted hover:text-ink" title={"取消"}
                  aria-label="取消">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-ink font-medium">{titleInput || '超级管理员'}</span>
                  <button onClick={() => setEditingTitle(true)} className="text-muted hover:text-accent-600" title={"编辑"}
                  aria-label="编辑">
                    <Pencil size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>

        <div className="space-y-4">
          {groups.length === 0 ? (
            <p className="text-sm text-muted py-8 text-center">暂无配置项</p>
          ) : (
            groups.map(([cat, items]) => (
              <div key={cat} className="bg-surface border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-canvas border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2 font-medium text-ink">
                    <Settings size={16} className="text-accent-600" /> {cat}
                  </div>
                  <span className="text-xs text-muted">{items.length} 项</span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {items.map((c) => (
                      <tr key={c.id} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-2.5 font-medium text-ink-soft w-48">{c.key}</td>
                        <td className="px-4 py-2.5 text-ink-soft break-all">{c.value}</td>
                        <td className="px-4 py-2.5 text-muted text-xs w-64">{c.description || '-'}</td>
                        <td className="px-4 py-2.5 text-right w-24">
                          <div className="flex items-center gap-2 justify-end">
                            <button onClick={() => openEdit(c)} className="text-ink-soft hover:text-ink" title={"编辑"}
                            aria-label="编辑">
                              <Pencil size={16} />
                            </button>
                            <button onClick={() => setDeleteId(c.id)} className="text-danger-fg hover:text-danger-fg" title={"删除"}
                            aria-label="删除">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? '编辑配置' : '新建配置'}
        onConfirm={handleSubmit}
        loading={saveMutation.isPending}
        confirmDisabled={!isValid}
        size="md"
      >
        <div className="space-y-4">
          <FormInput label="配置 Key" value={form.key} onChange={(e) => setValue('key', e.target.value)} error={errors.key} required disabled={!!editing} />
          <FormTextarea label="配置值" rows={3} value={form.value} onChange={(e) => setValue('value', e.target.value)} error={errors.value} required />
          <FormInput label="分类" value={form.category} onChange={(e) => setValue('category', e.target.value)} />
          <FormTextarea label="描述" rows={2} value={form.description} onChange={(e) => setValue('description', e.target.value)} />
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
        <p className="text-sm text-ink-soft">确定要删除该配置项吗？删除后无法恢复。</p>
      </Modal>
    </div>
  )
}
