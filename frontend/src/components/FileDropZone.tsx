import { type ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { useFileDrop } from '../hooks/useFileDrop'

interface FileDropZoneProps {
  children: ReactNode
  accept?: string[]
  maxSize?: number
  onFilesDropped: (files: File[]) => void
}

export default function FileDropZone({
  children,
  accept,
  maxSize,
  onFilesDropped,
}: FileDropZoneProps) {
  const { isDragging, dragProps } = useFileDrop({ accept, maxSize, onFilesDropped })

  return (
    <div className="relative" {...dragProps}>
      {children}

      {isDragging && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-accent-400 bg-accent-50/80 backdrop-blur-sm">
          <Upload size={36} className="text-accent-500 mb-2" />
          <p className="text-sm font-medium text-accent-700">松手上传文件</p>
          <p className="text-xs text-accent-500 mt-1">
            {accept?.length ? `支持 ${accept.join(', ')}` : '拖放任意文件'}
          </p>
        </div>
      )}
    </div>
  )
}
