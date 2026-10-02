import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Upload, FileText, Trash2, Download, ArrowDownToLine, ArrowUpFromLine, Scan } from 'lucide-react'
import { documentApi } from '../api/services'
import { downloadFile } from '../api/files'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import FilePreview from './FilePreview'
import type { LinkEntityType } from '../types'

interface Props {
  entityType: LinkEntityType
  entityId?: string
  entityNo?: string
  customerId?: string
  category?: string
  /** 文档阶段：项目编辑时按当前 dealStage 自动归类（如 requirement/solution/quotation/contract） */
  stage?: string
}

/**
 * 通用文件上传组件。
 *
 * 流程：选择文件 → 弹窗确认"客户给你的 / 提交给客户的" → 按选择自动归类上传。
 * 上传的文件进入资料中心 + 关联到业务对象 + 同步进客户资料。
 * 已上传文件按"客户给你的"/"提交给客户的"分组展示。
 */
export default function EntityFileUpload({ entityType, entityId, entityNo, customerId, category = '业务资料', stage }: Props) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  // 待确认的文件列表（选好文件后先暂存，弹窗确认角色再上传）
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null)
  // 预览中的文件
  const [previewDoc, setPreviewDoc] = useState<{ id: string; fileName: string; mimeType?: string; fileSize?: number } | null>(null)
  // 待确认移除的关联（列表里的删除图标挨着预览/下载，误点代价不小）
  const [unlinking, setUnlinking] = useState<{ linkId: string; name: string } | null>(null)

  const queryKey = ['entity-docs', entityType, entityId]

  const { data: files = [] } = useQuery({
    queryKey,
    queryFn: () => (entityId ? documentApi.byEntity(entityType, entityId) : []),
    enabled: !!entityId,
  })

  const errMsg = (err: any) => err?.response?.data?.message || err?.message || '未知错误'

  const uploadMutation = useMutation({
    mutationFn: async ({ file, role }: { file: File; role: 'source' | 'deliverable' }) => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', `${entityNo || entityType} - ${file.name}`)
      fd.append('category', category)
      fd.append('visibility', 'public')
      // 上传与关联分两步，好把"文件已传但关联失败"单独标出来
      let doc: any
      try {
        doc = await documentApi.upload(fd)
      } catch (e) {
        throw { name: file.name, stage: 'upload', msg: errMsg(e) }
      }
      try {
        await documentApi.createLink(doc.id, {
          entityType,
          entityId: entityId!,
          linkRole: role,
          customerId: customerId || undefined,
          stage: stage || undefined,
          description: role === 'source' ? '客户提交的输入资料' : '我方提交的输出资料',
        })
      } catch (e) {
        throw { name: file.name, stage: 'link', msg: errMsg(e) }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
    onError: (e: any) => {
      // mutationFn 抛的是 {name, stage, msg}（普通对象，非 Error），读 e.message 恒为
      // undefined，永远只显示"上传失败"。这里读 msg，并把"哪一步失败"也带出来：
      // stage='upload' = 上传就失败；stage='link' = 文件已传但关联业务对象失败。
      const stageLabel = e?.stage === 'link' ? '已上传但关联失败' : '上传失败'
      toast.error(e?.msg ? `${e?.name ? `${e.name}：` : ''}${stageLabel}：${e.msg}` : '上传失败')
    },
  })

  const unlinkMutation = useMutation({
    mutationFn: (linkId: string) => documentApi.removeLink(linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      setUnlinking(null)
      toast.success('已移除')
    },
    onError: (e: any) => toast.error(errMsg(e) || '移除失败'),
  })

  // 选好文件后，先弹窗让用户确认角色（含同名检查）
  const onFilesSelected = (fileList: FileList | null) => {
    if (!fileList || !fileList.length) return
    const arr = Array.from(fileList)
    // 同名检查：已有文件列表中是否已有同名
    const existingNames = new Set((files as any[]).map((item: any) => {
      const doc = item.document || item
      return doc.fileName || doc.title || ''
    }))
    const accepted = arr.filter(f => !existingNames.has(f.name))
    const rejected = arr.filter(f => existingNames.has(f.name))
    if (rejected.length) {
      toast.warning(`已跳过 ${rejected.length} 个同名文件：${rejected.map(f => f.name).join('、')}（如需更新请先删除旧文件）`)
    }
    if (!accepted.length) return
    setPendingFiles(accepted)
    if (fileRef.current) fileRef.current.value = ''
  }

  // 确认角色后批量上传
  const confirmUpload = (role: 'source' | 'deliverable') => {
    if (!pendingFiles) return
    pendingFiles.forEach((f) => uploadMutation.mutate({ file: f, role }))
    setPendingFiles(null)
  }

  // 未保存时显示占位
  if (!entityId) {
    return (
      <div className="text-center py-6 text-sm text-muted bg-canvas rounded-lg border border-dashed border-border">
        保存后即可上传资料
      </div>
    )
  }

  const incomingFiles = (files as any[]).filter((item: any) => {
    const link = item.link || item
    return link.linkRole !== 'deliverable'
  })
  const outgoingFiles = (files as any[]).filter((item: any) => {
    const link = item.link || item
    return link.linkRole === 'deliverable'
  })

  const renderFileItem = (item: any) => {
    const link = item.link || item
    const doc = item.document || item
    const isOutgoing = link.linkRole === 'deliverable'
    return (
      <div key={link.id || doc.id} className="flex items-center gap-2 bg-canvas px-3 py-2 rounded-md">
        <FileText size={15} className={`shrink-0 ${isOutgoing ? 'text-success-fg' : 'text-info-fg'}`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-ink truncate flex items-center gap-1.5">
            <span className="truncate">{doc.title || doc.fileName}</span>
            {/* 同名文件的修订版：客户重复发来时标 v2/v3，物理文件仍各自独立保留 */}
            {link.version > 1 && (
              <span className="text-[10px] text-warning-fg bg-warning-bg border border-warning-line px-1 py-0.5 rounded shrink-0">
                v{link.version}
              </span>
            )}
          </div>
          <div className="text-caption text-muted">
            {doc.fileSize ? `${(doc.fileSize / 1024).toFixed(0)}KB · ` : ''}
            {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString('zh-CN') : ''}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() =>
              setPreviewDoc({
                id: doc.id,
                fileName: doc.fileName || doc.title || 'preview',
                mimeType: doc.mimeType,
                fileSize: doc.fileSize,
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
              downloadFile('documents', doc.id, doc.fileName || doc.title || 'download').catch((e: any) =>
                toast.error(e?.message || '下载失败'),
              )
            }
            className="text-muted hover:text-accent-600 p-1"
            aria-label="下载"
            title="下载"
          >
            <Download size={14} />
          </button>
          {link.id && (
            <button
              onClick={() =>
                setUnlinking({ linkId: link.id, name: doc.title || doc.fileName || '该文件' })
              }
              className="text-muted hover:text-danger-fg p-1"
              aria-label="移除"
              title="移除"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* 上传按钮 */}
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault() }}
        onDrop={(e) => { e.preventDefault(); onFilesSelected(e.dataTransfer.files) }}
        className="cursor-pointer border-2 border-dashed border-border rounded-lg py-5 text-center hover:border-accent-300 hover:bg-accent-50/30 transition-colors"
      >
        <Upload size={20} className="text-muted mx-auto mb-1.5" />
        <p className="text-sm text-muted">点击或拖拽文件到此处上传</p>
        <p className="text-caption text-muted mt-0.5">上传后将归入客户资料 · {category}</p>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => onFilesSelected(e.target.files)} />
      </div>

      {uploadMutation.isPending && (
        <p className="text-caption text-muted">上传中…</p>
      )}

      {/* 确认弹窗：这份文件是客户给你的还是提交给客户的？ */}
      <Modal
        open={!!pendingFiles}
        onClose={() => setPendingFiles(null)}
        title="请选择文件类型"
        size="sm"
      >
        <p className="text-sm text-muted mb-4">
          你正在上传 {pendingFiles?.length || 0} 个文件，请确认这些文件的来源：
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => confirmUpload('source')}
            className="border-2 border-info-line hover:border-info-fg hover:bg-info-bg/30 rounded-lg p-4 text-center transition-colors"
          >
            <div className="w-9 h-9 rounded-full bg-info-bg text-info-fg flex items-center justify-center mx-auto mb-2">
              <ArrowDownToLine size={18} />
            </div>
            <p className="text-sm font-medium text-ink">客户给你的</p>
            <p className="text-caption text-muted mt-0.5">客户提供的资料</p>
          </button>
          <button
            onClick={() => confirmUpload('deliverable')}
            className="border-2 border-success-line hover:border-success-fg hover:bg-success-bg/30 rounded-lg p-4 text-center transition-colors"
          >
            <div className="w-9 h-9 rounded-full bg-success-bg text-success-fg flex items-center justify-center mx-auto mb-2">
              <ArrowUpFromLine size={18} />
            </div>
            <p className="text-sm font-medium text-ink">提交给客户的</p>
            <p className="text-caption text-muted mt-0.5">我方产出的资料</p>
          </button>
        </div>
      </Modal>

      {/* 客户给你的文件（输入资料） */}
      {incomingFiles.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-info-fg">
            <ArrowDownToLine size={12} /> 客户给你的 · 输入资料 ({incomingFiles.length})
          </div>
          <div className="space-y-1.5">
            {incomingFiles.map(renderFileItem)}
          </div>
        </div>
      )}

      {/* 提交给客户的文件（输出资料） */}
      {outgoingFiles.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5 text-xs font-medium text-success-fg">
            <ArrowUpFromLine size={12} /> 提交给客户的 · 输出资料 ({outgoingFiles.length})
          </div>
          <div className="space-y-1.5">
            {outgoingFiles.map(renderFileItem)}
          </div>
        </div>
      )}

      {uploadMutation.isPending && (
        <p className="text-caption text-muted">上传中…</p>
      )}

      {/*
        移除关联的二次确认。
        「移除」只解除这条记录与文件的关联，文件本体仍在资料中心 ——
        文案要说清楚，否则用户会以为文件被删没了而不敢点。
      */}
      <ConfirmDialog
        open={!!unlinking}
        onClose={() => setUnlinking(null)}
        onConfirm={() => unlinking && unlinkMutation.mutate(unlinking.linkId)}
        title="确认移除"
        confirmText="移除"
        loading={unlinkMutation.isPending}
        message={<>确定从这条记录中移除「{unlinking?.name}」吗？</>}
        detail="只解除关联，文件本身仍保留在资料中心，可以重新关联回来。"
      />

      {/* 文件预览弹层 */}
      <FilePreview
        isOpen={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        fileKind="documents"
        fileId={previewDoc?.id}
        fileName={previewDoc?.fileName || ''}
        mimeType={previewDoc?.mimeType}
        fileSize={previewDoc?.fileSize}
        // 这条记录下挂的全部附件都能连着翻
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
