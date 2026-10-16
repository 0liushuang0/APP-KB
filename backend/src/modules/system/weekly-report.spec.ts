import { WeeklyReportService, isoWeekKey, reportWeek } from './weekly-report.service';

describe('周报：周期与调度', () => {
  it('上一个自然周与 ISO 周号', () => {
    const w = reportWeek(new Date(2026, 9, 16, 10, 0)); // 2026-10-16 周五
    expect([w.from.getMonth() + 1, w.from.getDate()]).toEqual([10, 5]);
    expect([w.to.getMonth() + 1, w.to.getDate()]).toEqual([10, 12]);
    expect(w.key).toBe('2026-W41');
    expect([w.due.getDate(), w.due.getHours(), w.due.getMinutes()]).toEqual([12, 8, 30]);
    // 周一 8:30 之前仍属上上周的周期
    expect(reportWeek(new Date(2026, 9, 19, 8, 0)).key).toBe('2026-W42');
    expect(isoWeekKey(new Date(2026, 0, 1))).toBe('2026-W01');
    expect(isoWeekKey(new Date(2027, 0, 1))).toBe('2026-W53');
  });

  const make = (state: { lastResult: string | null } | null) => {
    const jobLock = {
      state,
      getState: jest.fn(async () => jobLock.state),
      setResult: jest.fn(async (_: string, v: string) => {
        jobLock.state = { lastResult: v };
      }),
      runExclusive: jest.fn(async (_n: string, fn: () => Promise<any>) => ({ ran: true, result: await fn() })),
    };
    const svc = new WeeklyReportService(
      {} as any,
      { createQueryBuilder: () => ({ select: () => ({ from: () => ({ where: () => ({ getRawOne: async () => ({ value: 'true' }) }) }) }) }) } as any,
      {} as any,
      {} as any,
      jobLock as any,
      { isSingleMode: () => true } as any,
    );
    const generate = jest.spyOn(svc, 'generate').mockResolvedValue(3);
    return { svc, jobLock, generate };
  };

  it('首次上线不补发上一周，只记下周号', async () => {
    const { svc, jobLock, generate } = make(null);
    const r = await svc.tick(new Date(2026, 9, 16, 10, 0));
    expect(r).toEqual({ sent: 0, weekKey: '2026-W41' });
    expect(generate).not.toHaveBeenCalled();
    expect(jobLock.state).toEqual({ lastResult: '2026-W41' });
  });

  it('周一 8:30 之后发上一周，同一周只发一次', async () => {
    const { svc, generate } = make({ lastResult: '2026-W41' });
    expect(await svc.tick(new Date(2026, 9, 19, 8, 0))).toBeNull(); // 还没到 8:30
    expect(await svc.tick(new Date(2026, 9, 19, 9, 0))).toEqual({ sent: 3, weekKey: '2026-W42' });
    expect(await svc.tick(new Date(2026, 9, 19, 9, 30))).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('服务器周一停机：本周内补发', async () => {
    const { svc, generate } = make({ lastResult: '2026-W41' });
    expect(await svc.tick(new Date(2026, 9, 21, 15, 0))).toEqual({ sent: 3, weekKey: '2026-W42' });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
