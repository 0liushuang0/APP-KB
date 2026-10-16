import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MapPin, Save, Wand2 } from 'lucide-react'
import { customerApi } from '../../api/services'
import Button from '../../components/Button'
import Modal from '../../components/Modal'
import PageLoader from '../../components/PageLoader'

const STATUS: Record<string, { label: string; tone: string }> = {
  ok: { label: '标准写法', tone: 'text-success-fg' },
  alias: { label: '别名 → 归并', tone: 'text-accent-700' },
  overseas: { label: '国家/片区 → 海外', tone: 'text-accent-700' },
  unknown: { label: '字典里没有（保留原样）', tone: 'text-warning-fg' },
  empty: { label: '未填', tone: 'text-muted' },
}

/**
 * 设置 · 区域字典。
 *
 * 客户区域原来同时有「华中区/华中」「华东区/华东」「海外/俄罗斯/南亚区域」，分布图与筛选被拆碎。
 * 这里维护标准写法与别名；左侧看现有每种写法有多少家、会归到哪里；确认后一键归并（只改区域与空着的国家）。
 * 之后新建、编辑、导入的客户保存时都会按字典自动归并。
 */
export default function RegionDictionary() {
  const queryClient = useQueryClient()
  const { data, isLoading, refetch } = useQuery({ queryKey: ['region-dict'], queryFn: () => customerApi.regionDict() })
  const [rows, setRows] = useState<Array<{ value: string; aliases: string }>>([])
  const [overseas, setOverseas] = useState('')
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (!data?.dict) return
    setRows(data.dict.regions.map((r: any) => ({ value: r.value, aliases: (r.aliases || []).join('、') })))
    setOverseas(
      Object.entries(data.dict.overseas || {})
        .map(([k, v]) => (v ? `${k}=${v}` : k))
        .join('、'),
    )
  }, [data])

  const toDict = () => ({
    regions: rows
      .filter((r) => r.value.trim())
      .map((r) => ({ value: r.value.trim(), aliases: r.aliases.split(/[、,，\s]+/).map((a) => a.trim()).filter(Boolean) })),
    overseas: Object.fromEntries(
      overseas
        .split(/[、,，\s]+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const [k, v] = x.split('=')
          return [k.trim(), (v || '').trim()]
        }),
    ),
  })

  const save = async () => {
    setSaving(true)
    try {
      await customerApi.saveRegionDict(toDict())
      toast.success('区域字典已保存')
      refetch()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const openPreview = async () => {
    try {
      setPreview(await customerApi.applyRegionDict(true))
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '预览失败')
    }
  }

  const apply = async () => {
    setApplying(true)
    try {
      const r = await customerApi.applyRegionDict(false)
      toast.success(`已归并 ${r.changed} 家客户的区域`)
      setPreview(null)
      refetch()
      queryClient.invalidateQueries({ queryKey: ['customers'] })
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '归并失败')
    } finally {
      setApplying(false)
    }
  }

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-5">
      <div className="bg-surface border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <MapPin size={16} className="text-accent-500" />
          <h3 className="text-sm font-semibold text-ink">现有区域写法</h3>
          <span className="text-caption text-muted">共 {data?.usage?.reduce((s: number, u: any) => s + u.count, 0) ?? 0} 家客户</span>
          <Button size="sm" className="ml-auto" onClick={openPreview} disabled={!data?.changes}>
            <Wand2 size={14} className="mr-1" /> {data?.changes ? `预览归并（${data.changes} 家会变）` : '已全部是标准写法'}
          </Button>
        </div>
        <p className="text-caption text-muted mb-3">归并只改「区域」和空着的「国家/地区」，其它字段不动；认不出的写法保留原样，先在下方字典里补映射。</p>
        <table className="w-full text-sm">
          <thead className="text-caption text-muted bg-canvas">
            <tr>
              <th className="text-left px-3 py-2 font-medium">现在写的</th>
              <th className="text-right px-3 py-2 font-medium">客户数</th>
              <th className="text-left px-3 py-2 font-medium">归到</th>
              <th className="text-left px-3 py-2 font-medium">国家（从区域/地址认出）</th>
              <th className="text-left px-3 py-2 font-medium">说明</th>
            </tr>
          </thead>
          <tbody>
            {(data?.usage || []).map((u: any) => (
              <tr key={u.value || '(空)'} className="border-t border-border">
                <td className="px-3 py-2 text-ink">{u.value || <span className="text-muted">（未填）</span>}</td>
                <td className="px-3 py-2 text-right eo-num">{u.count}</td>
                <td className="px-3 py-2">{u.to || '—'}</td>
                <td className="px-3 py-2 text-caption text-muted">
                  {Object.entries(u.countries || {}).map(([c, n]) => `${c} ${n}`).join('、') || '—'}
                </td>
                <td className={`px-3 py-2 text-caption ${STATUS[u.status]?.tone || ''}`}>{STATUS[u.status]?.label || u.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-surface border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-ink">区域字典</h3>
          {data?.isDefault && <span className="text-caption text-muted">（系统默认，按库里多数写法设定）</span>}
          <Button size="sm" className="ml-auto" onClick={save} loading={saving}>
            <Save size={14} className="mr-1" /> 保存字典
          </Button>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input
                className="eo-input col-span-3 !py-1 !text-sm"
                value={r.value}
                onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                placeholder="标准写法"
              />
              <input
                className="eo-input col-span-9 !py-1 !text-sm"
                value={r.aliases}
                onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, aliases: e.target.value } : x)))}
                placeholder="别名，用顿号分隔（如 华东、华东地区）"
              />
            </div>
          ))}
          <button className="text-caption text-accent-600 hover:underline" onClick={() => setRows((p) => [...p, { value: '', aliases: '' }])}>
            + 加一个区域
          </button>
        </div>
        <div className="mt-4">
          <label className="eo-label block mb-1">写在区域里的境外国家 / 片区（归到「海外」，等号后是国家；不写国家则从地址认）</label>
          <textarea className="eo-input !text-sm" rows={3} value={overseas} onChange={(e) => setOverseas(e.target.value)} />
        </div>
      </div>

      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={`确认归并 ${preview?.changed ?? 0} 家客户的区域`}
        onConfirm={apply}
        loading={applying}
        confirmText="确认归并"
        size="lg"
      >
        <div className="max-h-[50vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-caption text-muted bg-canvas sticky top-0">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">客户</th>
                <th className="text-left px-3 py-1.5 font-medium">区域</th>
                <th className="text-left px-3 py-1.5 font-medium">国家/地区</th>
              </tr>
            </thead>
            <tbody>
              {(preview?.changes || []).map((c: any) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-3 py-1.5 text-ink">{c.name}</td>
                  <td className="px-3 py-1.5">
                    {c.from || '（空）'} → <b>{c.to || '（空）'}</b>
                  </td>
                  <td className="px-3 py-1.5 text-muted">{c.country || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  )
}
