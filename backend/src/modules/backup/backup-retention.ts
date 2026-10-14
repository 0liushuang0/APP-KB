/**
 * 全量备份的保留与启动节奏（纯函数，便于单测）。
 *
 * 为什么不能「保留最近 N 份」：
 * 全量备份在每次进程启动后都会触发一次。频繁重启（发版、调试）的当天会产生一串间隔很近的备份，
 * 「最近 7 份」全部落在同一两小时内，几天前的备份就被挤掉了 —— 出了问题想回到昨天的状态时已经没有了。
 * 现在改为按自然日分层：先留最新一份，再依次每个有备份的日子各留当天最新的一份，直到凑够份数。
 */

export interface BackupLike {
  fileName: string;
  createdAt: Date;
}

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 返回应当保留的文件名集合（其余即可清理） */
export function selectBackupsToKeep(items: BackupLike[], keepCount: number): Set<string> {
  const sorted = [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const keep = new Set<string>();
  const seenDays = new Set<string>();
  for (const b of sorted) {
    if (keep.size >= Math.max(1, keepCount)) break;
    const k = dayKey(b.createdAt);
    if (seenDays.has(k)) continue; // 同一天只留最新的一份
    seenDays.add(k);
    keep.add(b.fileName);
  }
  // 天数不够凑满份数时(刚开始运行、历史短), 用当天更早的几份补足, 不浪费保留额度
  for (const b of sorted) {
    if (keep.size >= Math.max(1, keepCount)) break;
    keep.add(b.fileName);
  }
  return keep;
}

/**
 * 启动后首次全量备份的等待时间。
 * 距上一份全量备份不足一个间隔时，等到满间隔再做；否则最短 5 分钟（避免与启动争抢资源）。
 */
export function firstFullDelayMs(lastBackupAt: Date | null, intervalHours: number, now = new Date()): number {
  const minMs = 5 * 60 * 1000;
  if (!lastBackupAt) return minMs;
  const dueIn = lastBackupAt.getTime() + intervalHours * 3_600_000 - now.getTime();
  return Math.max(minMs, dueIn);
}
