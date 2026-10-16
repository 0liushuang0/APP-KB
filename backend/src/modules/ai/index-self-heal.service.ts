import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { recordAutomation } from '../../common/utils/automation-log';
import { ReindexService, REINDEXABLE_TYPES } from './reindex.service';
import { JobLockService } from '../../common/services/job-lock.service';

/**
 * 向量索引自愈。
 *
 * 为什么需要：索引只在「通过服务层新建/修改」时写入，批量导入、上传后补解析、种子数据都不会进索引；
 * 实测 1209 篇文档里只有 33 篇可被检索（已审批的 docx 45 篇仅 1 篇入库），而补救入口（设置页「重建索引」）
 * 要有人记得去点。这里让系统自己发现「库里应有 N、索引里只有 M」并只重建落后的类型。
 *
 * 保守原则：
 *  - 只重建「可重建」且「应有数 > 已索引数」的类型；AI 服务离线（indexed 为 null）时什么也不做；
 *  - 同一类型在「应有数/已索引数」都没变化时不重复重建（有些对象天生没有可索引文本，永远补不齐，不能每轮都清空重写）；
 *  - 启动 10 分钟后首次检查（避开启动高峰），之后每 6 小时一次；
 *  - 可用 INDEX_SELF_HEAL=false 关闭。
 */
@Injectable()
export class IndexSelfHealService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexSelfHealService.name);
  private timers: ReturnType<typeof setTimeout>[] = [];
  /** 类型 → 上次重建后观察到的「应有:已索引」，相同则认为已补到上限 */
  private settled = new Map<string, string>();

  constructor(
    private readonly reindex: ReindexService,
    @InjectDataSource() private readonly dataSource?: DataSource,
    @Optional() private readonly jobLock?: JobLockService,
  ) {}

  onModuleInit(): void {
    if ((process.env.INDEX_SELF_HEAL ?? 'true') === 'false') return;
    const first = setTimeout(() => {
      void this.tick();
      const every = setInterval(() => void this.tick(), 6 * 3_600_000);
      every.unref?.();
      this.timers.push(every as any);
    }, 10 * 60_000);
    first.unref?.();
    this.timers.push(first);
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t as any));
    this.timers = [];
  }

  /** 多台服务器共用一个向量库：只让一台去补建，别的跳过 */
  private async tick(): Promise<void> {
    if (!this.jobLock) {
      await this.checkOnce();
      return;
    }
    await this.jobLock
      .runExclusive('index-self-heal', () => this.checkOnce(), { ttlMs: 2 * 3_600_000, minIntervalMs: 5 * 3_600_000 })
      .catch((err) => this.logger.warn(`索引自愈失败：${err?.message}`));
  }

  /** 做一轮检查；返回本轮重建了哪些类型（供测试与日志） */
  async checkOnce(): Promise<string[]> {
    try {
      const health = await this.reindex.getHealth();
      if (!health.aiOnline || health.running) return [];

      const lagging = health.rows.filter(
        (r) =>
          (REINDEXABLE_TYPES as readonly string[]).includes(r.sourceType) &&
          r.indexed !== null &&
          r.expected > r.indexed &&
          this.settled.get(r.sourceType) !== `${r.expected}:${r.indexed}`,
      );
      if (!lagging.length) return [];

      const types = lagging.map((r) => r.sourceType);
      this.logger.log(
        `索引落后，自动补建：${lagging.map((r) => `${r.label} ${r.indexed}/${r.expected}`).join('、')}`,
      );
      await this.reindex.reindex(types);
      // 按类型各记一笔（objectId=类型）：同一类型多次补建在「本周系统替你做了什么」里只算一类
      if (this.dataSource) for (const t of types) await recordAutomation(this.dataSource.manager, 'index_healed', 1, t);

      // 补建后重新读一次，记下每个类型的最终状态；仍补不齐的下次不再重复清空重写
      const after = await this.reindex.getHealth();
      for (const r of after.rows) {
        if (types.includes(r.sourceType) && r.indexed !== null) {
          this.settled.set(r.sourceType, `${r.expected}:${r.indexed}`);
        }
      }
      return types;
    } catch (err) {
      this.logger.warn(`索引自愈检查失败：${(err as Error)?.message}`);
      return [];
    }
  }
}
