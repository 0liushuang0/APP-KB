import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Upload, FileText, Download, Trash2, Loader2, Scan } from 'lucide-react'
import { documentApi } from '../api/services'
import { downloadFile } from '../api/files'
import FilePreview from './FilePreview'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  solutionId: string
  /** 文档分类，用于区分「技术协议」「方案图纸」等资料区 */
  category: string
  title: string
  hint?: string
}

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 方案资料区（技术协议 / 方案图纸）。
 *
 * 不新建协议表/图纸表，直接复用资料中心：上传即入 documents + 关联到方案
 * （linkRole=deliverable），按 category 区分不同资料区，天然获得版本、下载、检索能力。
 */
export default function SolutionAssetSection({ solutionId, category, title, hint }: Props) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [previewDoc, setPreviewDoc] = useState<{ id: string; fileName: string; mimeType?: string; fileSize?: number } | null>(null)
  // 待确认移除的资料（删除图标紧挨着预览/下载，误点一次就少一份资料）
  const [removing, setRemoving] = useState<{ linkId: string; name: string } | null>(null)

  const queryKey = ['solution-assets', solutionId]
  const { data: allFiles = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => documentApi.byEntity('solution', solutionId),
    enabled: !!solutionId,
  })
  // 同一方案下按分类切分：本区只展示属于自己 category 的文件
  const files = (allFiles as any[]).filter((f: any) => (f.category || f.document?.category) === category)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey })
    queryClient.invalidateQueries({ queryKey: ['documents'] })
  }

  const doUpload = async (list: FileList | null) => {
    if (!list?.length) return
    setUploading(true)
    let ok = 0
    for (const file of Array.from(list)) {
      try {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('title', file.name)
        fd.append('category', category)
        fd.append('visibility', 'public')
        const doc: any = await documentApi.upload(fd)
        await documentApi.createLink(doc.id, {
          entityType: 'solution',
          entityId: solutionId,
          linkRole: 'deliverable',
        })
        ok++
      } catch (e: any) {
        toast.error(e?.response?.data?.message || e?.message || `${file.name} 上传失败`)
      }
    }
    setUploading(false)
    if (ok > 0) {
      toast.success(`已上传 ${ok} 个文件`)
      invalidate()
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  const removeMutation = useMutation({
    mutationFn: (linkId: string) => documentApi.removeLink(linkId),
    onSuccess: () => {
      invalidate()
      setRemoving(null)
      toast.success('已移除')
    },
    onError: (e: any) => toast.error(e?.message || '移除失败'),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-ink">{title} ({files.length})</h4>
          {hint && <p className="text-caption text-muted mt-0.5">{hint}</p>}
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1 text-xs text-accent-600 hover:text-accent-700 shrink-0"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} 上传
        </button>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => doUpload(e.target.files)} />
      </div>
      {isLoading ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted">暂无{title}</p>
      ) : (
        <div className="space-y-1.5">
          {files.map((f: any) => (
            <div key={f.link?.id || f.id} className="flex items-center gap-2 bg-subtle px-3 py-2 rounded-md">
              <FileText size={15} className="text-accent-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink truncate" title={f.title || f.fileName}>{f.title || f.fileName}</div>
                <div className="text-caption text-muted">
                  {formatSize(f.fileSize)}
                  {f.createdAt ? ` · ${new Date(f.createdAt).toLocaleDateString('zh-CN')}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() =>
                    setPreviewDoc({
                      id: f.id,
                      fileName: f.fileName || f.title || 'preview',
                      mimeType: f.mimeType,
                      fileSize: f.fileSize,
                    })
                  }
                  className="text-muted hover:text-accent-600 p-1"
                  aria-label="预览"
                  title="预览"
                >
                  <Scan size={14} />
                </button>
                <button
                  onClick={() =>
                    downloadFile('documents', f.id, f.fileName || f.title || 'download').catch((e: any) =>
                      toast.error(e?.message || '下载失败'),
                    )
                  }
                  className="text-muted hover:text-accent-600 p-1"
                  aria-label="下载"
                  title="下载"
                >
                  <Download size={14} />
                </button>
                {f.link?.id && (
                  <button
                    onClick={() => setRemoving({ linkId: f.link.id, name: f.title || f.fileName || '该文件' })}
                    className="text-muted hover:text-danger-fg p-1"
                    aria-label="移除"
                    title="移除"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
         </div>
      )}

      {/* 移除前二次确认：只解除与方案的关联，文件仍在资料中心 */}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && removeMutation.mutate(removing.linkId)}
        title="确认移除"
        confirmText="移除"
        loading={removeMutation.isPending}
        message={<>确定从「{title}」中移除「{removing?.name}」吗？</>}
        detail="只解除与本方案的关联，文件本身仍保留在资料中心。"
      />

      <FilePreview
        isOpen={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        fileKind="documents"
        fileId={previewDoc?.id}
        fileName={previewDoc?.fileName || ''}
        mimeType={previewDoc?.mimeType}
        fileSize={previewDoc?.fileSize}
        // 本资料区内的文件可连着翻
        siblings={files as any}
        // 文件名的兜底要与上面点击预览时一致，否则翻过去标题会是空的
        onNavigate={(item: any) =>
          setPreviewDoc({
            id: item.id,
            fileName: item.fileName || item.title || 'preview',
            mimeType: item.mimeType,
            fileSize: item.fileSize,
          })
        }
      />
    </div>
  )
}
