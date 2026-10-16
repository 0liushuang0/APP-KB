import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as os from 'os';
import { randomBytes } from 'crypto';

export interface RunExclusiveOptions {
  /**
   * 锁租期：持锁实例崩溃时，最多这么久后别的实例可以接手。
   * 必须大于任务的正常耗时（全量备份给 2 小时，扫描类给 10 分钟）。
   */
  ttlMs: number;
  /**
   * 两次成功执行之间的最小间隔。
   * 多台服务器各自的定时器相位不同：A 在 8:00 跑完、B 的定时器 9:00 才响 ——
   * 光有互斥锁 B 还会再跑一遍。按"上次成功完成时间"再挡一层，才是真正的"全集群每天一次"。
   */
  minIntervalMs?: number;
}

export interface RunExclusiveResult<T> {
  ran: boolean;
  result?: T;
  /** 没跑的原因：held = 别的实例正在跑；recent = 别的实例刚跑过 */
  skipped?: 'held' | 'recent';
}

export interface JobLockState {
  name: string;
  holder: string | null;
  lockedUntil: number | null;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastResult: string | null;
  lastError: string | null;
}

/**
 * 定时任务分布式锁（多台服务器 / 多个进程共用一个数据库时防重复执行）。
 *
 * 原来所有定时任务都是进程内的 setInterval：部署两台服务器，项目健康度每天重算两遍、
 * 质保到期通知发两份、两台同时做全量备份、启动补识别两台同时调 AI。
 *
 * 实现：job_locks 表一行一个任务，用"条件更新"抢租约 ——
 *   UPDATE ... SET holder=我 WHERE name=? AND (租约已过期) AND (上次完成早于最小间隔)
 * 影响行数为 1 即抢到。只用到最普通的 UPDATE，PostgreSQL 与 SQLite 行为一致；
 * 时间一律存毫秒整数，避免两种库对时间类型的绑定与时区差异。
 *
 * 单机部署时它同样生效（总能抢到），开销是每次任务两条 UPDATE。
 */
@Injectable()
export class JobLockService {
  private readonly logger = new Logger(JobLockService.name);
  /** 本进程标识：主机名 + 进程号 + 随机串（同一台机器起两个进程也能区分） */
  readonly holderId = `${os.hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;

  constructor(@Optional() @InjectDataSource() private readonly dataSource?: DataSource) {}

  /**
   * 抢到锁才执行 fn；没抢到直接返回 { ran: false }，不排队、不重试（下个周期再来）。
   * fn 抛错时释放锁但不记"完成时间"，下个周期会重试。
   */
  async runExclusive<T>(
    name: string,
    fn: () => Promise<T>,
    opts: RunExclusiveOptions,
  ): Promise<RunExclusiveResult<T>> {
    // 没有数据库（个别单元测试直接 new 服务）时退化为直接执行
    if (!this.dataSource?.isInitialized) return { ran: true, result: await fn() };

    const acquired = await this.tryAcquire(name, opts);
    if (acquired !== true) return { ran: false, skipped: acquired };

    try {
      const result = await fn();
      await this.release(name, { finished: true });
      return { ran: true, result };
    } catch (err: any) {
      await this.release(name, { finished: false, error: String(err?.message || err).slice(0, 500) });
      throw err;
    }
  }

  /** 读任务状态（周报等需要记住"本周已发"的任务用 lastResult 存进度） */
  async getState(name: string): Promise<JobLockState | null> {
    if (!this.dataSource?.isInitialized) return null;
    const row = await this.dataSource
      .createQueryBuilder()
      .select('*')
      .from('job_locks', 'j')
      .where('j.name = :name', { name })
      .getRawOne<any>();
    if (!row) return null;
    const n = (v: any) => (v == null ? null : Number(v));
    return {
      name: row.name,
      holder: row.holder ?? null,
      lockedUntil: n(row.lockedUntil),
      lastStartedAt: n(row.lastStartedAt),
      lastFinishedAt: n(row.lastFinishedAt),
      lastResult: row.lastResult ?? null,
      lastError: row.lastError ?? null,
    };
  }

  /** 记下任务的业务进度（如"已发到 2026-W42"）；需在持锁期间调用 */
  async setResult(name: string, value: string): Promise<void> {
    if (!this.dataSource?.isInitialized) return;
    await this.dataSource
      .createQueryBuilder()
      .update('job_locks')
      .set({ lastResult: value })
      .where('name = :name', { name })
      .execute();
  }

  /** 全部任务状态（运维排查：哪台机器在跑、上次什么时候跑完、有没有报错） */
  async list(): Promise<JobLockState[]> {
    if (!this.dataSource?.isInitialized) return [];
    const rows = await this.dataSource.createQueryBuilder().select('j.name', 'name').from('job_locks', 'j').getRawMany<any>();
    const out: JobLockState[] = [];
    for (const r of rows) {
      const s = await this.getState(r.name);
      if (s) out.push(s);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async tryAcquire(name: string, opts: RunExclusiveOptions): Promise<true | 'held' | 'recent'> {
    const ds = this.dataSource!;
    const now = Date.now();
    // 首次使用先插一行占位；并发插入时冲突即忽略（PG: ON CONFLICT DO NOTHING / SQLite: INSERT OR IGNORE）
    await ds.createQueryBuilder().insert().into('job_locks').values({ name }).orIgnore().execute();

    const qb = ds
      .createQueryBuilder()
      .update('job_locks')
      .set({ holder: this.holderId, lockedUntil: now + opts.ttlMs, lastStartedAt: now })
      .where('name = :name', { name })
      .andWhere('("lockedUntil" IS NULL OR "lockedUntil" < :now)', { now });
    if (opts.minIntervalMs && opts.minIntervalMs > 0) {
      qb.andWhere('("lastFinishedAt" IS NULL OR "lastFinishedAt" <= :since)', { since: now - opts.minIntervalMs });
    }
    const res = await qb.execute();
    if (res.affected === 1) return true;

    // 没抢到：区分"别人在跑"与"刚跑过"，只用于日志与返回值
    const state = await this.getState(name);
    const held = state?.lockedUntil != null && state.lockedUntil >= now;
    if (held) this.logger.debug?.(`任务 ${name} 正由 ${state?.holder} 执行，本实例跳过`);
    return held ? 'held' : 'recent';
  }

  private async release(name: string, r: { finished: boolean; error?: string }): Promise<void> {
    try {
      const set: Record<string, any> = { lockedUntil: null, lastError: r.error ?? null };
      if (r.finished) set.lastFinishedAt = Date.now();
      await this.dataSource!
        .createQueryBuilder()
        .update('job_locks')
        .set(set)
        .where('name = :name AND holder = :holder', { name, holder: this.holderId })
        .execute();
    } catch (err: any) {
      // 释放失败不致命：租约到期后自动失效
      this.logger.warn(`释放任务锁 ${name} 失败：${err?.message}`);
    }
  }
}
