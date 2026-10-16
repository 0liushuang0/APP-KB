import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 文件归档类型
 */
export enum ArchiveType {
  /** 原始文件（客户上传的原始资料） */
  RAW = 'RAW',
  /** 整理后的文件（AI解析、翻译、格式化后的版本） */
  ORG = 'ORG',
  /** 需求文件（结构化需求卡、参数提取结果） */
  REQ = 'REQ',
  /** 方案文件 */
  PROPOSAL = 'PROPOSAL',
  /** 报价文件 */
  QUOTATION = 'QUOTATION',
}

/**
 * 客户文件夹结构：
 * data/uploads/customers/
 *   └── {customerId}/
 *       ├── RAW/          # 原始文件
 *       ├── ORG/          # 整理后文件
 *       ├── REQ/          # 需求文件
 *       ├── PROPOSAL/     # 方案文件
 *       └── QUOTATION/    # 报价文件
 */

@Injectable()
export class FileArchiveService {
  private readonly logger = new Logger(FileArchiveService.name);
  private readonly baseDir: string;

  constructor(private configService: ConfigService) {
    this.baseDir = path.resolve(
      process.cwd(),
      'data',
      'uploads',
      'customers',
    );
    this.ensureBaseDir();
  }

  private ensureBaseDir(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
      this.logger.log(`Created base archive directory: ${this.baseDir}`);
    }
  }

  /**
   * 获取客户的根目录
   */
  getCustomerDir(customerId: string): string {
    return path.join(this.baseDir, customerId);
  }

  /**
   * 获取客户特定类型文件的目录
   */
  getArchiveDir(customerId: string, archiveType: ArchiveType): string {
    const dir = path.join(this.baseDir, customerId, archiveType);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.logger.log(`Created archive directory: ${dir}`);
    }
    return dir;
  }

  /**
   * 归档文件到客户文件夹
   * @param customerId 客户ID
   * @param fileName 文件名
   * @param fileBuffer 文件内容
   * @param archiveType 归档类型
   * @returns 归档后的文件路径
   */
  async archiveFile(
    customerId: string,
    fileName: string,
    fileBuffer: Buffer,
    archiveType: ArchiveType = ArchiveType.RAW,
  ): Promise<string> {
    const archiveDir = this.getArchiveDir(customerId, archiveType);

    // 生成唯一文件名：时间戳_原始文件名
    const timestamp = Date.now();
    const uniqueFileName = `${timestamp}_${fileName}`;
    const filePath = path.join(archiveDir, uniqueFileName);

    // 写入文件
    fs.writeFileSync(filePath, fileBuffer);

    this.logger.log(
      `Archived file: ${filePath} (customer: ${customerId}, type: ${archiveType})`,
    );

    // 返回相对路径
    return path.relative(this.baseDir, filePath);
  }

  /**
   * 批量归档文件
   */
  async archiveFiles(
    customerId: string,
    files: Array<{ fileName: string; buffer: Buffer }>,
    archiveType: ArchiveType = ArchiveType.RAW,
  ): Promise<string[]> {
    const results: string[] = [];
    for (const file of files) {
      const filePath = await this.archiveFile(
        customerId,
        file.fileName,
        file.buffer,
        archiveType,
      );
      results.push(filePath);
    }
    return results;
  }

  /**
   * 获取客户的文件列表
   */
  getCustomerFiles(
    customerId: string,
    archiveType?: ArchiveType,
  ): Array<{ name: string; path: string; size: number; type: ArchiveType }> {
    const results: Array<{
      name: string;
      path: string;
      size: number;
      type: ArchiveType;
    }> = [];

    const customerDir = this.getCustomerDir(customerId);
    if (!fs.existsSync(customerDir)) {
      return results;
    }

    const types = archiveType
      ? [archiveType]
      : Object.values(ArchiveType);

    for (const type of types) {
      const typeDir = path.join(customerDir, type);
      if (!fs.existsSync(typeDir)) {
        continue;
      }

      const files = fs.readdirSync(typeDir);
      for (const file of files) {
        const filePath = path.join(typeDir, file);
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          results.push({
            name: file,
            path: path.relative(this.baseDir, filePath),
            size: stats.size,
            type,
          });
        }
      }
    }

    return results;
  }

  /**
   * 删除归档文件
   */
  deleteArchiveFile(customerId: string, relativePath: string): boolean {
    const filePath = path.join(this.baseDir, relativePath);

    // 安全检查：确保文件在客户目录下
    const customerDir = this.getCustomerDir(customerId);
    if (!filePath.startsWith(customerDir)) {
      this.logger.error(
        `Security check failed: file path not under customer directory`,
      );
      return false;
    }

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      this.logger.log(`Deleted archive file: ${filePath}`);
      return true;
    }

    return false;
  }

  /**
   * 移动文件到不同的归档类型
   */
  moveFile(
    customerId: string,
    sourceRelativePath: string,
    targetArchiveType: ArchiveType,
  ): string | null {
    const sourcePath = path.join(this.baseDir, sourceRelativePath);

    if (!fs.existsSync(sourcePath)) {
      this.logger.error(`Source file not found: ${sourcePath}`);
      return null;
    }

    const fileName = path.basename(sourceRelativePath);
    const targetDir = this.getArchiveDir(customerId, targetArchiveType);
    const targetPath = path.join(targetDir, fileName);

    fs.renameSync(sourcePath, targetPath);

    this.logger.log(
      `Moved file from ${sourceRelativePath} to ${targetArchiveType}/${fileName}`,
    );

    return path.relative(this.baseDir, targetPath);
  }

  /**
   * 获取客户的存储统计
   */
  getCustomerStorageStats(customerId: string): {
    totalFiles: number;
    totalSize: number;
    byType: Record<ArchiveType, { files: number; size: number }>;
  } {
    const stats = {
      totalFiles: 0,
      totalSize: 0,
      byType: {} as Record<ArchiveType, { files: number; size: number }>,
    };

    // 初始化各类型统计
    for (const type of Object.values(ArchiveType)) {
      stats.byType[type] = { files: 0, size: 0 };
    }

    const customerDir = this.getCustomerDir(customerId);
    if (!fs.existsSync(customerDir)) {
      return stats;
    }

    for (const type of Object.values(ArchiveType)) {
      const typeDir = path.join(customerDir, type);
      if (!fs.existsSync(typeDir)) {
        continue;
      }

      const files = fs.readdirSync(typeDir);
      for (const file of files) {
        const filePath = path.resolve(typeDir, file);
        // readdir 返回的名字理论受控，仍断言在目录内（防符号链接等意外）
        if (!filePath.startsWith(path.resolve(typeDir) + path.sep)) continue;
        const fileStats = fs.statSync(filePath);
        if (fileStats.isFile()) {
          stats.totalFiles++;
          stats.totalSize += fileStats.size;
          stats.byType[type].files++;
          stats.byType[type].size += fileStats.size;
        }
      }
    }

    return stats;
  }
}
