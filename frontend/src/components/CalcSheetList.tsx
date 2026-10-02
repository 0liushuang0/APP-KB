import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FileSpreadsheet, Trash2, Edit, Plus, Download } from 'lucide-react'
import { calcSheetApi } from '../api/services'
import type { CalcSheet } from '../types'
import Button from './Button'
import Drawer from './Drawer'
import EmptyState from './EmptyState'
import CalcSheetEditor from './CalcSheetEditor'
import ConfirmDialog from './ConfirmDialog'

interface CalcSheetListProps {
  /** 筛选条件 */
  filters?: {
    templateCode?: string
    relatedRequirementId?: string
    relatedProposalId?: string
    customerId?: string
  }
  /** 是否允许上传/新建 */
  allowUpload?: boolean
  /** 关联信息（上传/新建时使用） */
  context?: {
    templateCode?: string
    relatedRequirementId?: string
    relatedProposalId?: string
    customerId?: string
  }
}

/**
 * 计算表列表组件
 *
 * 显示计算表列表，支持：
 * - 列表展示（名称、文件名、创建时间、版本）
 * - 新建计算表
 * - 编辑计算表（打开抽屉编辑器）
 * - 删除计算表
 * - 下载原始Excel文件
 */
export default function CalcSheetList({
  filters,
  allowUpload = true,
  context,
}: CalcSheetListProps) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingSheet, setEditingSheet] = useState<CalcSheet | null>(null)
  // 待确认删除的计算表（原来用浏览器原生 confirm，样式与全站不一致且容易被误关）
  const [deleting, setDeleting] = useState<CalcSheet | null>(null)

  const sheetsQuery = useQuery({
    queryKey: ['calc-sheets', filters],
    queryFn: () => calcSheetApi.list(filters),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => calcSheetApi.remove(id),
    onSuccess: () => {
      toast.success('已删除')
      setDeleting(null)
      sheetsQuery.refetch()
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || '删除失败')
    },
  })

  const sheets = sheetsQuery.data || []

  // 打开编辑器
  const openEditor = (sheet?: CalcSheet) => {
    setEditingSheet(sheet || null)
    setEditorOpen(true)
  }

  // 关闭编辑器
  const closeEditor = () => {
    setEditorOpen(false)
    setEditingSheet(null)
  }

  // 保存回调
  const handleSaved = () => {
    sheetsQuery.refetch()
    closeEditor()
  }

  // 下载文件
  const handleDownload = (sheet: CalcSheet) => {
    const url = calcSheetApi.download(sheet.id)
    window.open(url, '_blank')
  }

  return (
    <div>
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-body-sm font-semibold text-ink">
          计算表（{sheets.length}）
        </h4>
        {allowUpload && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openEditor()}
          >
            <Plus size={14} className="mr-1" /> 新建计算表
          </Button>
        )}
      </div>

      {/* 列表内容 */}
      {sheetsQuery.isLoading ? (
        <div className="text-center py-8 text-muted">加载中...</div>
      ) : sheets.length === 0 ? (
        <EmptyState
          bare
          icon={FileSpreadsheet}
          title="暂无计算表"
          description={allowUpload ? '上传Excel文件或新建计算表' : '暂无关联的计算表'}
        />
      ) : (
        <div className="space-y-1.5">
          {sheets.map((sheet) => (
            <div
              key={sheet.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-subtle hover:bg-canvas transition-colors"
            >
              <FileSpreadsheet size={16} className="text-accent-500 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-body-sm text-ink font-medium truncate">
                  {sheet.name}
                </div>
                <div className="text-caption text-muted flex items-center gap-2 flex-wrap">
                  <span>{sheet.fileName}</span>
                  <span>·</span>
                  <span className="font-mono">
                    {new Date(sheet.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                  {sheet.version > 1 && (
                    <>
                      <span>·</span>
                      <span className="font-mono">v{sheet.version}</span>
                    </>
                  )}
                  {sheet.createdByName && (
                    <>
                      <span>·</span>
                      <span>{sheet.createdByName}</span>
                    </>
                  )}
                  {sheet.description && (
                    <span className="text-muted truncate max-w-[200px]" title={sheet.description}>
                      · {sheet.description}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => handleDownload(sheet)}
                  className="p-1.5 rounded text-muted hover:text-accent-600 hover:bg-accent-50 transition-colors"
                  title="下载原始Excel"
                >
                  <Download size={14} />
                </button>
                <button
                  onClick={() => openEditor(sheet)}
                  className="p-1.5 rounded text-muted hover:text-accent-600 hover:bg-accent-50 transition-colors"
                  title="编辑"
                >
                  <Edit size={14} />
                </button>
                <button
                  onClick={() => setDeleting(sheet)}
                  className="p-1.5 rounded text-muted hover:text-danger-fg hover:bg-danger-bg transition-colors"
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && removeMutation.mutate(deleting.id)}
        loading={removeMutation.isPending}
        message={<>确定删除计算表「{deleting?.name}」吗？</>}
        detail="删除后无法恢复，表内已填写的数据和计算结果会一并丢失。"
      />

      {/* 编辑器抽屉 */}
      <Drawer
        open={editorOpen}
        onClose={closeEditor}
        title={editingSheet ? `编辑计算表 - ${editingSheet.name}` : '新建计算表'}
        width="w-[90vw] max-w-[1200px]"
      >
        <CalcSheetEditor
          sheetId={editingSheet?.id}
          initialData={editingSheet}
          context={context}
          onSaved={handleSaved}
        />
      </Drawer>
    </div>
  )
}
