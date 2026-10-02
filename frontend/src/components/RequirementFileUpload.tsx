import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Upload, FileText, Loader2, Inbox } from 'lucide-react'
import { documentApi } from '../api/services'

interface Props {
  /** 需求 id；新建尚未保存时为空，此时不能上传 */
  requirementId?: string
  /** 需求编号，用作文件标题前缀 */
  requirementNo?: string
  customerId?: string
}

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 需求的输入资料上传。
 *
 * 客户往往分几次把资料给过来（先给招标文件，再补技术协议、图纸），
 * 所以这里是**累加**的：每次上传都追加一条，按上传时间倒序排列，不覆盖。
 *
 * 文件不进独立的附件表，而是走资料中心（documents）+ 关联表（document_links）：
 * 这样同一份资料在资料中心能被检索到，也能顺着链路从客户查到需求再查到方案。
 * 关联角色固定为 source（原始资料），也就是业务上说的「输入文件」。
 */
export default function RequirementFileUpload({ requirementId, requirementNo, customerId }: Props) {
  const queryClient = useQueryClient()
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  // 持久化的失败提示：区分"上传失败"和"文件已传但关联失败"，后者最容易被误以为"没反应"
  const [failures, setFailures] = useState<{ name: string; stage: 'upload' | 'link'; msg: string }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: files = [], isLoading } = useQuery({
    queryKey: ['requirement-docs', requirementId],
    queryFn: () => documentApi.byEntity('requirement', requirementId!),
    enabled: !!requirementId,
  })

  const errMsg = (err: any) => err?.response?.data?.message || err?.message || '未知错误'

  const doUpload = async (fileList: FileList | null) => {
    if (!fileList?.length || !requirementId) return
    setUploading(true)
    setFailures([])
    let ok = 0
    const fails: { name: string; stage: 'upload' | 'link'; msg: string }[] = []

    for (const file of Array.from(fileList)) {
      // 第一步：上传文件本身
      let doc: any
      try {
        const form = new FormData()
        form.append('file', file)
        // 标题带上需求编号，资料中心里一眼能看出这份资料属于哪一单
        form.append('title', requirementNo ? `${requirementNo} ${file.name}` : file.name)
        form.append('category', '需求资料')
        if (customerId) form.append('customerId', customerId)
        doc = await documentApi.upload(form)
      } catch (err: any) {
        fails.push({ name: file.name, stage: 'upload', msg: errMsg(err) })
        continue
      }

      // 第二步：建立到需求的关联（失败则文件成了"孤儿"，不会归入客户资料）
      try {
        await documentApi.createLink(doc.id, {
          entityType: 'requirement',
          entityId: requirementId,
          // source = 原始资料，即业务上说的「输入文件」
          linkRole: 'source',
          customerId: customerId || undefined,
          requirementId,
          description: '客户提供的需求输入资料',
        })
        ok++
      } catch (err: any) {
        fails.push({ name: file.name, stage: 'link', msg: errMsg(err) })
      }
    }

    setUploading(false)
    setFailures(fails)
    if (ok > 0) {
      toast.success(`已上传 ${ok} 个文件到资料中心`)
      queryClient.invalidateQueries({ queryKey: ['requirement-docs', requirementId] })
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  if (!requirementId) {
    return (
      <div className="border border-dashed border-border rounded-lg p-4 text-center text-sm text-muted">
        需求保存后即可上传资料
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          doUpload(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        className={`border border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors ${
          dragging ? 'border-accent-500 bg-accent-50' : 'border-border hover:border-accent-400 hover:bg-canvas'
        }`}
      >
        {uploading ? (
          <Loader2 size={22} className="mx-auto mb-2 text-accent-500 animate-spin" />
        ) : (
          <Upload size={22} className="mx-auto mb-2 text-muted" />
        )}
        <p className="text-sm text-ink">
          {uploading ? '正在上传…' : '把文件拖到这里，或点击选择'}
        </p>
        <p className="text-xs text-muted mt-1">
          可多次上传，累加保留；文件会同时进入资料中心，标记为「输入文件」
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => doUpload(e.target.files)}
        />
      </div>

      {/* 失败提示：持久显示，尤其"文件已传但关联失败"这种最容易被误判成"没反应"的情况 */}
      {failures.length > 0 && (
        <div className="border border-danger-line bg-danger-bg rounded-lg p-3 text-sm text-danger-fg space-y-1">
          {failures.map((f, i) => (
            <div key={i}>
              <span className="font-medium">{f.name}</span>：
              {f.stage === 'link' ? '文件已上传，但关联到需求失败（不会归入客户资料）' : '上传失败'}
              <span className="text-xs text-danger-fg/80"> —— {f.msg}</span>
            </div>
          ))}
          <p className="text-xs text-danger-fg/80 pt-1">
            请重试；若持续失败，多为后端未重启加载最新修复。
          </p>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="eo-label">已上传资料</span>
          <span className="text-xs text-muted">{files.length} 个</span>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted py-3 text-center">加载中…</p>
        ) : files.length === 0 ? (
          <div className="flex items-center gap-2 justify-center py-4 text-sm text-muted">
            <Inbox size={16} /> 尚未上传资料
          </div>
        ) : (
          <ul className="border border-border rounded-lg divide-y divide-border">
            {[...files]
              .sort((a: any, b: any) => (a.createdAt < b.createdAt ? 1 : -1))
              .map((f: any) => (
                <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                  <FileText size={15} className="text-accent-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink truncate flex items-center gap-1.5" title={f.title || f.fileName}>
                      <span className="truncate">{f.title || f.fileName}</span>
                      {/* 同名文件的修订版：客户重复发来时标 v2/v3，物理文件仍各自独立保留 */}
                      {f.link?.version > 1 && (
                        <span className="text-[10px] text-warning-fg bg-warning-bg border border-warning-line px-1 py-0.5 rounded shrink-0">
                          v{f.link.version}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {formatTime(f.createdAt)}
                      {f.fileSize ? ` · ${formatSize(f.fileSize)}` : ''}
                    </p>
                  </div>
                  <span className="text-[10px] text-accent-700 bg-accent-50 border border-accent-200 px-1.5 py-0.5 rounded shrink-0">
                    输入文件
                  </span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  )
}
