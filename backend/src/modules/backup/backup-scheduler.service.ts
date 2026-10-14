import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { BackupService } from './backup.service';
import { firstFullDelayMs, selectBackupsToKeep } from './backup-retention';

/**
 * 自动备份调度器（双层级）。
 *
 * 单机产品没有 cron、没有运维，用户不会记得手动备份。
 * 两级策略兼顾 RPO 与磁盘占用（全量含附件可达 GB 级）：
 *
 *   · db-only：仅数据库快照，默认每 1 小时（BACKUP_DB_INTERVAL_HOURS），
 *     保留最近 72 份 → 业务数据 RPO ≤ 1 小时
 *   · 全量：数据库 + 附件目录，默认每 6 小时（AUTO_BACKUP_INTERVAL_HOURS），
 *     保留 7 份，按自然日分层（每天最新一份）→ 附件与完整恢复能力，且频繁重启不会挤掉历史；
 *     启动后若距上一份全量不足一个间隔，等到满间隔再做（不再「每次启动都备份」）
 *
 * 配置通过环境变量：
 *   AUTO_BACKUP_ENABLED=true          总开关
 *   AUTO_BACKUP_INTERVAL_HOURS=6      全量间隔
 *   AUTO_BACKUP_KEEP_COUNT=7          全量保留份数
 *   BACKUP_DB_INTERVAL_HOURS=1        db-only 间隔（0 = 关闭该层）
 *   BACKUP_DB_KEEP_COUNT=72           db-only 保留份数
 *   BACKUP_OFFSITE_DIR=Z:\backups     异地目录（绝对路径，网络盘/第二块盘）
 */
@Injectable()
export class BackupSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupSchedulerService.name);
  private timers: ReturnType<typeof setInterval>[] = [];

  private readonly enabled: boolean;
  private readonly intervalHours: number;
  private readonly keepCount: number;
  private readonly dbIntervalHours: number;
  private readonly dbKeepCount: number;

  constructor(private readonly backupService: BackupService) {
    this.enabled = (process.env.AUTO_BACKUP_ENABLED ?? 'true') !== 'false';
    this.intervalHours = Math.max(1, parseInt(process.env.AUTO_BACKUP_INTERVAL_HOURS ?? '6', 10) || 6);
    this.keepCount = Math.max(1, parseInt(process.env.AUTO_BACKUP_KEEP_COUNT ?? '7', 10) || 7);
    this.dbIntervalHours = parseInt(process.env.BACKUP_DB_INTERVAL_HOURS ?? '1', 10);
    this.dbKeepCount = Math.max(1, parseInt(process.env.BACKUP_DB_KEEP_COUNT ?? '72', 10) || 72);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('自动备份已禁用（AUTO_BACKUP_ENABLED=false）');
      return;
    }

    // 全量层：首次延迟 5 分钟，避免启动时争抢资源
    const fullMs = this.intervalHours * 60 * 60 * 1000;
    this.logger.log(
      `自动备份已启用：全量每 ${this.intervalHours} 小时保留 ${this.keepCount} 份` +
      (this.dbIntervalHours > 0
        ? `；仅数据库每 ${this.dbIntervalHours} 小时保留 ${this.dbKeepCount} 份（数据 RPO ≤ ${this.dbIntervalHours} 小时）`
        : '；仅数据库层已关闭'),
    );
    const lastFull = this.lastFullBackupAt();
    const firstDelay = firstFullDelayMs(lastFull, this.intervalHours);
    if (lastFull) {
      this.logger.log(`上一份全量备份：${lastFull.toLocaleString()}，${Math.round(firstDelay / 60000)} 分钟后做下一次`);
    }
    setTimeout(() => {
      this.runFull();
      this.timers.push(setInterval(() => this.runFull(), fullMs));
    }, firstDelay);

    // db-only 层：首次延迟 2 分钟，快速建立第一份数据保护
    if (this.dbIntervalHours > 0) {
      const dbMs = this.dbIntervalHours * 60 * 60 * 1000;
      setTimeout(() => {
        this.runDbOnly();
        this.timers.push(setInterval(() => this.runDbOnly(), dbMs));
      }, 2 * 60 * 1000);
    }
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** 最近一份全量备份（不含仅数据库层）的时间 */
  private lastFullBackupAt(): Date | null {
    try {
      const full = this.backupService
        .list()
        .filter((b) => b.fileName.startsWith('backup-') && !b.fileName.startsWith('backup-db-'));
      return full.length ? full[0].createdAt : null;
    } catch {
      return null;
    }
  }

  private async runFull(): Promise<void> {
    try {
      const info = await this.backupService.create('自动备份（全量）');
      this.logger.log(`全量备份完成：${info.fileName}（${(info.size / 1024 / 1024).toFixed(1)} MB）`);
      this.cleanup('backup-', this.keepCount);
    } catch (err: any) {
      this.logger.error(`全量备份失败：${err.message}`);
    }
  }

  private async runDbOnly(): Promise<void> {
    try {
      const info = await this.backupService.createDbOnly('自动备份（仅数据库）');
      this.logger.log(`数据库备份完成：${info.fileName}（${(info.size / 1024 / 1024).toFixed(1)} MB）`);
      this.cleanup('backup-db-', this.dbKeepCount);
    } catch (err: any) {
      this.logger.error(`数据库备份失败：${err.message}`);
    }
  }

  /** 按前缀清理旧备份；backup- 前缀需排除 backup-db-，两层互不误删 */
  private cleanup(prefix: string, keep: number): void {
    try {
      const all = this.backupService
        .list()
        .filter((b) => b.fileName.startsWith(prefix))
        // 全量层（backup-）不含 db-only 层（backup-db-）
        .filter((b) => prefix === 'backup-' ? !b.fileName.startsWith('backup-db-') : true);
      if (all.length <= keep) return;
      // 全量层按自然日分层保留; 仅数据库层很小, 仍按最近 N 份
      const kept = prefix === 'backup-' ? selectBackupsToKeep(all, keep) : new Set(all.slice(0, keep).map((b) => b.fileName));
      for (const backup of all.filter((b) => !kept.has(b.fileName))) {
        try {
          this.backupService.remove(backup.fileName);
          this.logger.log(`已清理旧备份：${backup.fileName}`);
        } catch {
          // 单个删除失败不影响其他
        }
      }
    } catch (err: any) {
      this.logger.warn(`清理旧备份失败：${err.message}`);
    }
  }
}
