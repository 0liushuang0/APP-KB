import { describe, it, expect } from 'vitest'
import { professionOfPart, resolveProfession, groupByProfession, moveItem, PROFESSIONS } from './profession'

describe('专业判定', () => {
  it('按名称关键词自动归类', () => {
    expect(professionOfPart('液压缸')).toBe('液压')
    expect(professionOfPart('接近开关')).toBe('仪表')
    expect(professionOfPart('工作辊')).toBe('机械')
    expect(professionOfPart('电气控制系统')).toBe('电气')
    expect(professionOfPart('不明物')).toBe('其他')
  })

  it('手动指定优先于自动判定（接近开关：仪表 → 电气）', () => {
    expect(professionOfPart('接近开关')).toBe('仪表')
    expect(resolveProfession({ part: '接近开关', profession: '电气' })).toBe('电气')
    expect(resolveProfession({ part: '接近开关', profession: '' })).toBe('仪表')
    expect(resolveProfession({ part: '接近开关' })).toBe('仪表')
  })

  it('非法手动值回退自动判定', () => {
    expect(resolveProfession({ part: '液压缸', profession: '不存在的组' as never })).toBe('液压')
  })
})

describe('专业分组', () => {
  it('组序固定、组内保持原顺序、空组不出现', () => {
    const rows = [
      { part: '电机', profession: '' },
      { part: '轴承', profession: '' },
      { part: '接近开关', profession: '电气' },
      { part: '液压缸', profession: '' },
    ]
    const groups = groupByProfession(rows)
    expect(groups.map((g) => g.profession)).toEqual(['机械', '液压', '电气'])
    // 机械组：轴承；液压组：液压缸；电气组：电机 + 手动归入的接近开关（保持数组序）
    expect(groups[0].items.map((r) => r.part)).toEqual(['轴承'])
    expect(groups[1].items.map((r) => r.part)).toEqual(['液压缸'])
    expect(groups[2].items.map((r) => r.part)).toEqual(['电机', '接近开关'])
  })

  it('PROFESSIONS 覆盖全部判定结果（自动判定的落点必在组序内）', () => {
    const samples = ['辊', '密封件', '电缆', '测张装置', '随便什么']
    for (const s of samples) {
      expect(PROFESSIONS).toContain(professionOfPart(s))
    }
  })
})

describe('拖拽排序 moveItem', () => {
  const arr = ['轴承', '联轴器', '刀片', '电机']

  it('向下拖：插到目标行位置', () => {
    expect(moveItem(arr, 0, 2)).toEqual(['联轴器', '刀片', '轴承', '电机'])
  })

  it('向上拖：插到目标行前', () => {
    expect(moveItem(arr, 3, 1)).toEqual(['轴承', '电机', '联轴器', '刀片'])
  })

  it('原位/越界不产生新数组语义', () => {
    expect(moveItem(arr, 1, 1)).toBe(arr)
    expect(moveItem(arr, -1, 0)).toBe(arr)
    expect(moveItem(arr, 0, 99)).toBe(arr)
  })
})
