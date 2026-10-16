import { DataSource } from 'typeorm';
import { JobLockService } from './job-lock.service';

/**
 * 两个 JobLockService 实例共用一个库 = 两台服务器。
 * 验证：同一时刻只有一台在跑；跑完后最小间隔内另一台不再跑；失败不算完成、锁会释放。
 */
describe('JobLockService（多实例防重复）', () => {
  let ds: DataSource;
  let a: JobLockService;
  let b: JobLockService;

  beforeAll(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:' } as any);
    await ds.initialize();
    await ds.query(`
      CREATE TABLE "job_locks" (
        "name" varchar(120) PRIMARY KEY NOT NULL,
        "holder" varchar(200), "lockedUntil" bigint, "lastStartedAt" bigint,
        "lastFinishedAt" bigint, "lastResult" text, "lastError" text
      )`);
    a = new JobLockService(ds);
    b = new JobLockService(ds);
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('两个实例的持有者标识不同', () => {
    expect(a.holderId).not.toEqual(b.holderId);
  });

  it('A 正在跑时 B 跳过（held），A 跑完后最小间隔内 B 也跳过（recent）', async () => {
    let releaseA!: () => void;
    const gate = new Promise<void>((r) => (releaseA = r));
    const runA = a.runExclusive('job-1', async () => {
      await gate;
      return 'A';
    }, { ttlMs: 60_000, minIntervalMs: 3_600_000 });

    // 等 A 抢到锁
    await new Promise((r) => setTimeout(r, 20));
    const ranB = await b.runExclusive('job-1', async () => 'B', { ttlMs: 60_000, minIntervalMs: 3_600_000 });
    expect(ranB).toEqual({ ran: false, skipped: 'held' });

    releaseA();
    expect(await runA).toEqual({ ran: true, result: 'A' });

    const ranB2 = await b.runExclusive('job-1', async () => 'B', { ttlMs: 60_000, minIntervalMs: 3_600_000 });
    expect(ranB2).toEqual({ ran: false, skipped: 'recent' });

    const state = await a.getState('job-1');
    expect(state?.lockedUntil).toBeNull();
    expect(state?.lastFinishedAt).toBeGreaterThan(0);
  });

  it('不设最小间隔时，跑完立即可以再跑（互斥但不限频）', async () => {
    const r1 = await a.runExclusive('job-2', async () => 1, { ttlMs: 60_000 });
    const r2 = await b.runExclusive('job-2', async () => 2, { ttlMs: 60_000 });
    expect(r1.ran && r2.ran).toBe(true);
  });

  it('任务失败：锁释放、不记完成时间、记录错误，下一轮可重试', async () => {
    await expect(
      a.runExclusive('job-3', async () => {
        throw new Error('AI 服务离线');
      }, { ttlMs: 60_000, minIntervalMs: 3_600_000 }),
    ).rejects.toThrow('AI 服务离线');
    const s = await a.getState('job-3');
    expect(s?.lockedUntil).toBeNull();
    expect(s?.lastFinishedAt).toBeNull();
    expect(s?.lastError).toContain('AI 服务离线');

    const retry = await b.runExclusive('job-3', async () => 'ok', { ttlMs: 60_000, minIntervalMs: 3_600_000 });
    expect(retry).toEqual({ ran: true, result: 'ok' });
  });

  it('持锁实例崩溃（租约过期）后，另一实例可以接手', async () => {
    // 模拟 A 抢到锁后进程消失：租约 1ms 后过期，且从未释放
    await ds.query(`INSERT INTO "job_locks" ("name","holder","lockedUntil") VALUES ('job-4','dead-host',${Date.now() - 1})`);
    const r = await b.runExclusive('job-4', async () => 'taken-over', { ttlMs: 60_000 });
    expect(r).toEqual({ ran: true, result: 'taken-over' });
  });

  it('setResult / getState 记录业务进度', async () => {
    await a.runExclusive('job-5', async () => a.setResult('job-5', '2026-W42'), { ttlMs: 60_000 });
    expect((await b.getState('job-5'))?.lastResult).toBe('2026-W42');
    expect((await a.list()).map((s) => s.name)).toEqual(expect.arrayContaining(['job-1', 'job-5']));
  });
});
