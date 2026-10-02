import { useState, useEffect, useRef, useCallback } from 'react'
import { X, ZoomIn, ZoomOut, RotateCw, FileText, Image, FileCode, File, AlertCircle, Loader2, Download, Presentation, Maximize2, Minimize2, ChevronLeft, ChevronRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { previewUrl, officePreviewUrl, downloadFile, type FileKind } from '../api/files'
import { getPreviewTypeFromFileNameOrMime, formatFileSize, type PreviewType } from '../utils/filePreview'

/** 可在预览里连续翻阅的一条记录 */
export interface PreviewSibling {
  id: string
  fileName: string
  mimeType?: string
  fileSize?: number
}

interface FilePreviewProps {
  fileUrl?: string
  fileName: string
  mimeType?: string
  fileSize?: number
  isOpen: boolean
  onClose: () => void
  fileKind?: FileKind
  fileId?: string
  /**
   * 同一批可连续翻阅的文件（通常就是列表当前显示的这些）。
   *
   * 传了它才会出现「上一张 / 下一张」。一次上传十几张现场照片时，
   * 原来只能看一张关一张再点下一张，翻完一轮要点几十下。
   *
   * 组件按 fileId 在这个数组里定位，所以调用方不用额外维护"当前第几个"，
   * 沿用原有的单个 previewDoc 状态即可。
   */
  siblings?: PreviewSibling[]
  /** 翻页回调：把目标文件回传给调用方，由它更新自己的 previewDoc */
  onNavigate?: (item: PreviewSibling) => void
}

export default function FilePreview({
  fileUrl,
  fileName,
  mimeType,
  fileSize,
  isOpen,
  onClose,
  fileKind,
  fileId,
  siblings,
  onNavigate,
}: FilePreviewProps) {
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [textContent, setTextContent] = useState<string | null>(null)
  // Office 文件转 PDF 后的 blob URL（fetch 回来后由 iframe 加载）
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * 全屏预览。
   *
   * 优先用浏览器原生全屏（图纸、PPT 转出来的 PDF 靠这一屏才看得清，
   * 连浏览器地址栏一起让出来）；被策略挡下时退回"铺满窗口"的 CSS 放大，
   * 两种情况下按钮和退出逻辑都一样。
   */
  const panelRef = useRef<HTMLDivElement>(null)
  // 跟踪当前 blob URL（用 ref 而非 state 读，避免 cleanup 闭包拿到 stale 值导致不 revoke）。
  const blobUrlRef = useRef<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const expanded = isFullscreen || maximized

  const previewType = getPreviewTypeFromFileNameOrMime(fileName, mimeType)

  /*
   * 连续翻阅。
   *
   * 按 fileId 在 siblings 里定位当前位置 —— 这样调用方不必维护索引，
   * 保持原来"一个 previewDoc 状态"的写法就能用上。
   * 找不到（没传 siblings、或当前文件不在列表里）时不显示翻页。
   */
  const navList = siblings ?? []
  const navIndex = fileId ? navList.findIndex((s) => s.id === fileId) : -1
  const canNavigate = navIndex >= 0 && navList.length > 1
  const canPrev = canNavigate && navIndex > 0
  const canNext = canNavigate && navIndex < navList.length - 1

  const goTo = useCallback(
    (offset: number) => {
      if (navIndex < 0) return
      const target = navList[navIndex + offset]
      if (target) onNavigate?.(target)
    },
    // navList 每次渲染都是新数组引用，用长度 + 当前位置做依赖即可
     
    [navIndex, navList.length, onNavigate],
  )

  const typeIcons: Record<PreviewType, typeof FileText> = {
    image: Image,
    pdf: FileText,
    text: FileCode,
    markdown: FileText,
    office: Presentation,
    unsupported: File,
  }
  const TypeIcon = typeIcons[previewType] || File

  useEffect(() => {
    // 关闭：重置状态 + 释放 blob
    if (!isOpen) {
      setZoom(1)
      setRotation(0)
      setTextContent(null)
      setError(null)
      setLoading(false)
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
        setPdfBlobUrl(null)
      }
      return
    }

    // 切换文件时：①abort 上一轮还在跑的 fetch，避免慢的旧请求 resolve 后覆盖新文件内容；
    // ②cancelled 标志防止 abort 之外的晚到回调 setState；③cleanup 里 revoke 旧 blob。
    const controller = new AbortController()
    let cancelled = false

    if (previewType === 'text' || previewType === 'markdown') {
      const fetchText = async () => {
        setLoading(true)
        setError(null)
        try {
          let url = fileUrl
          if (fileKind && fileId) {
            url = previewUrl(fileKind, fileId)
          }
          if (!url) {
            if (!cancelled) setError('无法获取文件地址')
            return
          }
          const res = await fetch(url, { credentials: 'include', signal: controller.signal })
          if (!res.ok) throw new Error(res.status === 403 ? '无权查看该文件' : '加载失败')
          const text = await res.text()
          if (!cancelled) setTextContent(text)
        } catch (err: any) {
          if (!cancelled && err?.name !== 'AbortError') setError(err?.message || '加载失败')
        } finally {
          if (!cancelled) setLoading(false)
        }
      }
      fetchText()
    }

    // Office 文件：请求后端转 PDF，拿到 blob 后交给 iframe 渲染。
    // 用 fetch（而非直接 iframe src）是为了在 LibreOffice 未安装/转换失败时
    // 能给出明确提示，而不是让 iframe 显示空白。
    if (previewType === 'office') {
      const fetchPdf = async () => {
        setLoading(true)
        setError(null)
        try {
          if (!fileKind || !fileId) {
            if (!cancelled) setError('缺少文件定位信息，无法预览')
            return
          }
          const res = await fetch(officePreviewUrl(fileKind, fileId), {
            credentials: 'include',
            signal: controller.signal,
          })
          if (res.status === 403) throw new Error('无权查看该文件')
          if (!res.ok) {
            // 后端的提示比前端猜的准（未安装 / 转换超时 / 文件损坏各不相同）
            const detail = await res
              .json()
              .then((body) => (typeof body?.message === 'string' ? body.message : ''))
              .catch(() => '')
            throw new Error(detail || '文档转换失败，请下载后查看')
          }
          const blob = await res.blob()
          if (cancelled) return // 切走了，blob 直接丢弃，不创建 URL
          // 先 revoke 上一个 blob URL（翻页连续预览时累积泄漏的源头）
          if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
          const url = URL.createObjectURL(blob)
          blobUrlRef.current = url
          setPdfBlobUrl(url)
        } catch (err: any) {
          if (!cancelled && err?.name !== 'AbortError') setError(err?.message || '加载失败')
        } finally {
          if (!cancelled) setLoading(false)
        }
      }
      fetchPdf()
    }

    return () => {
      cancelled = true
      controller.abort()
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
        setPdfBlobUrl(null)
      }
    }
  }, [isOpen, previewType, fileUrl, fileKind, fileId])

  // 原生全屏可能被用户按 Esc / F11 退出，状态要跟着回来
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement === panelRef.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  // 关闭预览时把全屏一并退掉，否则页面会卡在全屏里
  useEffect(() => {
    if (isOpen) return
    setMaximized(false)
    if (document.fullscreenElement === panelRef.current) document.exitFullscreen().catch(() => {})
  }, [isOpen])

  const toggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      document.exitFullscreen().catch(() => {})
      return
    }
    if (maximized) {
      setMaximized(false)
      return
    }
    const el = panelRef.current
    const request = el?.requestFullscreen?.bind(el)
    // 没有原生全屏（iframe 沙箱、旧内核）就退回铺满窗口
    if (!request) return setMaximized(true)
    request().catch(() => setMaximized(true))
  }, [isFullscreen, maximized])

  /*
   * 换一张时把缩放和旋转归位。
   *
   * 不重置的话，上一张放大到 300% 转了 90 度，下一张会顶着这个状态出现 ——
   * 看起来像图裂了。原来只在关闭时重置，是因为那时根本翻不了页。
   */
  useEffect(() => {
    setZoom(1)
    setRotation(0)
    setError(null)
  }, [fileId, fileUrl])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      // 左右方向键翻页：看一批照片时手不用离开键盘
      if (e.key === 'ArrowLeft' && canPrev) {
        e.preventDefault()
        goTo(-1)
        return
      }
      if (e.key === 'ArrowRight' && canNext) {
        e.preventDefault()
        goTo(1)
        return
      }
      if (e.key !== 'Escape') return
      // 全屏态下 Esc 先退全屏，别把预览一起关了；
      // 原生全屏由浏览器自己响应 Esc，这里只处理 CSS 放大的情况
      if (maximized) {
        setMaximized(false)
        return
      }
      if (document.fullscreenElement) return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose, maximized, canPrev, canNext, goTo])

  if (!isOpen) return null

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-accent-500" />
          <span className="ml-3 text-muted">加载中…</span>
        </div>
      )
    }

    if (error) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <AlertCircle size={48} className="mx-auto text-danger-fg mb-3" />
            <p className="text-ink font-medium">加载失败</p>
            <p className="text-sm text-muted mt-1">{error}</p>
          </div>
        </div>
      )
    }

    switch (previewType) {
      case 'image': {
        let src = fileUrl
        if (fileKind && fileId) {
          src = previewUrl(fileKind, fileId)
        }
        if (!src) {
          return (
            <div className="flex-1 flex items-center justify-center">
              <AlertCircle size={48} className="mx-auto text-warning-fg mb-3" />
              <p className="text-muted">无法获取图片地址</p>
            </div>
          )
        }
        return (
          <div className="flex-1 flex items-center justify-center overflow-auto p-4">
            <img
              src={src}
              alt={fileName}
              className="max-w-full max-h-full object-contain transition-transform duration-200"
              style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
              crossOrigin="use-credentials"
              onError={() => setError('图片加载失败')}
            />
          </div>
        )
      }

      case 'pdf': {
        let src = fileUrl
        if (fileKind && fileId) {
          src = previewUrl(fileKind, fileId)
        }
        if (!src) {
          return (
            <div className="flex-1 flex items-center justify-center">
              <AlertCircle size={48} className="mx-auto text-warning-fg mb-3" />
              <p className="text-muted">无法获取 PDF 地址</p>
            </div>
          )
        }
        return (
          <div className="flex-1 overflow-hidden">
            <iframe
              src={src}
              title={fileName}
              className="w-full h-full border-0"
            />
          </div>
        )
      }

      case 'text':
        return (
          <div className="flex-1 overflow-auto p-4">
            <pre className="font-mono text-body-sm leading-relaxed whitespace-pre-wrap break-words bg-canvas rounded-lg p-4 border border-border">
              <code>{textContent || '（空文件）'}</code>
            </pre>
          </div>
        )

      case 'markdown':
        return (
          <div className="flex-1 overflow-auto p-4">
            <div className="markdown-body bg-surface rounded-lg p-4 border border-border max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{textContent || ''}</ReactMarkdown>
            </div>
          </div>
        )

      case 'office': {
        // LibreOffice 转 PDF 后的 blob（已处理失败态）
        if (pdfBlobUrl) {
          return (
            <div className="flex-1 overflow-hidden">
              <iframe src={pdfBlobUrl} title={fileName} className="w-full h-full border-0" />
            </div>
          )
        }
        // 未就绪时由 loading / error 状态渲染占位
        return null
      }

      default:
        return (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <AlertCircle size={48} className="mx-auto text-muted mb-3" />
              <p className="text-ink font-medium">不支持预览此文件类型</p>
              <p className="text-sm text-muted mt-1">{mimeType || '未知类型'} · 请下载后查看</p>
            </div>
          </div>
        )
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        className={`relative bg-surface shadow-pop flex flex-col overflow-hidden ${
          expanded
            ? 'w-screen h-[100dvh] max-w-none rounded-none'
            : 'w-[calc(100%-2rem)] h-[calc(100dvh-2rem)] sm:w-[90vw] sm:h-[90vh] max-w-6xl rounded-xl'
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-shrink-0">
          <TypeIcon size={18} className="text-accent-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="font-serif text-body font-medium text-ink truncate">{fileName}</h3>
            <div className="flex items-center gap-2 text-caption text-muted">
              {canNavigate && (
                <>
                  <span className="font-mono">
                    {navIndex + 1} / {navList.length}
                  </span>
                  <span className="text-border">·</span>
                </>
              )}
              {mimeType && <span>{mimeType}</span>}
              {fileSize != null && (
                <>
                  <span className="text-border">·</span>
                  <span>{formatFileSize(fileSize)}</span>
                </>
              )}
            </div>
          </div>

          {/* 翻页按钮：放在工具栏里，全屏态下也够得着 */}
          {canNavigate && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <button
                onClick={() => goTo(-1)}
                disabled={!canPrev}
                className="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-accent-600 hover:bg-canvas transition-colors disabled:opacity-30 disabled:hover:text-muted disabled:hover:bg-transparent"
                aria-label="上一个"
                title="上一个（←）"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                onClick={() => goTo(1)}
                disabled={!canNext}
                className="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-accent-600 hover:bg-canvas transition-colors disabled:opacity-30 disabled:hover:text-muted disabled:hover:bg-transparent"
                aria-label="下一个"
                title="下一个（→）"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          )}

          {/* Zoom controls for images */}
          {previewType === 'image' && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                className="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-ink hover:bg-canvas transition-colors"
                title="缩小"
              >
                <ZoomOut size={15} />
              </button>
              <span className="text-caption text-muted w-12 text-center font-mono">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                className="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-ink hover:bg-canvas transition-colors"
                title="放大"
              >
                <ZoomIn size={15} />
              </button>
              <button
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-ink hover:bg-canvas transition-colors"
                title="旋转"
              >
                <RotateCw size={15} />
              </button>
            </div>
          )}

          {/* 全屏：图纸和 PPT 转出的 PDF 在 90vh 的框里字太小，看不清参数 */}
          <button
            onClick={toggleFullscreen}
            className="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-accent-600 hover:bg-canvas transition-colors flex-shrink-0"
            aria-label={expanded ? '退出全屏' : '全屏预览'}
            title={expanded ? '退出全屏' : '全屏预览'}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>

          {/* 下载按钮：预览后可直接保存到本地（按 id 现算受保护地址） */}
          {fileKind && fileId && (
            <button
              onClick={() =>
                downloadFile(fileKind, fileId, fileName).catch(() => {
                  /* 全局拦截器已 toast */
                })
              }
              className="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-accent-600 hover:bg-canvas transition-colors flex-shrink-0"
              aria-label="下载"
              title="下载"
            >
              <Download size={16} />
            </button>
          )}

          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-ink hover:bg-canvas transition-colors flex-shrink-0"
            title={"关闭"}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        {renderContent()}

        {/*
          两侧大按钮：连着翻十几张照片时，鼠标不用每次回到顶部工具栏。
          悬浮在内容之上，但不盖住 iframe 的滚动条区域（只占左右各 48px）。
        */}
        {canPrev && (
          <button
            onClick={() => goTo(-1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-16 flex items-center justify-center rounded-lg bg-surface/85 backdrop-blur-sm border border-border text-ink-soft hover:text-accent-600 hover:bg-surface shadow-sm transition-colors"
            aria-label="上一个"
            title="上一个（←）"
          >
            <ChevronLeft size={22} />
          </button>
        )}
        {canNext && (
          <button
            onClick={() => goTo(1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-16 flex items-center justify-center rounded-lg bg-surface/85 backdrop-blur-sm border border-border text-ink-soft hover:text-accent-600 hover:bg-surface shadow-sm transition-colors"
            aria-label="下一个"
            title="下一个（→）"
          >
            <ChevronRight size={22} />
          </button>
        )}
      </div>
    </div>
  )
}
