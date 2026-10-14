import { evaluate, HealthInputs } from './ops-health.service';

const base: HealthInputs = {
  index: { expected: 100, indexed: 95, aiOnline: true, laggingLabels: [] },
  products: { total: 50, quoteReady: 45 },
  approvals: { pending: 3, oldestDays: 1 },
  parse: { calls: 40, ok: 39 },
  backup: { latestFullHours: 2, latestDbHours: 0.5, fullIntervalHours: 6, historyDays: 6, offsite: true },
};
const level = (i: HealthInputs, key: string) => evaluate(i).find((x) => x.key === key)!.level;

describe('ops health evaluate', () => {
  it('all green on healthy inputs', () => {
    expect(evaluate(base).map((x) => x.level)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
  });

  it('flags the measured problems of this deployment', () => {
    // 实测: 1209 份里 33 份可检索; 54 个产品 0 个报价就绪; 690 条待审批; 解析 60%; 备份与数据同盘
    const real: HealthInputs = {
      index: { expected: 1209, indexed: 33, aiOnline: true, laggingLabels: ['业务资料'] },
      products: { total: 54, quoteReady: 0 },
      approvals: { pending: 690, oldestDays: 50 },
      parse: { calls: 146, ok: 88 },
      backup: { ...base.backup, offsite: false },
    };
    expect(level(real, 'index')).toBe('bad');
    expect(level(real, 'products')).toBe('bad');
    expect(level(real, 'approvals')).toBe('bad');
    expect(level(real, 'parse')).toBe('bad');
    expect(level(real, 'backup')).toBe('warn');
    expect(evaluate(real).find((x) => x.key === 'index')!.detail).toContain('业务资料');
  });

  it('AI offline and overdue backups are red', () => {
    expect(level({ ...base, index: { ...base.index, aiOnline: false } }, 'index')).toBe('bad');
    expect(level({ ...base, backup: { ...base.backup, latestFullHours: 30 } }, 'backup')).toBe('bad');
    expect(level({ ...base, backup: { ...base.backup, latestFullHours: null } }, 'backup')).toBe('bad');
  });

  it('no parse activity is not an alarm', () => {
    expect(level({ ...base, parse: { calls: 0, ok: 0 } }, 'parse')).toBe('ok');
  });
});
