import { buildReport } from './product-completeness.service';

describe('buildReport', () => {
  const products = [
    { id: 'a', name: '球笼式联轴器', code: 'BJ125', description: '说明', unit: '台', priceList: [{ model: 'BJ125D-1450', price: 1 }], specs: [{ name: '扭矩', value: '8' }], supplierId: 's1' },
    { id: 'b', name: '十字轴万向联轴器', code: '', description: '', unit: '', priceList: [], specs: [], supplierId: null },
    { id: 'c', name: '辊盒', code: 'RB', description: '说明', unit: '套', priceList: [], specs: [{ name: 'x', value: 'y' }], supplierId: null },
  ];

  it('computes field fill rates and quote-ready count', () => {
    const r = buildReport(products as any, new Map([['a', 3]]));
    expect(r.total).toBe(3);
    expect(r.quoteReady).toBe(1); // 只有 a 同时有价格表和规格
    const rate = Object.fromEntries(r.fields.map((f) => [f.key, f.rate]));
    expect(rate.priceList).toBe(33);
    expect(rate.bom).toBe(33);
    expect(rate.supplier).toBe(33);
  });

  it('lists products missing quote-critical data first and skips complete ones', () => {
    const r = buildReport(products as any, new Map([['a', 3]]));
    expect(r.gaps.map((g) => g.id)).toEqual(['b', 'c']); // a 七项齐全不在清单里; b 缺两项必备优先
    expect(r.gaps[0].missing).toEqual(expect.arrayContaining(['priceList', 'specs']));
    expect(r.gaps[0].score).toBe(0);
  });

  it('handles empty data', () => {
    const r = buildReport([], new Map());
    expect(r).toMatchObject({ total: 0, quoteReady: 0, gaps: [] });
    expect(r.fields.every((f) => f.rate === 0)).toBe(true);
  });
});
