import { buildFunnel, chainFacts, dealDate, dealsBetween, monthlyTrend, winRate } from './business-metrics';

/**
 * 复现 2026-10-16 实测的口径冲突：需求 12、方案 8、报价 1、合同 2（其中 1 份直签，1 份挂在已删除的报价上）。
 * 原来漏斗「成交 4」、成单率 400%、本月成交额 0；统一后全部以签约合同为准。
 */
describe('business-metrics', () => {
  const reqs = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, status: 'approved', isCurrent: true }));
  const props = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, requirementId: `r${i}` }));
  const quotes = [{ id: 'q0', proposalId: 'p0', amount: 200000, createdAt: '2026-10-14' }];
  const contracts = [
    { id: 'c0', quotationId: 'q-deleted', amount: 2760000, signedDate: '2026-08-09' },
    { id: 'c1', quotationId: 'q0', amount: 200000, signedDate: null, createdAt: '2026-10-14' },
  ];

  it('funnel never grows from one stage to the next', () => {
    const f = buildFunnel(reqs, props, quotes, contracts);
    const values = f.stages.map((s) => s.value);
    expect(values).toEqual([12, 8, 1, 1]);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    expect(f.stages.every((s) => s.rate <= 100)).toBe(true);
  });

  it('contracts without a living quotation are counted as direct deals, not in the funnel', () => {
    const f = buildFunnel(reqs, props, quotes, contracts);
    expect(f.direct).toEqual({ count: 1, amount: 2760000 });
    expect(chainFacts(reqs, props, quotes, contracts).directContracts.map((c) => c.id)).toEqual(['c0']);
  });

  it('win rate is signed quotations / all quotations and never exceeds 100%', () => {
    expect(winRate(quotes, contracts)).toBe(100);
    expect(winRate([...quotes, { id: 'q1' }], contracts)).toBe(50);
    // 同一报价签了两份合同也不超过 100%
    expect(winRate(quotes, [...contracts, { id: 'c2', quotationId: 'q0', amount: 1 }])).toBe(100);
    expect(winRate([], contracts)).toBe(0);
  });

  it('deal date = signed date, falling back to creation date', () => {
    expect(dealDate(contracts[0])!.toISOString().slice(0, 10)).toBe('2026-08-09');
    expect(dealDate(contracts[1])!.toISOString().slice(0, 10)).toBe('2026-10-14');
    const oct = dealsBetween(contracts, new Date('2026-10-01'), new Date('2026-11-01'));
    expect(oct).toEqual({ count: 1, amount: 200000 });
  });

  it('monthly trend carries quotes and deals on the same months', () => {
    const t = monthlyTrend(quotes, contracts, new Date('2026-10-16'), 6);
    expect(t.map((m) => m.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(t[3]).toMatchObject({ dealCount: 1, dealAmount: 2760000 });
    expect(t[5]).toMatchObject({ quoteCount: 1, quoteAmount: 200000, dealCount: 1 });
  });

  it('lost and historical requirement versions are excluded from the funnel base', () => {
    const f = buildFunnel([...reqs, { id: 'old', isCurrent: false }, { id: 'lost', status: 'lost' }], props, quotes, contracts);
    expect(f.stages[0].value).toBe(12);
  });
});
