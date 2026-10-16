import { describe, it, expect } from 'vitest'
import { categoryOfPart, rankCandidates, suppliersUsedForPart, whereUsed, type StoredBom } from './useSupplyData'

const eq: StoredBom = {
  圆盘剪: [
    { part: '减速机', suppliers: ['国茂', '杰牌'] },
    { part: '轴承', suppliers: ['SKF'] },
    '机架（焊接件）',
  ],
  拉矫机: [
    { part: '减速机', suppliers: ['国茂'] },
    { part: '液压缸', supplierName: '力士乐' },
  ],
}
const spare: StoredBom = { 圆盘剪: [{ part: '轴承', suppliers: ['NSK'], spareType: '2年期备件' }] }

describe('供应管理联动', () => {
  it('在哪用到：两份清单都扫，兼容旧的单值 supplierName', () => {
    expect(whereUsed('国茂', eq, spare)).toEqual([
      { source: '设备配套', equipment: '圆盘剪', part: '减速机' },
      { source: '设备配套', equipment: '拉矫机', part: '减速机' },
    ])
    expect(whereUsed('力士乐', eq, spare)).toHaveLength(1)
    expect(whereUsed('NSK', eq, spare)).toEqual([{ source: '备件管理', equipment: '圆盘剪', part: '轴承' }])
    expect(whereUsed('无此厂', eq, spare)).toEqual([])
  })

  it('同名配件用过的厂家按次数排序', () => {
    expect(suppliersUsedForPart('减速机', eq, spare)).toEqual(['国茂', '杰牌'])
    expect(suppliersUsedForPart(' 轴承 ', eq, spare).sort()).toEqual(['NSK', 'SKF'])
    expect(suppliersUsedForPart('', eq, spare)).toEqual([])
  })

  it('候选：用过的在前，其次同品类；名册外的名字不进候选', () => {
    const pool = [
      { id: '1', name: '泰隆', productCategories: ['减速机'] },
      { id: '2', name: '国茂', productCategories: ['减速机'] },
      { id: '3', name: '西门子', productCategories: ['电机'] },
    ]
    const r = rankCandidates('减速机', pool, eq, spare)
    expect(r.cat).toBe('减速机')
    expect(r.usedCount).toBe(1) // 杰牌不在名册
    expect(r.list.map((s) => s.name)).toEqual(['国茂', '泰隆'])
    // 品类没匹配上 → 全量
    expect(rankCandidates('导轨', pool).list).toHaveLength(3)
  })

  it('配件品类：后加的品类有规则，配件名就是品类名时直接命中', () => {
    expect(categoryOfPart('胶辊')).toBe('胶辊')
    expect(categoryOfPart('工作辊')).toBe('辊类件')
    expect(categoryOfPart('机架（焊接件）')).toBe('焊结构件')
    expect(categoryOfPart('测张装置')).toBe('仪表')
    expect(categoryOfPart('冷却塔', ['冷却塔', '其他'])).toBe('冷却塔')
  })
})
