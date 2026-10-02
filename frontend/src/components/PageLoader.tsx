import { Loader2 } from 'lucide-react'

interface PageLoaderProps {
  text?: string
}

export default function PageLoader({ text = '加载中...' }: PageLoaderProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted">
      <Loader2 size={28} className="animate-spin mb-3" />
      <span className="text-sm">{text}</span>
    </div>
  )
}
