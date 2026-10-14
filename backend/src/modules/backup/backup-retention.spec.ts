import { firstFullDelayMs, selectBackupsToKeep } from './backup-retention';

const at = (s: string, name = s) => ({ fileName: name, createdAt: new Date(s) });

describe('selectBackupsToKeep', () => {
  it('keeps one per day instead of the newest N (restart storm no longer evicts history)', () => {
    // 今天 2 小时内 7 份(重启触发), 前 4 天各 1~2 份
    const today = ['2026-10-14T16:40', '2026-10-14T16:57', '2026-10-14T17:24', '2026-10-14T17:40', '2026-10-14T18:05', '2026-10-14T18:14', '2026-10-14T18:40'].map((s) => at(s));
    const older = ['2026-10-13T02:00', '2026-10-13T20:00', '2026-10-12T02:00', '2026-10-11T02:00', '2026-10-10T02:00'].map((s) => at(s));
    const keep = selectBackupsToKeep([...today, ...older], 5);
    expect([...keep].sort()).toEqual([
      '2026-10-10T02:00', '2026-10-11T02:00', '2026-10-12T02:00', '2026-10-13T20:00', '2026-10-14T18:40',
    ]);
  });

  it('fills the quota with same-day backups when history is short', () => {
    const items = ['2026-10-14T10:00', '2026-10-14T11:00', '2026-10-14T12:00'].map((s) => at(s));
    expect(selectBackupsToKeep(items, 2).size).toBe(2);
    expect(selectBackupsToKeep(items, 2).has('2026-10-14T12:00')).toBe(true);
    expect(selectBackupsToKeep([], 7).size).toBe(0);
  });
});

describe('firstFullDelayMs', () => {
  const now = new Date('2026-10-14T18:00:00');
  it('waits for the interval to elapse after a recent full backup', () => {
    // 1 小时前刚做过 6 小时间隔的全量: 还要等 5 小时
    expect(firstFullDelayMs(new Date('2026-10-14T17:00:00'), 6, now)).toBe(5 * 3_600_000);
  });
  it('uses 5 minutes when overdue or never backed up', () => {
    expect(firstFullDelayMs(new Date('2026-10-13T00:00:00'), 6, now)).toBe(5 * 60 * 1000);
    expect(firstFullDelayMs(null, 6, now)).toBe(5 * 60 * 1000);
  });
});
