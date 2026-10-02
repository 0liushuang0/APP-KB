import { useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Upload, FileSpreadsheet } from 'lucide-react'
import { systemApi } from '../api/services'
import Button from './Button'

export default function ImportButton({ type, queryKey, label = '导入', size = 'md', className = '' }: { type: string; queryKey: string; label?: string; size?: 'sm' | 'md'; className?: string }) {
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  const handleFileChange = () => {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setLoading(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('type', type)
    systemApi.import(formData).then((res: any) => {
      toast.success(`导入完成：${res.imported}/${res.total} 条记录`)
      if (res.errors?.length) {
        toast.warning(`${res.errors.length} 行导入失败`)
      }
      queryClient.invalidateQueries({ queryKey: [queryKey] })
      if (fileRef.current) fileRef.current.value = ''
    }).catch((err: any) => {
      toast.error(err?.response?.data?.message || '导入失败')
    }).finally(() => setLoading(false))
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleFileChange} />
      <Button variant="secondary" size={size} className={className} onClick={() => fileRef.current?.click()} loading={loading}>
        {loading ? <FileSpreadsheet size={16} className="mr-1" /> : <Upload size={16} className="mr-1" />} {label}
      </Button>
    </>
  )
}
