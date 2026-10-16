import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, Upload, CheckCircle2, AlertTriangle } from 'lucide-react'
import apiClient from '../api/client'
import Modal from './Modal'
import Button from './Button'

/**
 * 一次补齐全部产品的型号价格表。
 *
 * 原来只能逐个产品打开、逐个导入价格表，54 个产品 0 个有价格表 —— 报价草稿能匹配到产品，单价却全是 0。
 * 三步：下载模板（已有型号每个一行、没有价格表的产品给一行空型号）→ 上传后先预览（每个产品新增/更新几个型号、
 * 哪些行对不上）→ 确认后写入。
 */
export default function PriceListBulkImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setFile(null)
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const downloadTemplate = async () => {
    try {
      const res: Blob = await apiClient.get('/products/price-list/template', { responseType: 'blob' }) as any
      const blob = res instanceof Blob ? res : new Blob([res as any])
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `全部产品价格表_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      toast.error('模板下载失败')
    }
  }

  const send = async (f: File, dryRun: boolean) => {
    const fd = new FormData()
    fd.append('file', f)
    const res: any = await apiClient.post(`/products/price-list/import-all${dryRun ? '?dryRun=1' : ''}`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res?.data && !Array.isArray(res) && 'summary' in (res.data || {}) ? res.data : res
  }

  const onPick = async (f: File | null) => {
    if (!f) return
    setFile(f)
    setBusy(true)
    try {
      setPreview(await send(f, true))
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '解析失败')
      reset()
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!file) return
    setBusy(true)
    try {
      const r = await send(file, false)
      toast.success(`已写入 ${r.products} 个产品的价格表，报价草稿会直接按型号出价`)
      for (const k of ['products', 'product-completeness', 'dashboard-stats', 'ops-health']) qc.invalidateQueries({ queryKey: [k] })
      reset()
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '导入失败')
    } finally {
      setBusy(false)
    }
  }

  const added = (preview?.summary || []).reduce((s: number, x: any) => s + x.added, 0)
  const updated = (preview?.summary || []).reduce((s: number, x: any) => s + x.updated, 0)

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      title="批量导入价格表"
      onConfirm={preview && preview.products > 0 ? apply : undefined}
      confirmText={preview ? `确认写入 ${preview.products} 个产品` : '确认'}
      loading={busy}
    >
      <div className="space-y-4 text-sm">
        <ol className="space-y-2">
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-accent-50 text-accent-700 text-caption flex items-center justify-center shrink-0">1</span>
            <div className="flex-1">
              下载模板：已有型号每个一行，还没有价格表的产品给一行空型号。按行填「型号规格」和价格（销售价 / 标配价 / 参考价 / 成本价）。
              <div className="mt-1.5">
                <Button variant="secondary" size="sm" onClick={downloadTemplate}><Download size={14} className="mr-1" /> 下载全部产品模板</Button>
              </div>
            </div>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-accent-50 text-accent-700 text-caption flex items-center justify-center shrink-0">2</span>
            <div className="flex-1">
              上传填好的文件，先看预览再决定是否写入（同一型号只覆盖填了的列）。
              <div className="mt-1.5 flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} loading={busy && !preview}>
                  <Upload size={14} className="mr-1" /> 选择文件
                </Button>
                {file && <span className="text-caption text-muted truncate">{file.name}</span>}
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => onPick(e.target.files?.[0] || null)} />
              </div>
            </div>
          </li>
        </ol>

        {preview && (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center gap-2 text-ink">
              <CheckCircle2 size={15} className="text-success-fg" />
              共 {preview.rows} 行：{preview.products} 个产品将新增 {added} 个型号、更新 {updated} 个型号
              {preview.skippedBlank > 0 && <span className="text-muted">（{preview.skippedBlank} 行空型号未填，已跳过）</span>}
            </div>
            {preview.summary?.length > 0 && (
              <ul className="max-h-40 overflow-y-auto text-caption text-ink-soft space-y-0.5">
                {preview.summary.map((x: any) => (
                  <li key={x.productId}>· {x.name}：新增 {x.added}、更新 {x.updated}（写入后共 {x.models} 个型号）</li>
                ))}
              </ul>
            )}
            {preview.errors?.length > 0 && (
              <div className="text-caption text-warning-fg space-y-0.5">
                <div className="flex items-center gap-1"><AlertTriangle size={13} /> {preview.errors.length} 行对不上，不会写入：</div>
                <ul className="max-h-28 overflow-y-auto">
                  {preview.errors.slice(0, 30).map((e: any, i: number) => <li key={i}>第 {e.row} 行：{e.message}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
