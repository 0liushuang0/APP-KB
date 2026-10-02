import * as fs from 'fs';
import * as path from 'path';

/**
 * 日志文件轮转工具
 * 当日志文件超过指定大小时，自动轮转保留最近N个文件
 */
export function rotateLog(filePath: string, maxFiles = 5, maxSizeMB = 10): void {
  try {
    if (!fs.existsSync(filePath)) return;

    const stats = fs.statSync(filePath);
    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    if (stats.size < maxSizeBytes) return;

    // 删除最旧的备份
    const oldest = `${filePath}.${maxFiles}`;
    if (fs.existsSync(oldest)) {
      fs.unlinkSync(oldest);
    }

    // 重命名现有备份: .4 -> .5, .3 -> .4, ...
    for (let i = maxFiles - 1; i >= 1; i--) {
      const src = `${filePath}.${i}`;
      const dest = `${filePath}.${i + 1}`;
      if (fs.existsSync(src)) {
        fs.renameSync(src, dest);
      }
    }

    // 当前文件 -> .1
    fs.renameSync(filePath, `${filePath}.1`);

    // 创建新的空日志文件
    fs.writeFileSync(filePath, '', { flag: 'w' });
  } catch {
    // 轮转失败不应阻止应用启动
  }
}

/**
 * 获取日志文件路径（确保目录存在）
 */
export function ensureLogDir(logDir: string): void {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}
