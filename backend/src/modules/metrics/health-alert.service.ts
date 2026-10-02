import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/entities/user.entity';
import { MetricsService } from './metrics.service';

/**
 * 运行告警（评估框架 P1 可观测性）：
 *   · 数据盘剩余 < 15% → 通知管理员（每 24h 一次）
 *   · 备份过期（db-only >2h 或全量 >12h 无新档）→ 通知（每 6h 一次）
 *   · AI 服务不可达 → 通知（每 1h 一次）
 *   · 错误率 10 分钟窗口 > 10% 且样本足够 → 通知（每 1h 一次）
 * 无 Prometheus 的单机环境里，站内通知就是第一道告警防线。
 */
@Injectable()
export class HealthAlertService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthAlertService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly lastFired = new Map<string, number>();
  /** 告警类型 → 冷却毫秒 */
  private readonly cooldown = {
    disk: 24 * 3600_000,
    backup: 6 * 3600_000,
    ai: 3600_000,
    errors: 3600_000,
  };

  constructor(
    private readonly metrics: MetricsService,
    private readonly notificationsService: NotificationsService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  onModuleInit(): void {
    // 首检延迟 3 分钟（等服务稳定），之后每 10 分钟一轮
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.check();
      this.timer = setInterval(() => void this.check(), 10 * 60_000);
    }, 3 * 60_000);
    this.initialTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.timer) clearInterval(this.timer);
    this.initialTimer = null;
    this.timer = null;
  }

  private async fire(kind: string, title: string, content: string): Promise<void> {
    const now = Date.now();
    if (now - (this.lastFired.get(kind) || 0) < this.cooldown[kind]) return;
    this.lastFired.set(kind, now);
    try {
      const admins = await this.userRepository.find({ where: { isSystemAdmin: true } });
      const targets = admins.length ? admins : await this.userRepository.find({ take: 5 });
      for (const u of targets) {
        this.notificationsService.create({
          type: 'system',
          title,
          content,
          recipientId: u.id,
          linkUrl: '/settings/metrics',
        }).catch(() => {});
      }
      this.logger.warn(`[告警] ${title}（已通知 ${targets.length} 名管理员）`);
    } catch (err: any) {
      this.logger.error(`告警通知发送失败：${err.message}`);
    }
  }

  private async check(): Promise<void> {
    try {
      const summary = await this.metrics.summary();

      if (summary.system.diskFreeRatio < 0.15) {
        await this.fire('disk', '磁盘空间不足',
          `数据盘剩余 ${summary.system.diskFreeGB}GB（${summary.system.diskFreeRatio}%）。请清理旧备份或扩容，磁盘写满会导致数据库与备份失败。`);
      }

      const dbAge = summary.backup.dbAgeHours;
      const fullAge = summary.backup.fullAgeHours;
      if ((dbAge != null && dbAge > 2) || (fullAge != null && fullAge > 12)) {
        await this.fire('backup', '备份过期',
          `最近一次仅数据库备份 ${dbAge ?? '无'} 小时前、全量备份 ${fullAge ?? '无'} 小时前。请检查备份调度与磁盘。`);
      }

      if (!summary.aiServiceUp) {
        await this.fire('ai', 'AI 服务不可达',
          'AI 问答/生成功能暂不可用（基础业务不受影响）。请检查 ai-service 进程（端口 8100）。');
      }

      const err = summary.http as { total: number; rate: number };
      if (err.total > 200 && err.rate > 0.1) {
        await this.fire('errors', '接口错误率异常',
          `近 1 小时 5xx 错误率 ${err.rate}%。请查看 backend.log 排查。`);
      }
    } catch (err: any) {
      this.logger.error(`健康巡检失败：${err.message}`);
    }
  }
}
