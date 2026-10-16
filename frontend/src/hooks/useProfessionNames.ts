import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { systemConfigApi } from '../api/services'
import type { Profession } from '../utils/profession'

const CONFIG_KEY = 'profession_names'

/**
 * 专业组的自定义显示名（如"其他"→"附件类"）。
 * 键名（机械/液压/电气/仪表/其他）恒定，仅改显示；设备配套与备件管理共享。
 */
export function useProfessionNames() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['profession-names'],
    queryFn: async () => {
      try {
        const res: any = await systemConfigApi.get(CONFIG_KEY)
        const raw = typeof res === 'string' ? res : res?.value || res?.data?.value
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') return parsed as Record<string, string>
        }
      } catch {
        /* 未配置 */
      }
      return {}
    },
    staleTime: 5 * 60_000,
  })

  const rename = useCallback(
    async (key: Profession, display: string) => {
      const next = { ...(data || {}), [key]: display.trim() || key }
      try {
        await systemConfigApi.set({
          key: CONFIG_KEY,
          value: JSON.stringify(next),
          category: 'supplier',
          description: '专业组显示名（设备配套/备件管理共用）',
        })
        queryClient.invalidateQueries({ queryKey: ['profession-names'] })
        toast.success(display.trim() ? `「${key}」显示为「${display.trim()}」` : `「${key}」已恢复默认名`)
      } catch (e: any) {
        toast.error(e?.response?.data?.message || '保存失败')
      }
    },
    [data, queryClient],
  )

  /** 取显示名：未自定义时返回原键名（组标题统一加"类配件/备件"后缀由调用方处理） */
  const displayName = useCallback(
    (key: Profession) => (data?.[key] || key) as string,
    [data],
  )

  return { displayName, rename }
}
