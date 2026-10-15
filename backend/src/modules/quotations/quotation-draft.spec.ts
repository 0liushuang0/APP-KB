import { bigramScore, draftItems } from './quotation-draft';

// 与线上产品库同构的一小份样本（名称/分类取自实际产品目录）
const products = [
  { id: 'p1', name: '单塔圆盘剪', category: '装备/剪切设备/圆盘剪' },
  { id: 'p2', name: '双塔圆盘剪', category: '装备/剪切设备/圆盘剪' },
  { id: 'p3', name: '单塔碎边剪', category: '装备/剪切设备/碎边剪' },
  { id: 'p4', name: '双塔碎边剪', category: '装备/剪切设备/碎边剪' },
  { id: 'p5', name: '两弯两矫拉矫机', category: '装备/矫直设备/常规拉弯矫', priceList: [{ model: '1450', salePrice: 1800000 }, { model: '950', salePrice: 1200000 }] },
  { id: 'p6', name: '两弯一矫拉矫机', category: '装备/矫直设备/常规拉弯矫' },
  { id: 'p7', name: '化涂机', category: '装备/辊涂设备', price: 650000 },
];

describe('quotation draft from proposal', () => {
  it('splits a combined product type on "+" and picks the product named in the title', () => {
    const items = draftItems({ category: '装备/剪切设备/圆盘剪+碎边剪', text: 'PL-单塔圆盘剪+碎边剪' }, products);
    expect(items[0]).toMatchObject({ productId: 'p1', name: '单塔圆盘剪' });
    expect(items[0].reason).toContain('名称匹配度');
    // 标题里的「单塔」同样决定了碎边剪：单塔碎边剪 75% > 双塔碎边剪 50%
    expect(items[1]).toMatchObject({ productId: 'p3', name: '单塔碎边剪' });
  });

  it('leaves the line for a person when same-category products score equally', () => {
    const items = draftItems({ category: '装备/剪切设备/碎边剪', text: '分条线-碎边剪项目' }, products);
    expect(items[0].productId).toBeUndefined();
    expect(items[0].candidates?.sort()).toEqual(['单塔碎边剪', '双塔碎边剪']);
    expect(items[0].reason).toContain('请选定');
  });

  it('chooses 两弯两矫 over 两弯一矫 and prices the 1450 model from the price list', () => {
    expect(bigramScore('两弯两矫拉矫机', 'CGL-两弯两矫1450湿式拉矫机')).toBeCloseTo(5 / 6);
    const items = draftItems({ category: '装备/矫直设备/常规拉弯矫', text: 'CGL-两弯两矫1450湿式拉矫机' }, products);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ productId: 'p5', specification: '1450', unitPrice: 1800000, priceMissing: false });
  });

  it('falls back to name matching across the library when the category has no products', () => {
    const items = draftItems({ category: '装备/辊涂设备/化涂机', text: 'CGL-化涂机' }, products);
    expect(items[0]).toMatchObject({ productId: 'p7', unitPrice: 650000 });
  });

  it('marks lines without any price so the user knows to fill them', () => {
    const items = draftItems({ category: '装备/剪切设备/圆盘剪', text: '双塔圆盘剪项目' }, products);
    expect(items[0]).toMatchObject({ productId: 'p2', unitPrice: 0, priceMissing: true });
  });

  it('returns nothing rather than guessing when nothing matches well', () => {
    expect(draftItems({ category: '', text: '开收卷卷筒' }, products)).toEqual([]);
  });
});
