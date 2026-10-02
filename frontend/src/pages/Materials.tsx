import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Search, Package, X } from 'lucide-react'
import { materialApi, supplierApi } from '../api/services'
import { useSupplierCategories } from '../hooks/useSupplierCategories'
import type { Material, MaterialSpecItem } from '../types'
import EntityPicker from '../components/EntityPicker'
import Button from '../components/Button'
import Modal from '../components/Modal'
import FormInput from '../components/FormInput'
import FormSelect from '../components/FormSelect'
import FormTextarea from '../components/FormTextarea'
import PageLoader from '../components/PageLoader'
import ErrorState from '../components/ErrorState'
import EmptyState from '../components/EmptyState'
import BatchEditBar from '../components/BatchEditBar'
import { useRegisterPageAssistant } from '../contexts/PageAssistantContext'

interface FormState {
  name: string
  category: string
  specs: MaterialSpecItem[]
  unit: string
  standardPrice: string
  description: string
}

const initialForm: FormState = { name: '', category: '', specs: [], unit: '件', standardPrice: '', description: '' }

function parseSpecs(raw?: string): MaterialSpecItem[] {
  try {
    const p = JSON.parse(raw || '[]')
    return Array.isArray(p) ? p : []
  } catch {
    return []
  }
}

export default function Materials() {
  const queryClient = useQueryClient()
  const [activeCat, setActiveCat] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Material | null>(null)
  const [form, setForm] = useState<FormState>(initialForm)
  // 批量选择的物料（卡片行勾选，页头出现批量修改/删除）
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const { categories } = useSupplierCategories()

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['materials'],
    queryFn: () => materialApi.list(),
  })

  const allMaterials = useMemo(() => (Array.isArray(data) ? (data as Material[]) : []), [data])

  // 按品类计数（左侧树用）
  const countByCat = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of allMaterials) {
      const c = t.category || '其他'
      m.set(c, (m.get(c) || 0) + 1)
    }
    return m
  }, [allMaterials])

  const filtered = useMemo(() => {
    let list = allMaterials
    if (activeCat !== 'all') list = list.filter((t) => (t.category || '其他') === activeCat)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((t) => t.name?.toLowerCase().includes(q) || t.materialCode?.toLowerCase().includes(q))
    }
    return list
  }, [allMaterials, activeCat, search])

  useRegisterPageAssistant({
    key: 'materials',
    label: '物料管理',
    questions: ['某物料有哪些供应商在供？', '同类物料按基准价排序是怎样的？'],
    context: `物料管理页（共 ${allMaterials.length} 个物料）。` + filtered.slice(0, 40).map((t, i) => `${i + 1}. ${t.materialCode}｜${t.name}｜${t.category || '其他'}`).join('\n'),
  })

  const openCreate = () => {
    setEditing(null)
    setForm({ ...initialForm, category: activeCat !== 'all' ? activeCat : '' })
    setModalOpen(true)
  }
  const openEdit = (m: Material) => {
    setEditing(m)
    setForm({
      name: m.name || '',
      category: m.category || '',
      specs: parseSpecs(m.specs),
      unit: m.unit || '件',
      standardPrice: m.standardPrice != null ? String(m.standardPrice) : '',
      description: m.description || '',
    })
    setModalOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        category: form.category || undefined,
        specs: form.specs.filter((s) => s.name?.trim()),
        unit: form.unit || '件',
        standardPrice: form.standardPrice ? Number(form.standardPrice) : undefined,
        description: form.description || undefined,
      }
      if (editing) return materialApi.update(editing.id, payload)
      return materialApi.create(payload)
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['materials'] })
      setModalOpen(false)
      if (!editing && data) {
        // 新建物料后自动打开比价弹窗，引导用户立即添加厂家报价
        setViewMaterial(data)
        toast.success('物料已创建，现在可以添加厂家报价')
      } else {
        toast.success('物料已更新')
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || '保存失败'),
  })

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [viewMaterial, setViewMaterial] = useState<Material | null>(null)
  const [showAddOffering, setShowAddOffering] = useState(false)
  const [offeringForm, setOfferingForm] = useState<any>({ supplierId: '', brand: '', model: '', priceMin: '', priceMax: '', deliveryDays: '', moq: '' })

  // P3：该物料各厂家报价对比（同规格跨厂家比价）
  const { data: offerings, isFetching: offeringsLoading } = useQuery({
    queryKey: ['material-offerings', viewMaterial?.id],
    queryFn: () => materialApi.offerings(viewMaterial!.id),
    enabled: !!viewMaterial,
    staleTime: 30_000,
  })

  // 厂家搜索（EntityPicker）
  const searchSuppliers = async (kw: string) => {
    const res: any = await supplierApi.list({ keyword: kw || undefined, pageSize: 50 })
    const list = Array.isArray(res) ? res : res?.list || []
    return list.map((s: any) => ({ value: s.id, label: s.name, hint: [s.origin, s.tier].filter(Boolean).join(' · ') || undefined }))
  }
  const resolveSupplier = async (id: string) => {
    const s: any = await supplierApi.get(id)
    return s ? { value: s.id, label: s.name } : null
  }

  // 添加厂家报价
  const addOfferingMutation = useMutation({
    mutationFn: () => materialApi.addOffering(viewMaterial!.id, {
      supplierId: offeringForm.supplierId,
      brand: offeringForm.brand || undefined,
      model: offeringForm.model || undefined,
      priceMin: offeringForm.priceMin ? Number(offeringForm.priceMin) : undefined,
      priceMax: offeringForm.priceMax ? Number(offeringForm.priceMax) : undefined,
      deliveryDays: offeringForm.deliveryDays ? Number(offeringForm.deliveryDays) : undefined,
      moq: offeringForm.moq ? Number(offeringForm.moq) : undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['material-offerings', viewMaterial?.id] })
      setShowAddOffering(false)
      setOfferingForm({ supplierId: '', brand: '', model: '', priceMin: '', priceMax: '', deliveryDays: '', moq: '' })
      toast.success('已添加厂家报价')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '添加失败'),
  })

  // 删除厂家报价
  const removeOfferingMutation = useMutation({
    mutationFn: (offeringId: string) => materialApi.removeOffering(viewMaterial!.id!, offeringId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['material-offerings', viewMaterial?.id] })
      toast.success('已删除')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || '删除失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => materialApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] })
      setDeletingId(null)
      toast.success('已删除')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || '删除失败'),
  })

  const setSpec = (idx: number, key: keyof MaterialSpecItem, val: string) =>
    setForm((f) => ({ ...f, specs: f.specs.map((s, i) => (i === idx ? { ...s, [key]: val } : s)) }))
  const addSpec = () => setForm((f) => ({ ...f, specs: [...f.specs, { name: '', value: '' }] }))
  const removeSpec = (idx: number) => setForm((f) => ({ ...f, specs: f.specs.filter((_, i) => i !== idx) }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-heading-lg font-medium text-ink">物料管理</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              placeholder="搜索物料名称/编码"
              onChange={(e) => setSearch(e.target.value)}
              className="eo-input !w-64 !pl-8 !py-1.5 !text-sm"
            />
          </div>
          <Button onClick={openCreate} size="sm" className="!py-1.5 !text-sm">
            <Plus size={14} className="mr-1" /> 新建物料
          </Button>
          {/* 批量操作收到页头：勾选后才出现，琥珀修改/红色删除一眼可见（与客户业务各页一致） */}
          <BatchEditBar
            selectedKeys={selectedIds}
            onClear={() => setSelectedIds([])}
            moduleName="物料"
            queryKey={['materials']}
            updateFn={(id, dto) => materialApi.update(id, dto)}
            deleteFn={(id) => materialApi.remove(id)}
            fields={[
              { key: 'category', label: '品类', options: categories.map((c) => ({ value: c, label: c })) },
            ]}
          />
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* 左：品类树（与供应商大类同源） */}
        <aside className="lg:w-52 flex-shrink-0">
          <div className="eo-card p-2">
            <button
              onClick={() => setActiveCat('all')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${activeCat === 'all' ? 'bg-accent-50 text-accent-700 font-medium' : 'text-ink-soft hover:bg-canvas'}`}
            >
              <Package size={14} className="text-muted" /> 全部
              <span className="ml-auto text-xs text-muted">{allMaterials.length}</span>
            </button>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCat(c)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm ${activeCat === c ? 'bg-accent-50 text-accent-700 font-medium' : 'text-ink-soft hover:bg-canvas'}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-muted flex-shrink-0" />
                <span className="flex-1 text-left truncate">{c}</span>
                <span className="text-xs text-muted">{countByCat.get(c) || 0}</span>
              </button>
            ))}
            <p className="px-2 py-1.5 text-caption text-muted">品类与供应商大类同源，供应商改了这里自动跟随。</p>
          </div>
        </aside>

        {/* 右：物料列表 */}
        <div className="flex-1 min-w-0">
          {isLoading ? <PageLoader /> : isError ? <ErrorState message={error?.message} onRetry={refetch} /> : null}
          {!isLoading && !isError && filtered.length === 0 ? (
            <EmptyState title="暂无物料" description="新建物料后，可把多家供应商的同类产品挂上来做同规格比价" />
          ) : null}
          {!isLoading && !isError && filtered.length > 0 && (
            <div className="space-y-2">
              {/* 列表头部：全选当前筛选结果 */}
              <div className="flex items-center gap-2 px-1 text-caption text-muted">
                <input
                  type="checkbox"
                  className="rounded border-border"
                  aria-label="全选当前列表物料"
                  checked={filtered.length > 0 && filtered.every((m) => selectedIds.includes(m.id))}
                  onChange={(e) => {
                    const ids = filtered.map((m) => m.id)
                    setSelectedIds(
                      e.target.checked
                        ? [...new Set([...selectedIds, ...ids])]
                        : selectedIds.filter((id) => !ids.includes(id)),
                    )
                  }}
                />
                <span>共 {filtered.length} 个物料</span>
              </div>
              {filtered.map((m) => {
                const specs = parseSpecs(m.specs)
                const checked = selectedIds.includes(m.id)
                return (
                  <div key={m.id} className={`eo-card p-4 flex items-center gap-3 ${checked ? 'ring-1 ring-accent-300 bg-accent-50/40' : ''}`}>
                    <input
                      type="checkbox"
                      className="rounded border-border flex-shrink-0"
                      aria-label={`选择「${m.name}」`}
                      checked={checked}
                      onChange={(e) =>
                        setSelectedIds(
                          e.target.checked
                            ? [...selectedIds, m.id]
                            : selectedIds.filter((id) => id !== m.id),
                        )
                      }
                    />
                    <div className="w-10 h-10 rounded-lg bg-accent-50 flex items-center justify-center flex-shrink-0">
                      <Package size={18} className="text-accent-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink truncate">{m.name}</span>
                        <code className="text-xs font-mono text-accent-600">{m.materialCode}</code>
                        {m.category && <span className="text-caption text-muted bg-canvas px-1.5 py-0.5 rounded">{m.category}</span>}
                      </div>
                      <p className="text-caption text-muted mt-0.5 truncate">
                        {specs.length ? specs.map((s) => `${s.name}:${s.value}`).join(' · ') : '—'}
                        {m.standardPrice != null && ` · 基准价 ¥${m.standardPrice}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => setViewMaterial(m)} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-accent-50 text-accent-700 border border-accent-200 hover:bg-accent-100 transition-colors font-medium" title="查看各厂家报价 / 添加报价">
                        <Plus size={12} /> 厂家报价
                      </button>
                      <button onClick={() => openEdit(m)} className="p-1.5 rounded text-muted hover:text-ink hover:bg-canvas" title="编辑"><Pencil size={15} /></button>
                      <button onClick={() => setDeletingId(m.id)} className="p-1.5 rounded text-muted hover:text-danger-fg hover:bg-danger-bg" title="删除"><Trash2 size={15} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 新建/编辑弹窗 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? '编辑物料' : '新建物料'}
        onConfirm={() => {
          if (!form.name.trim()) { toast.error('请输入物料名称'); return }
          saveMutation.mutate()
        }}
        loading={saveMutation.isPending}
        size="lg"
      >
        <div className="space-y-4">
          {editing && <FormInput label="物料编码（自动生成）" value={editing.materialCode} readOnly />}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormInput label="物料名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 液压油缸" />
            <FormSelect
              label="品类（与供应商大类同源）"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              options={[{ value: '', label: '— 选择品类 —' }, ...categories.map((c) => ({ value: c, label: c }))]}
            />
          </div>
          {/* 规格编辑（name/value，决定"同规格"匹配） */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="eo-label">规格参数（同规格跨厂家比价的依据）</label>
              <button onClick={addSpec} className="text-xs text-accent-600 hover:text-accent-700 flex items-center gap-0.5"><Plus size={12} /> 添加</button>
            </div>
            <div className="space-y-2">
              {form.specs.length === 0 && <p className="text-xs text-muted">还没有规格参数，点"添加"录入如 缸径/行程/压力。</p>}
              {form.specs.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={s.name} onChange={(e) => setSpec(i, 'name', e.target.value)} placeholder="参数名（如 缸径）" className="eo-input flex-1 !text-sm" />
                  <input value={s.value} onChange={(e) => setSpec(i, 'value', e.target.value)} placeholder="值（如 Φ100）" className="eo-input flex-1 !text-sm" />
                  <button onClick={() => removeSpec(i)} className="p-1.5 rounded text-muted hover:text-danger-fg"><X size={14} /></button>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormInput label="单位" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            <FormInput label="基准价" value={form.standardPrice} onChange={(e) => setForm({ ...form, standardPrice: e.target.value })} placeholder="如 1200" />
          </div>
          <FormTextarea label="描述" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
        </div>
      </Modal>

      {/* 删除确认 */}
      <Modal
        open={!!deletingId}
        onClose={() => setDeletingId(null)}
        title="确认删除物料"
        onConfirm={() => deletingId && deleteMutation.mutate(deletingId)}
        loading={deleteMutation.isPending}
        confirmText="删除"
        size="sm"
      >
        <p className="text-sm text-ink-soft">删除后，已挂到该物料的供应报价会失去关联（报价本身不删）。确定删除？</p>
      </Modal>

      {/* P3：同规格跨厂家比价 + 厂家报价录入 */}
      <Modal
        open={!!viewMaterial}
        onClose={() => { setViewMaterial(null); setShowAddOffering(false) }}
        title={`「${viewMaterial?.name}」各厂家报价对比`}
        size="xl"
      >
        {/* 添加厂家报价表单 */}
        {showAddOffering ? (
          <div className="bg-subtle rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-ink">添加厂家报价</span>
              <button onClick={() => setShowAddOffering(false)} className="text-muted hover:text-ink"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <EntityPicker
                  label="厂家（来自供应管理）"
                  queryKey="suppliers-offering"
                  value={offeringForm.supplierId}
                  onChange={(id: string) => setOfferingForm({ ...offeringForm, supplierId: id })}
                  search={searchSuppliers}
                  resolve={resolveSupplier}
                  placeholder="搜索厂家名称…"
                />
              </div>
              <FormInput label="品牌" value={offeringForm.brand} onChange={(e: any) => setOfferingForm({ ...offeringForm, brand: e.target.value })} placeholder="如 Rexroth" />
              <FormInput label="型号" value={offeringForm.model} onChange={(e: any) => setOfferingForm({ ...offeringForm, model: e.target.value })} />
              <FormInput label="最低价(元)" type="number" value={offeringForm.priceMin} onChange={(e: any) => setOfferingForm({ ...offeringForm, priceMin: e.target.value })} />
              <FormInput label="最高价(元)" type="number" value={offeringForm.priceMax} onChange={(e: any) => setOfferingForm({ ...offeringForm, priceMax: e.target.value })} />
              <FormInput label="交期(天)" type="number" value={offeringForm.deliveryDays} onChange={(e: any) => setOfferingForm({ ...offeringForm, deliveryDays: e.target.value })} />
              <FormInput label="MOQ" type="number" value={offeringForm.moq} onChange={(e: any) => setOfferingForm({ ...offeringForm, moq: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="secondary" size="sm" onClick={() => setShowAddOffering(false)}>取消</Button>
              <Button size="sm" loading={addOfferingMutation.isPending} onClick={() => {
                if (!offeringForm.supplierId) { toast.error('请选择厂家'); return }
                addOfferingMutation.mutate()
              }}>添加报价</Button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAddOffering(true)} className="mb-3 flex items-center gap-1 text-sm text-accent-600 hover:text-accent-700">
            <Plus size={14} /> 添加厂家报价
          </button>
        )}

        {offeringsLoading ? (
          <div className="py-8 text-center text-sm text-muted">加载中…</div>
        ) : offerings && offerings.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border">
                  <th className="px-3 py-2 font-medium">厂家</th>
                  <th className="px-3 py-2 font-medium">品牌/型号</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">单价区间</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">交期(天)</th>
                  <th className="px-3 py-2 font-medium text-right whitespace-nowrap">MOQ</th>
                  <th className="px-3 py-2 font-medium">档次</th>
                  <th className="px-3 py-2 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {offerings.map((o: any, i: number) => (
                  <tr key={o.id} className={`border-b border-border/60 ${i === 0 && o.priceMin ? 'bg-success-bg/40' : ''}`}>
                    <td className="px-3 py-2.5 text-ink font-medium">{o.supplierName || '—'}</td>
                    <td className="px-3 py-2.5 text-ink-soft">{[o.brand, o.model].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="px-3 py-2.5 text-right text-ink whitespace-nowrap">
                      {o.priceMin != null ? `¥${Number(o.priceMin).toLocaleString('zh-CN')}${o.priceMax != null && o.priceMax !== o.priceMin ? ` ~ ¥${Number(o.priceMax).toLocaleString('zh-CN')}` : ''}` : '—'}
                      {i === 0 && o.priceMin && <span className="ml-1 text-[10px] text-success-fg">最低</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-ink-soft whitespace-nowrap">{o.deliveryDays ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right text-ink-soft whitespace-nowrap">{o.moq ?? '—'}</td>
                    <td className="px-3 py-2.5 text-ink-soft">{o.tier || '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <button onClick={() => removeOfferingMutation.mutate(o.id)} className="p-1 rounded text-muted hover:text-danger-fg" title="删除该报价"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 py-2 text-caption text-muted">共 {offerings.length} 家供应，按最低价升序，首行高亮为最低价。</p>
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-muted">
            还没有厂家报价。点上方"添加厂家报价"，选厂家填价格即可。
          </div>
        )}
      </Modal>
    </div>
  )
}
