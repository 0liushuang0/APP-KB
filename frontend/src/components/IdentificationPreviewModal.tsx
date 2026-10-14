import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import Modal from './Modal'
import Button from './Button'
import { requirementApi, paramTemplateApi, downloadRequirementIdentification } from '../api/services'
import { toList } from '../utils/apiList'

interface TemplateField {
  key: string
  label: string
  unit?: string
  section?: string
  required?: boolean
  remark?: string
}

interface PreviewData {
  id: string
  requirementNo: string
  title: string
  templateCategory: string
  customerName: string
  docTitle: string
  fields: TemplateField[]
  values: Record<string, any>
  spec: any
}

interface Props {
  open: boolean
  onClose: () => void
  requirementId: string | null
}

/**
 * 需求识别文件导出预览。
 *
 * 与后端 PDF/DOCX 同一份取数（/identification-preview），按文档版式渲染成
 * 可编辑的预览：参数值直接改（写回 structuredSpec.exportValues，导出时优先用），
 * 项目名称/需求分类也能改（走需求更新接口，改分类会换模板重新出字段）。
 * 导出前自动保存，保证「预览所见 = 导出所得」。
 */
export default function IdentificationPreviewModal({ open, onClose, requirementId }: Props) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [templateCategory, setTemplateCategory] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['identification-preview', requirementId],
    queryFn: () => requirementApi.identificationPreview(requirementId!),
    enabled: open && !!requirementId,
  })

  const { data: templates } = useQuery({
    queryKey: ['param-templates-select'],
    queryFn: () => paramTemplateApi.list(),
    enabled: open,
  })
  const templateOptions = useMemo(
    () =>
      toList<any>(templates).map((t) => ({
        value: t.category,
        label: t.category?.includes('/') ? t.category.split('/').join(' / ') : t.category,
      })),
    [templates],
  )

  const preview = data as PreviewData | undefined

  // 数据到位后初始化本地编辑态：字段值按 key → 标签 两级兜底
  useEffect(() => {
    if (!preview) return
    setTitle(preview.title || '')
    setTemplateCategory(preview.templateCategory || '')
    const init: Record<string, string> = {}
    for (const f of preview.fields || []) {
      const raw = preview.values?.[f.key] ?? preview.values?.[f.label]
      init[f.key] = raw === undefined || raw === null ? '' : Array.isArray(raw) ? raw.join('、') : String(raw)
    }
    setValues(init)
  }, [preview])

  // 换了需求分类后字段列表跟模板走，新字段的初值从预览数据里补
  const fields = preview?.fields || []
  const sections = useMemo(() => {
    const map = new Map<string, TemplateField[]>()
    for (const f of fields) {
      const sec = f.section || '其他'
      if (!map.has(sec)) map.set(sec, [])
      map.get(sec)!.push(f)
    }
    return [...map.entries()]
  }, [fields])

  const setValue = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }))

  /** 把预览里的修改写回：参数值进 spec.exportValues，标题/分类走需求更新接口 */
  const saveEdits = async (): Promise<boolean> => {
    if (!requirementId || !preview) return false
    setSaving(true)
    try {
      const mergedSpec = { ...(preview.spec || {}), exportValues: values }
      await requirementApi.updateSpec(requirementId, mergedSpec)
      if (title !== (preview.title || '') || templateCategory !== (preview.templateCategory || '')) {
        await requirementApi.update(requirementId, { title, templateCategory })
      }
      queryClient.invalidateQueries({ queryKey: ['requirements'] })
      queryClient.invalidateQueries({ queryKey: ['requirement', requirementId] })
      await refetch()
      return true
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || '保存失败')
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleExport = async (fmt: 'pdf' | 'docx') => {
    if (!preview) return
    setExporting(fmt)
    try {
      // 先保存再导出，保证导出的就是预览里看到的
      const ok = await saveEdits()
      if (!ok) return
      await downloadRequirementIdentification(requirementId!, preview.requirementNo || '', fmt)
      toast.success(fmt === 'pdf' ? 'PDF 已导出' : 'Word 已导出')
    } catch (e: any) {
      toast.error(e?.message || '导出失败')
    } finally {
      setExporting(null)
    }
  }

  const dirty =
    !!preview &&
    (title !== (preview.title || '') ||
      templateCategory !== (preview.templateCategory || '') ||
      fields.some((f) => {
        const raw = preview.values?.[f.key] ?? preview.values?.[f.label]
        const init = raw === undefined || raw === null ? '' : Array.isArray(raw) ? raw.join('、') : String(raw)
        return (values[f.key] ?? '') !== init
      }))

  return (
    <Modal open={open} onClose={onClose} title="预览 · 需求识别文件" size="xl">
      {isLoading && <div className="py-10 text-center text-sm text-muted">加载中…</div>}
      {!isLoading && !preview && <div className="py-10 text-center text-sm text-muted">加载失败，请重试</div>}
      {preview && (
        <>
          <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border bg-white p-6 text-ink shadow-inner">
            {/* 文档标题：需求分类最后一段 + 「需求信息文件」，与导出一致 */}
            <div className="text-center text-lg font-bold">{preview.docTitle || '需求信息文件'}</div>
            <p className="mt-4 indent-8 text-[13px] leading-6">
              为完成专业且详尽的方案及报价，有如下信息需要填写（以下信息尽量填全，若无法填写则双方交流确认）：
            </p>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-[13px] leading-6">
              <div>
                客户名称：{preview.customerName || <span className="text-muted">—</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="shrink-0">项目名称：</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full flex-1 rounded border border-transparent px-1 py-0.5 hover:border-border focus:border-accent-500 focus:outline-none"
                />
              </div>
              <div>
                需求编码：{preview.requirementNo || <span className="text-muted">—</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="shrink-0">需求分类：</span>
                <select
                  value={templateCategory}
                  onChange={(e) => setTemplateCategory(e.target.value)}
                  className="w-full flex-1 rounded border border-transparent px-1 py-0.5 hover:border-border focus:border-accent-500 focus:outline-none"
                >
                  <option value="">未指定</option>
                  {templateOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {sections.length === 0 && (
              <p className="mt-4 text-[13px] text-danger-fg">该需求尚未指定需求分类，无法按模板列出参数项。可在上方「需求分类」里选择后保存。</p>
            )}

            {sections.map(([section, items], i) => (
              <div key={section} className="mt-4">
                <div className="text-[13px] font-bold">{i + 1}.{section}</div>
                <table className="mt-1 w-full border-collapse text-[13px]">
                  <tbody>
                    {items.map((f) => (
                      <tr key={f.key} className="border border-black">
                        <td className="w-[38%] border-r border-black px-2 py-1 align-middle">
                          {f.label}
                          {f.unit ? `（${f.unit}）` : ''}：
                        </td>
                        <td className="p-0">
                          <input
                            value={values[f.key] ?? ''}
                            onChange={(e) => setValue(f.key, e.target.value)}
                            placeholder={f.remark || ''}
                            className="w-full bg-transparent px-2 py-1 hover:bg-canvas focus:bg-canvas focus:outline-none"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

            <p className="mt-8 text-[13px]">客户确认（签字/盖章）：____________________　　日期：____________</p>
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="text-xs text-muted">
              参数值改动会保存到需求；导出前会自动保存，确保导出的就是预览所见
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>
                关闭
              </Button>
              <Button variant="secondary" size="sm" loading={saving} disabled={!dirty} onClick={saveEdits}>
                保存修改
              </Button>
              <Button variant="secondary" size="sm" loading={exporting === 'docx'} disabled={!!exporting} onClick={() => handleExport('docx')}>
                导出 Word
              </Button>
              <Button size="sm" loading={exporting === 'pdf'} disabled={!!exporting} onClick={() => handleExport('pdf')}>
                导出 PDF
              </Button>
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}
