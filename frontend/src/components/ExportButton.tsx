import { useState } from 'react'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import { systemApi } from '../api/services'
import Button from './Button'

/**
 * 列表页「按当前筛选导出」按钮。
 *
 * 走 fetch + blob：认证在 httpOnly Cookie 里，普通 <a href> 也能带上，
 * 但失败时拿不到错误信息，所以统一 fetch 后本地触发下载。
 */
export default function ExportButton({
  type,
  keyword,
  status,
  label = '导出',
}: {
  type: string
  keyword?: string
  status?: string
  label?: string
}) {
  const [loading, setLoading] = useState(false)

  const handleClick = async () => {
    setLoading(true)
    try {
      const res = await fetch(systemApi.export({ type, keyword, status }), {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(res.status === 403 ? '无权导出' : '导出失败')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const date = new Date().toISOString().slice(0, 10)
      a.download = `aikb-${type}-${date}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('导出完成')
    } catch (e: any) {
      toast.error(e?.message || '导出失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={handleClick} loading={loading}>
      <Download size={13} className="mr-0.5" /> {label}
    </Button>
  )
}
