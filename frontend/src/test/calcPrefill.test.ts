import { describe, it, expect } from 'vitest'
import { prefillFromSpec, parseSpecParams } from '../utils/calcPrefill'
import type { CalcInputDef } from '../types'

const inputs: CalcInputDef[] = [
  { key: 'thickness', label: '来料厚度', type: 'number', unit: 'mm', min: 0.5, max: 25, required: true },
  { key: 'width', label: '来料宽度', type: 'number', unit: 'mm', min: 100, max: 2500, required: true },
  { key: 'yield_strength', label: '屈服强度', type: 'number', unit: 'MPa', min: 100, max: 1200 },
  {
    key: 'material',
    label: '材质',
    type: 'enum',
    options: [
      { value: 235, label: '碳钢' },
      { value: 205, label: '不锈钢' },
    ],
  },
]

/** 新版需求卡 */
const card = (fields: any[]) => JSON.stringify({ card: { fields } })

describe('parseSpecParams', () => {
  it('吃需求卡 fields', () => {
    const out = parseSpecParams(card([{ key: 'width', label: '带钢宽度', value: 1250, unit: 'mm' }]))
    expect(out).toEqual([{ key: 'width', label: '带钢宽度', value: '1250', unit: 'mm' }])
  })

  it('normalized 优先于 value', () => {
    const out = parseSpecParams(card([{ key: 'w', label: 'W', value: '约1250', normalized: 1250 }]))
    expect(out[0].value).toBe('1250')
  })

  it('吃旧版 params 结构', () => {
    const out = parseSpecParams(JSON.stringify({ params: [{ key: '厚度', value: 2.5, unit: 'mm' }] }))
    expect(out[0]).toMatchObject({ key: '厚度', value: '2.5' })
  })

  it('空值与坏 JSON 都返回空数组，不抛', () => {
    expect(parseSpecParams(undefined)).toEqual([])
    expect(parseSpecParams('{ 不是 json')).toEqual([])
    expect(parseSpecParams('{}')).toEqual([])
  })

  it('跳过没有值的字段', () => {
    const out = parseSpecParams(card([{ key: 'a', label: 'A', value: null }, { key: 'b', label: 'B', value: 3 }]))
    expect(out.map((p) => p.key)).toEqual(['b'])
  })
})

describe('prefillFromSpec', () => {
  it('按 key 精确匹配', () => {
    const { values } = prefillFromSpec(inputs, card([{ key: 'width', label: '随便', value: 1250 }]))
    expect(values.width).toBe('1250')
  })

  it('key 对不上时按 label 匹配', () => {
    const { values } = prefillFromSpec(inputs, card([{ key: 'x9', label: '来料厚度', value: 2.5 }]))
    expect(values.thickness).toBe('2.5')
  })

  it('叫法不同也能靠别名表对上', () => {
    // 需求里写「带钢厚度」，模板里叫「来料厚度」
    const { values, hits } = prefillFromSpec(inputs, card([{ key: 'x', label: '带钢厚度', value: 3 }]))
    expect(values.thickness).toBe('3')
    expect(hits[0].via).toBe('alias')
  })

  it('label 带单位括号也能对上', () => {
    const { values } = prefillFromSpec(inputs, card([{ key: 'x', label: '来料宽度（mm）', value: 1500 }]))
    expect(values.width).toBe('1500')
  })

  it('从「约 1250mm」这种文本里取出数字', () => {
    const { values } = prefillFromSpec(inputs, card([{ key: 'width', label: 'W', value: '约 1250mm' }]))
    expect(values.width).toBe('1250')
  })

  it('超出模板量程的值不填 —— 多半是单位不一致', () => {
    // 8 米按 mm 算超了上限 2500，宁可留空让人自己核
    const { values } = prefillFromSpec(inputs, card([{ key: 'width', label: 'W', value: 8000 }]))
    expect(values.width).toBeUndefined()
  })

  it('低于下限的同样不填', () => {
    const { values } = prefillFromSpec(inputs, card([{ key: 'thickness', label: 'T', value: 0.1 }]))
    expect(values.thickness).toBeUndefined()
  })

  it('已经填过的格子不覆盖', () => {
    const { values } = prefillFromSpec(inputs, card([{ key: 'width', label: 'W', value: 1250 }]), {
      width: '1500',
    })
    expect(values.width).toBeUndefined()
  })

  it('枚举按选项文本对，对不上就不填', () => {
    const hit = prefillFromSpec(inputs, card([{ key: 'material', label: '材质', value: '不锈钢' }]))
    expect(hit.values.material).toBe('205')

    const miss = prefillFromSpec(inputs, card([{ key: 'material', label: '材质', value: '钛合金' }]))
    expect(miss.values.material).toBeUndefined()
  })

  it('取不到数字的值不填', () => {
    const { values } = prefillFromSpec(inputs, card([{ key: 'width', label: 'W', value: '待定' }]))
    expect(values.width).toBeUndefined()
  })

  it('hits 说明每一项来自哪个需求参数', () => {
    const { hits } = prefillFromSpec(
      inputs,
      card([
        { key: 'width', label: '带钢宽度', value: 1250, unit: 'mm' },
        { key: 'thickness', label: '带钢厚度', value: 2.5, unit: 'mm' },
      ]),
    )
    expect(hits).toHaveLength(2)
    expect(hits.find((h) => h.inputKey === 'width')).toMatchObject({
      inputLabel: '来料宽度',
      fromLabel: '带钢宽度',
      value: '1250',
      via: 'key',
    })
  })

  it('没有 spec 时什么都不做', () => {
    expect(prefillFromSpec(inputs, undefined)).toEqual({ values: {}, hits: [] })
    expect(prefillFromSpec(inputs, '{}')).toEqual({ values: {}, hits: [] })
  })
})
