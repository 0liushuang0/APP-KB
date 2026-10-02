import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { RecycleBinService } from '../recycle-bin/recycle-bin.service';

/**
 * 回收站过期清理。
 *
 * RecycleBinService.cleanup() 只删数据库里的回收记录 —— 但资料类的回收记录
 * 对应着 uploads/.trash/<id>/ 下的实体文件。只删记录不删文件的话，
 * 磁盘会被永远留在那里的"看不见的文件"慢慢占满，而且再也没有任何入口能找到它们。
 *
 * 所以清理必须成对做：先按记录找到文件删掉，再删记录。
 */
@Injectable()
export class RecycleCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecycleCleanupService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  /** 每 6 小时扫一次；单机产品不常关机，用 setInterval 足够（同备份调度的做法） */
  private static readonly INTERVAL_MS = 6 * 60 * 60 * 1000;

  constructor(private readonly recycleBin: RecycleBinService) {}

  private get trashDir(): string {
    return path.resolve(process.cwd(), 'data', 'uploads', '.trash');
  }

  onModuleInit(): void {
    // 启动时先跑一次：机器可能关了好几天，开机就该把过期的清掉
    this.purgeExpired().catch((err) =>
      this.logger.warn(`回收站启动清理失败：${err?.message}`),
    );
    this.timer = setInterval(() => {
      this.purgeExpired().catch((err) =>
        this.logger.warn(`回收站定时清理失败：${err?.message}`),
      );
    }, RecycleCleanupService.INTERVAL_MS);
    // 定时器不应阻止进程退出
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async purgeExpired(): Promise<{ records: number; files: number }> {
    const expired = await this.recycleBin.findExpired();
    if (!expired.length) return { records: 0, files: 0 };

    let files = 0;
    for (const item of expired) {
      const data = (item.entityData || {}) as any;
      for (const f of (data.files || []) as { to: string }[]) {
        try {
          if (f?.to && fs.existsSync(f.to)) {
            fs.unlinkSync(f.to);
            files++;
          }
        } catch (err) {
          this.logger.error(`删除过期回收文件失败：${(err as Error)?.message}`);
        }
      }
      try {
        fs.rmSync(path.join(this.trashDir, item.id), { recursive: true, force: true });
      } catch {
        // 目录可能本来就不存在（纯数据类回收记录），无害
      }
    }

    const records = await this.recycleBin.cleanup();
    this.logger.log(`回收站清理完成：记录 ${records} 条，文件 ${files} 个`);
    return { records, files };
  }
}
