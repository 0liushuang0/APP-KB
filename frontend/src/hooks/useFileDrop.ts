import { useState, useCallback, useRef, type DragEvent } from 'react'

interface UseFileDropOptions {
  accept?: string[]
  maxSize?: number
  onFilesDropped: (files: File[]) => void
}

interface UseFileDropReturn {
  isDragging: boolean
  dragProps: {
    onDragEnter: (e: DragEvent) => void
    onDragOver: (e: DragEvent) => void
    onDragLeave: (e: DragEvent) => void
    onDrop: (e: DragEvent) => void
  }
}

export function useFileDrop({
  accept,
  maxSize,
  onFilesDropped,
}: UseFileDropOptions): UseFileDropReturn {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  const isAccepted = useCallback(
    (file: File) => {
      if (!accept || accept.length === 0) return true
      const name = file.name.toLowerCase()
      return accept.some((ext) => name.endsWith(ext.toLowerCase()))
    },
    [accept],
  )

  const filterFiles = useCallback(
    (fileList: FileList | File[]): File[] => {
      const files = Array.from(fileList)
      return files.filter((f) => {
        if (!isAccepted(f)) return false
        if (maxSize && f.size > maxSize) return false
        return true
      })
    },
    [isAccepted, maxSize],
  )

  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer?.items?.length) {
      setIsDragging(true)
    }
  }, [])

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      dragCounterRef.current = 0

      const files = filterFiles(e.dataTransfer.files)
      if (files.length > 0) {
        onFilesDropped(files)
      }
    },
    [filterFiles, onFilesDropped],
  )

  return {
    isDragging,
    dragProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
