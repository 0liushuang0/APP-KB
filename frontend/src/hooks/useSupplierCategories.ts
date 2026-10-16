import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { systemConfigApi } from '../api/services'

const CONFIG_KEY = 'supplier_categories'

/** 出厂自带的一套：零部件大类 + 整机/设备类（按博亚产品线，筛"某类设备的常用供应商"用） */
const DEFAULTS = [
  // 整机/设备类（需求：筛"拉弯矫直机"→该设备全部供应商显示）
  '拉弯矫直机', '圆盘剪', '碎边剪', '开卷机', '卷取机', '联轴器',
  '液压缸', '升降机', '减速机', '电机', '刀片', '辊类件',
  // 零部件/工艺大类
  '液压', '气动', '电气', '机械传动', '仪表', '轴承',
  '密封', '铸锻件', '标准件', '表面处理', '钢材', '其他',
]

/**
 * 供应商产品类别。
 *
 * 原来这 12 个值写死在 types 里，改不了也加不了 —— 而外购件清单导进来之后
 * 有 126 家落在「其他」，说明这套分类根本盖不住实际业务（焊接、涂装、
 * 检测仪器、备件…都没有对应项）。
 *
 * 改成存 system_configs，界面上可增删。默认值仍然内置，
 * 新装的机器不用先去配一遍才能用。
 */
export function useSupplierCategories() {
  const [categories, setCategories] = useState<string[]>(DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const res: any = await systemConfigApi.get(CONFIG_KEY)
      const raw = typeof res === 'string' ? res : res?.value || res?.data?.value
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr) && arr.length) setCategories(arr)
      }
    } catch {
      /* 没配过就用默认值 */
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const persist = async (next: string[]) => {
    setCategories(next)
    try {
      await systemConfigApi.set({
        key: CONFIG_KEY,
        value: JSON.stringify(next),
        category: 'supplier',
        description: '供应商产品类别（可增删）',
      })
    } catch {
      toast.error('保存分类失败')
      load() // 回滚到服务端的版本，避免界面和库里不一致
    }
  }

  const addCategory = async (name: string) => {
    const v = name.trim()
    if (!v) return
    if (categories.includes(v)) {
      toast.error(`「${v}」已存在`)
      return
    }
    await persist([...categories, v])
    toast.success(`已添加「${v}」`)
  }

  /**
   * 删除一个类别。
   * 不去动已经挂着这个类别的供应商 —— 那是历史事实，
   * 悄悄改掉别人的数据比留一个用不到的标签危险得多。
   */
  const removeCategory = async (name: string) => {
    await persist(categories.filter((c) => c !== name))
    toast.success(`已删除「${name}」，已有供应商的该标签保持不变`)
  }

  const resetCategories = async () => {
    await persist(DEFAULTS)
    toast.success('已恢复默认分类')
  }

  return {
    categories,
    options: categories.map((c) => ({ value: c, label: c })),
    loaded,
    addCategory,
    removeCategory,
    resetCategories,
    isDefault: JSON.stringify(categories) === JSON.stringify(DEFAULTS),
  }
}
