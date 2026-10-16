import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { systemConfigApi } from '../api/services'
import { DEFAULT_PROFESSIONS, normalizeProfessions, type ProfessionDef } from '../utils/profession'
import { readConfigJson } from './useSupplyData'

const LIST_KEY = 'profession_list'
/** 旧配置：只能改显示名时存的 {键: 显示名}，首次读取时并入清单 */
const LEGACY_NAMES_KEY = 'profession_names'
export const QK_PROFESSIONS = ['profession-list'] as const

/**
 * 专业分类清单（设备配套 / 备件管理共用，可增删改、调顺序、改自动归类关键词）。
 * 没配过清单时 = 内置五类 + 旧的自定义显示名（如「其他」显示为「整机」）。
 */
export function useProfessions() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: QK_PROFESSIONS,
    queryFn: async () => {
      const list = await readConfigJson<ProfessionDef[]>(LIST_KEY)
      if (Array.isArray(list) && list.length) {
        const n = normalizeProfessions(list.map((d) => ({ key: String(d.key || d.name || ''), name: String(d.name || d.key || ''), keywords: Array.isArray(d.keywords) ? d.keywords : [] })))
        if (n.ok) return n.defs
      }
      const legacy = (await readConfigJson<Record<string, string>>(LEGACY_NAMES_KEY)) || {}
      return DEFAULT_PROFESSIONS.map((d) => ({ ...d, name: (legacy[d.key] || '').trim() || d.name }))
    },
    staleTime: 5 * 60_000,
  })
  const defs = data || DEFAULT_PROFESSIONS

  const save = useCallback(
    async (next: ProfessionDef[], message = '分类已保存') => {
      const n = normalizeProfessions(next)
      if (!n.ok) {
        toast.error(n.error)
        return false
      }
      try {
        await systemConfigApi.set({
          key: LIST_KEY,
          value: JSON.stringify(n.defs),
          category: 'supplier',
          description: '专业分类清单（设备配套/备件管理共用：键、显示名、自动归类关键词）',
        })
        queryClient.setQueryData(QK_PROFESSIONS, n.defs)
        queryClient.invalidateQueries({ queryKey: QK_PROFESSIONS })
        toast.success(message)
        return true
      } catch (e: any) {
        toast.error(e?.response?.data?.message || '保存失败')
        return false
      }
    },
    [queryClient],
  )

  /** 只改某一类的显示名（组标题上的铅笔） */
  const rename = useCallback(
    (key: string, name: string) => {
      const v = name.trim()
      const cur = defs.find((d) => d.key === key)
      if (!cur || !v || v === cur.name) return Promise.resolve(false)
      return save(defs.map((d) => (d.key === key ? { ...d, name: v } : d)), `「${cur.name}」已改名为「${v}」`)
    },
    [defs, save],
  )

  const displayName = useCallback((key: string) => defs.find((d) => d.key === key)?.name || key, [defs])

  return { defs, displayName, save, rename }
}
