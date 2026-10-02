import { AlertTriangle } from 'lucide-react'

export default function ErrorState({ message = '加载失败，请稍后重试', onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-ink-soft">
      <AlertTriangle size={40} className="mb-3 text-warning-fg" />
      <p className="text-sm mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-accent-50 text-accent-700 rounded-md text-sm hover:bg-accent-100"
        >
          重试
        </button>
      )}
    </div>
  )
}
