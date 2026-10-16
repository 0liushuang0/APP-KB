import { cycleMetrics } from './cycle-metrics';

describe('业务结果指标', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  const base = {
    reqs: [
      { id: 'r1', requirementDate: '2026-09-01', createdAt: '2026-10-14T00:00:00Z', status: 'won' },
      { id: 'r2', requirementDate: null, createdAt: '2026-10-14T00:00:00Z', status: 'quoted' },
      { id: 'r3', requirementDate: '2026-08-01', createdAt: '2026-10-14T00:00:00Z', status: 'lost', lossReason: '价格高', updatedAt: '2026-10-01' },
      { id: 'r4', requirementDate: '2026-08-01', createdAt: '2026-10-14T00:00:00Z', status: 'lost', lossReason: '', updatedAt: '2026-10-02' },
    ],
    props: [{ id: 'p1', requirementId: 'r1' }, { id: 'p2', requirementId: 'r2' }],
    quotes: [
      { id: 'q1', proposalId: 'p1', quotedAt: '2026-09-11', createdAt: '2026-10-14T00:00:00Z' },
      { id: 'q1b', proposalId: 'p1', quotedAt: '2026-09-20', createdAt: '2026-10-14T00:00:00Z' },
      { id: 'q2', proposalId: 'p2', quotedAt: null, createdAt: '2026-10-15T00:00:00Z' },
    ],
    contracts: [{ id: 'c1', quotationId: 'q1b', signedDate: '2026-10-01', status: 'signed' }],
    payments: [
      { contractId: 'c1', dueDate: '2026-10-05', receivedDate: '2026-10-05' },
      { contractId: 'c1', dueDate: '2026-10-10', receivedDate: '2026-10-12' },
      { contractId: 'c1', dueDate: '2026-10-12', receivedDate: null },
      { contractId: 'c1', dueDate: '2026-11-30', receivedDate: null },
    ],
  };

  it('报价响应天数取第一份报价，区分真实日期样本', () => {
    const m = cycleMetrics(base as any, now, 0);
    expect(m.quoteResponse.n).toBe(2);
    expect(m.quoteResponse.nReal).toBe(1); // r2 没填需求时间、q2 没填报价日期
    expect(m.quoteResponse.median).toBeCloseTo((10 + 1) / 2, 0); // r1: 10 天；r2: 10-14 → 10-15 = 1 天
    expect(m.quoteResponse.medianReal).toBeNull(); // 真实样本 < 3 不给
  });

  it('需求→签约周期、赢单率、丢单原因', () => {
    const m = cycleMetrics(base as any, now, 0);
    expect(m.reqToSign).toMatchObject({ n: 1, nReal: 1, median: 30 });
    expect(m.winRate).toEqual({ won: 1, lost: 2, rate: 33 });
    expect(m.lossReasons).toEqual([
      { reason: '价格高', count: 1 },
      { reason: '未填原因', count: 1 },
    ]);
  });

  it('回款及时率只看已到期节点', () => {
    const m = cycleMetrics(base as any, now, 0);
    expect(m.paymentOnTime).toEqual({ due: 3, onTime: 1, rate: 33, overdueOpen: 1 });
  });

  it('时间窗：只统计结束事件落在最近 N 天的样本', () => {
    const m = cycleMetrics(base as any, now, 10); // 10-06 之后
    expect(m.quoteResponse.n).toBe(1); // 只剩 q2（10-15）
    expect(m.reqToSign.n).toBe(0);
  });
});
