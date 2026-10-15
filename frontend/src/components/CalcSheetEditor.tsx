import { useEffect, useRef, useState, useCallback } from 'react'
import { loadLuckysheet } from '../lib/loadLuckysheet'
import { toast } from 'sonner'
import { Upload, Download, Save, FileSpreadsheet } from 'lucide-react'
import { calcSheetApi } from '../api/services'
import type { CalcSheet } from '../types'
import Button from './Button'

interface CalcSheetEditorProps {
  /** 计算表ID，null表示新建 */
  sheetId?: string | null
  /** 初始数据（已有计算表时传入） */
  initialData?: CalcSheet | null
  /** 关联信息 */
  context?: {
    templateCode?: string
    relatedRequirementId?: string
    relatedProposalId?: string
    customerId?: string
  }
  /** 保存回调 */
  onSaved?: (sheet: CalcSheet) => void
}

/**
 * 计算表编辑器组件
 *
 * 使用Luckysheet实现Excel在线编辑，支持：
 * - 上传Excel文件
 * - 在线编辑单元格
 * - 实时公式计算
 * - 自动保存（防抖3秒）
 * - 导出为Excel
 */
export default function CalcSheetEditor({
  sheetId: _sheetId,
  initialData,
  context,
  onSaved,
}: CalcSheetEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [currentSheet, setCurrentSheet] = useState<CalcSheet | null>(initialData || null)
  const luckysheetRef = useRef<{ getAllSheets: () => unknown; destroy: () => void; create: (opts: unknown) => void } | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitializedRef = useRef(false)

  // 初始化Luckysheet
  useEffect(() => {
    if (!containerRef.current) return

    // 检查Luckysheet是否已加载
    const win = window as unknown as { luckysheet?: { create: (o: unknown) => void; destroy: () => void; getAllSheets: () => unknown } }

    const initLuckysheet = () => {
      // 准备数据
      let data: unknown[] = []
      if (currentSheet?.sheetData) {
        try {
          data = JSON.parse(currentSheet.sheetData)
        } catch (e) {
          console.error('Parse sheet data failed:', e)
          data = [{ name: 'Sheet1', celldata: [] }]
        }
      } else {
        data = [{ name: 'Sheet1', celldata: [] }]
      }

      // 确保data是数组
      if (!Array.isArray(data) || data.length === 0) {
        data = [{ name: 'Sheet1', celldata: [] }]
      }

      // 销毁已有的实例（销毁失败可忽略，继续重建即可）
      try {
        luckysheetRef.current?.destroy()
      } catch {
        /* 实例可能已销毁，忽略 */
      }

      // 创建Luckysheet实例
      const options = {
        container: containerRef.current,
        data: data,
        title: currentSheet?.name || '计算表',
        showinfobar: false,
        showtoolbar: true,
        showstatisticBar: true,
        enableAddRow: true,
        enableAddCol: true,
        allowEdit: true,
        allowCopy: true,
        allowUndo: true,
        allowDelete: true,
        showsheetbar: true,
        showrowHeader: true,
        showcolumnHeader: true,
        forceCalculation: true,
        hook: {
          updated: () => {
            handleAutoSave()
          },
        },
      }

      win.luckysheet!.create(options)
      luckysheetRef.current = win.luckysheet ?? null
      isInitializedRef.current = true
    }

    // 表格引擎按需加载（不再随每个页面下载 3.8MB），加载完再初始化
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    loadLuckysheet()
      .then(() => {
        if (!cancelled) timer = setTimeout(initLuckysheet, 50)
      })
      .catch(() => toast.error('表格组件加载失败，请检查网络后重试'))

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
      // 组件卸载时销毁 Luckysheet 实例。此前只清了 timer，全局实例（window.luckysheet
      // 的 DOM/事件）残留，多次进出页面会堆叠多个实例。重建时的 destroy 只在 currentSheet
      // 变化时触发，覆盖不到卸载场景。
      try {
        luckysheetRef.current?.destroy()
      } catch {
        /* 实例可能已销毁，忽略 */
      }
    }
  }, [currentSheet])

  // 自动保存处理（防抖3秒）
  const handleAutoSave = useCallback(() => {
    if (!currentSheet?.id || !luckysheetRef.current) return

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        const data = luckysheetRef.current?.getAllSheets()
        if (data) {
          await calcSheetApi.updateData(currentSheet.id, data)
        }
      } catch (err) {
        console.error('Auto save failed:', err)
      }
    }, 3000)
  }, [currentSheet?.id])

  // 上传Excel文件
  const handleUpload = async (file: File) => {
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (context?.templateCode) formData.append('templateCode', context.templateCode)
      if (context?.relatedRequirementId) formData.append('relatedRequirementId', context.relatedRequirementId)
      if (context?.relatedProposalId) formData.append('relatedProposalId', context.relatedProposalId)
      if (context?.customerId) formData.append('customerId', context.customerId)

      const result = await calcSheetApi.upload(formData)

      // 更新当前sheet数据，触发重新渲染
      setCurrentSheet(result)
      toast.success('上传成功')
      onSaved?.(result)
    } catch (err: unknown) {
      console.error('Upload failed:', err)
      const e = err as { response?: { data?: { message?: string } } }
      toast.error(e?.response?.data?.message || '上传失败')
    } finally {
      setLoading(false)
    }
  }

  // 手动保存
  const handleSave = async () => {
    if (!currentSheet?.id || !luckysheetRef.current) return

    setSaving(true)
    try {
      const data = luckysheetRef.current?.getAllSheets()
      if (data) {
        await calcSheetApi.updateData(currentSheet.id, data)
        toast.success('保存成功')
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // 导出为Excel
  const handleExport = async () => {
    if (!currentSheet?.id) return

    try {
      const data = luckysheetRef.current?.getAllSheets()
      if (!data) {
        toast.error('没有数据可导出')
        return
      }

      const blob = await calcSheetApi.export(currentSheet.id, data)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${currentSheet.name || 'calc-sheet'}-${Date.now()}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('导出成功')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || '导出失败')
    }
  }

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleUpload(file)
          }}
          className="hidden"
          id="calc-sheet-upload-input"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => document.getElementById('calc-sheet-upload-input')?.click()}
          loading={loading}
        >
          <Upload size={14} className="mr-1" /> 上传Excel
        </Button>

        {currentSheet?.id && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSave}
              loading={saving}
            >
              <Save size={14} className="mr-1" /> 保存
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExport}
            >
              <Download size={14} className="mr-1" /> 导出Excel
            </Button>
          </>
        )}

        {currentSheet?.id && (
          <span className="text-caption text-muted ml-auto">
            <FileSpreadsheet size={12} className="inline mr-1" />
            编辑后自动保存（3秒防抖）
          </span>
        )}
      </div>

      {/* Luckysheet容器 */}
      <div
        ref={containerRef}
        id="luckysheet-editor-container"
        className="border border-border rounded-lg overflow-hidden bg-surface"
        style={{ height: '600px' }}
      />

      {/* 提示信息 */}
      {!currentSheet && !loading && (
        <div className="text-center py-8 text-muted">
          <FileSpreadsheet size={48} className="mx-auto mb-3 opacity-50" />
          <p className="text-body-sm">上传Excel文件开始编辑</p>
          <p className="text-caption mt-1">支持 .xlsx 和 .xls 格式，公式会自动计算</p>
        </div>
      )}
    </div>
  )
}
