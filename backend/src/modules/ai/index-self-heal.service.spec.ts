import { IndexSelfHealService } from './index-self-heal.service';

const row = (sourceType: string, expected: number, indexed: number | null) => ({
  sourceType, label: sourceType, expected, indexed, chunks: indexed, reindexable: true,
});
const health = (rows: any[], extra: any = {}) => ({ rows, totalChunks: 0, running: false, lastRunAt: null, aiOnline: true, ...extra });

describe('IndexSelfHealService', () => {
  it('rebuilds only lagging reindexable types', async () => {
    const reindex: any = {
      getHealth: jest.fn()
        .mockResolvedValueOnce(health([row('document', 100, 5), row('customer', 10, 10), row('knowledge', 30, 3)]))
        .mockResolvedValueOnce(health([row('document', 100, 100), row('customer', 10, 10), row('knowledge', 30, 3)])),
      reindex: jest.fn().mockResolvedValue({ document: 100 }),
    };
    const svc = new IndexSelfHealService(reindex);
    expect(await svc.checkOnce()).toEqual(['document']); // knowledge 不在可重建类型里(走专用入口), customer 已齐
    expect(reindex.reindex).toHaveBeenCalledWith(['document']);
  });

  it('does nothing when the AI service is offline, a rebuild is running, or all is complete', async () => {
    for (const h of [
      health([row('document', 100, null)], { aiOnline: false }),
      health([row('document', 100, 5)], { running: true }),
      health([row('document', 100, 100)]),
    ]) {
      const reindex: any = { getHealth: jest.fn().mockResolvedValue(h), reindex: jest.fn() };
      expect(await new IndexSelfHealService(reindex).checkOnce()).toEqual([]);
      expect(reindex.reindex).not.toHaveBeenCalled();
    }
  });

  it('does not purge and rewrite again when a type cannot be filled to the expected count', async () => {
    const lag = health([row('product', 54, 43)]);
    const reindex: any = { getHealth: jest.fn().mockResolvedValue(lag), reindex: jest.fn().mockResolvedValue({ product: 43 }) };
    const svc = new IndexSelfHealService(reindex);
    expect(await svc.checkOnce()).toEqual(['product']);
    expect(await svc.checkOnce()).toEqual([]); // 应有/已索引都没变: 视为补到上限
    expect(reindex.reindex).toHaveBeenCalledTimes(1);
  });

  it('never throws', async () => {
    const reindex: any = { getHealth: jest.fn().mockRejectedValue(new Error('db down')), reindex: jest.fn() };
    await expect(new IndexSelfHealService(reindex).checkOnce()).resolves.toEqual([]);
  });
});
