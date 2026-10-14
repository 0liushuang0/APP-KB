import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * 质保到期定时扫描。
 *
 * 仿照 BackupSchedulerService 的 setInterval 模式（系统无 @nestjs/schedule）。
 * 每 24 小时扫描一次，找出 30 天内即将到期的合同质保，
 * 写入通知记录提醒负责人跟进续保/备件储备。
 */
@Injectable()
export class WarrantySchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WarrantySchedulerService.name);
  private interval: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit() {
    // 启动后 2 分钟开始第一次扫描，避免启动高峰
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      this.scan();
      this.interval = setInterval(() => this.scan(), 24 * 60 * 60 * 1000);
    }, 2 * 60 * 1000);
    this.initialTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.interval) clearInterval(this.interval);
    this.initialTimer = null;
    this.interval = null;
  }

  private async scan() {
    try {
      /*
       * 查找 30 天内到期的质保合同。
       * 质保列是 date 型，用 JS 算好边界再传参 —— 原来的 date('now','+30 days')
       * 是 SQLite 专用语法，PostgreSQL 没有 date(文本,文本) 这个函数重载。
       */
      const isoDay = (d: Date) => d.toISOString().slice(0, 10);
      const today = isoDay(new Date());
      const in30 = isoDay(new Date(Date.now() + 30 * 86400000));

      const rows = await this.dataSource
        .createQueryBuilder()
        .select([
          'c.id AS "id"',
          'c.contractNo AS "contractNo"',
          'c.customerId AS "customerId"',
          'c.warrantyExpiryDate AS "warrantyExpiryDate"',
          'c.ownerId AS "ownerId"',
        ])
        .from('contracts', 'c')
        .where('c."warrantyExpiryDate" IS NOT NULL')
        .andWhere('c."warrantyExpiryDate" > :today', { today })
        .andWhere('c."warrantyExpiryDate" <= :in30', { in30 })
        .getRawMany<any>();

      if (!rows.length) return;
      this.logger.log(`质保到期扫描：发现 ${rows.length} 个即将到期的合同`);

      // 今日零点/次日零点：判断"今天是否已发过通知"用，替代 date(n.createdAt)=date('now')
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 86400000);

      for (const c of rows) {
        if (!c.ownerId) continue;
        const days = Math.ceil(
          (new Date(c.warrantyExpiryDate).getTime() - Date.now()) / 86400000,
        );
        // 避免重复通知：检查今天是否已发过
        const existing = await this.dataSource
          .createQueryBuilder()
          .select('n.id', 'id')
          .from('notifications', 'n')
          .where('n."recipientId" = :rid', { rid: c.ownerId })
          .andWhere('n.type = :type', { type: 'warranty' })
          .andWhere('n.title LIKE :title', { title: `%${c.contractNo}%` })
          .andWhere('n."createdAt" >= :dayStart', { dayStart })
          .andWhere('n."createdAt" < :dayEnd', { dayEnd })
          .getRawOne();
        if (existing) continue;

        await this.notificationsService.create({
          type: 'warranty',
          title: `质保即将到期：${c.contractNo}`,
          content: `合同 ${c.contractNo} 的质保将于 ${c.warrantyExpiryDate} 到期（剩余 ${days} 天），请及时跟进续保或备件储备。`,
          recipientId: c.ownerId,
          // 带 highlight 直接定位到该合同详情，不再只落到合同列表
          linkUrl: `/contracts?highlight=${c.id}`,
        });
      }
    } catch (err) {
      this.logger.error('质保到期扫描失败', err?.message);
    }
  }
}
