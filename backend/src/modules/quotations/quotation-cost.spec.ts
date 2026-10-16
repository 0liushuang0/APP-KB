import { estimateCost, marginRate, supplierReferencePrice } from './quotation-cost';

describe('报价成本估算（供应商价 → 报价成本）', () => {
  const rates = { CNY: 1, USD: 7, EUR: 8 };

  it('型号价格表有成本价时优先用它', () => {
    const r = estimateCost({
      priceList: [{ model: 'BJ125-1450', costPrice: 520000 }, { model: 'BJ125-1650', costPrice: 610000 }],
      model: 'BJ125-1650',
      suppliers: [{ id: 's1', productName: '圆盘剪', priceMin: 1, priceMax: 2 }],
    });
    expect(r).toMatchObject({ cost: 610000, source: 'price_list' });
    expect(r.label).toContain('BJ125-1650');
  });

  it('价格表只有一行时不需要型号也能取', () => {
    expect(estimateCost({ priceList: [{ model: 'X', costPrice: 100 }] }).cost).toBe(100);
  });

  it('没有成本价 → 映射的供应产品：有询价取最近询价，否则取区间中值；多家取最高', () => {
    const r = estimateCost({
      priceList: [{ model: 'X' }],
      suppliers: [
        { id: 'a', supplierName: '北京索普', productName: '油缸', priceMin: 3200, priceMax: 4800 },
        { id: 'b', supplierName: '派克', brand: '派克', productName: '油缸', priceMin: 8500, priceMax: 11000 },
        { id: 'c', supplierName: '太重榆次', productName: '油缸', latestQuote: { unitPrice: 5000 } },
      ],
      rates,
    });
    expect(r.source).toBe('supplier');
    expect(r.cost).toBe(9750); // 派克 (8500+11000)/2
    expect(r.supplierProductId).toBe('b');
    expect(r.label).toContain('映射了 3 家，取最高');
  });

  it('外币供应价按汇率折人民币', () => {
    expect(supplierReferencePrice({ id: 'x', productName: '轴承', priceMin: 100, priceMax: 100, currency: 'USD' }, rates))
      .toEqual({ price: 700, basis: '目录价区间中值' });
    expect(
      supplierReferencePrice({ id: 'x', productName: '轴承', currency: 'CNY', latestQuote: { unitPrice: 10, currency: 'EUR' } }, rates),
    ).toEqual({ price: 80, basis: '最近一次询价' });
  });

  it('BOM 每行都有成本才汇总，缺一行不给', () => {
    expect(estimateCost({ bom: [{ cost: 100, quantity: 2 }, { cost: 50, quantity: 1 }] })).toMatchObject({ cost: 250, source: 'bom' });
    expect(estimateCost({ bom: [{ cost: 100, quantity: 2 }, { cost: null, quantity: 1 }] }).cost).toBeNull();
  });

  it('都没有时成本留空', () => {
    expect(estimateCost({})).toEqual({ cost: null, source: null, label: '' });
  });

  it('毛利率', () => {
    expect(marginRate(100, 80)).toBe(20);
    expect(marginRate(0, 80)).toBeNull();
  });
});
