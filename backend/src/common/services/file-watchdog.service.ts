import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';

/**
 * 文件事件类型
 */
export enum FileEventType {
  ADDED = 'added',
  CHANGED = 'changed',
  DELETED = 'deleted',
}

/**
 * 文件事件
 */
export interface FileEvent {
  type: FileEventType;
  filePath: string;
  fileName: string;
  extension: string;
  timestamp: Date;
}

/**
 * 文件处理器接口
 */
export interface FileProcessor {
  canProcess(filePath: string): boolean;
  process(event: FileEvent): Promise<void>;
}

/**
 * 文件夹监控服务
 * 监控指定目录，自动处理新文件
 */
@Injectable()
export class FileWatchdogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FileWatchdogService.name);

  private watcher: chokidar.FSWatcher | null = null;
  private readonly watchDir: string;
  private readonly enabled: boolean;
  private processors: FileProcessor[] = [];
  private processingQueue: Map<string, Promise<void>> = new Map();

  constructor(private configService: ConfigService) {
    this.watchDir = this.configService.get<string>('WATCHDOG_DIR', './data/watchdog');
    this.enabled = this.configService.get<string>('WATCHDOG_ENABLED', 'false') === 'true';
  }

  async onModuleInit() {
    if (this.enabled) {
      await this.startWatching();
    } else {
      this.logger.log('File watchdog is disabled');
    }
  }

  async onModuleDestroy() {
    await this.stopWatching();
  }

  /**
   * 注册文件处理器
   */
  registerProcessor(processor: FileProcessor): void {
    this.processors.push(processor);
    this.logger.log(`Registered file processor: ${processor.constructor.name}`);
  }

  /**
   * 开始监控
   */
  async startWatching(): Promise<void> {
    // 确保监控目录存在
    if (!fs.existsSync(this.watchDir)) {
      fs.mkdirSync(this.watchDir, { recursive: true });
      this.logger.log(`Created watchdog directory: ${this.watchDir}`);
    }

    // 创建子目录结构
    const subDirs = ['inbox', 'processing', 'completed', 'failed'];
    for (const dir of subDirs) {
      const dirPath = path.join(this.watchDir, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }

    // 初始化 chokidar watcher
    this.watcher = chokidar.watch(path.join(this.watchDir, 'inbox'), {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
    });

    // 注册事件
    this.watcher
      .on('add', (filePath) => this.handleFileEvent(FileEventType.ADDED, filePath))
      .on('change', (filePath) => this.handleFileEvent(FileEventType.CHANGED, filePath))
      .on('unlink', (filePath) => this.handleFileEvent(FileEventType.DELETED, filePath))
      .on('error', (error) => this.logger.error(`Watcher error: ${error.message}`));

    this.logger.log(`Started watching directory: ${this.watchDir}/inbox`);
  }

  /**
   * 停止监控
   */
  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.logger.log('Stopped file watchdog');
    }
  }

  /**
   * 处理文件事件
   */
  private async handleFileEvent(type: FileEventType, filePath: string): Promise<void> {
    // 忽略目录
    if (fs.statSync(filePath).isDirectory()) {
      return;
    }

    const fileName = path.basename(filePath);
    const extension = path.extname(filePath).toLowerCase();

    const event: FileEvent = {
      type,
      filePath,
      fileName,
      extension,
      timestamp: new Date(),
    };

    this.logger.log(`File event: ${type} - ${fileName}`);

    // 只处理添加和修改事件
    if (type === FileEventType.ADDED || type === FileEventType.CHANGED) {
      await this.processFile(event);
    }
  }

  /**
   * 处理文件
   */
  private async processFile(event: FileEvent): Promise<void> {
    const { filePath } = event;

    // 检查是否正在处理
    if (this.processingQueue.has(filePath)) {
      this.logger.debug(`File already being processed: ${filePath}`);
      return;
    }

    // 查找合适的处理器
    const processor = this.processors.find(p => p.canProcess(filePath));
    if (!processor) {
      this.logger.warn(`No processor found for file: ${filePath}`);
      return;
    }

    // 移动到处理中目录
    const processingPath = path.join(
      this.watchDir,
      'processing',
      path.basename(filePath),
    );

    try {
      // 移动文件到处理目录
      fs.renameSync(filePath, processingPath);

      // 创建处理任务
      const processingPromise = this.executeProcessing(
        processor,
        { ...event, filePath: processingPath },
        filePath,
      );

      this.processingQueue.set(filePath, processingPromise);

      await processingPromise;
    } catch (error) {
      this.logger.error(`Failed to process file ${filePath}: ${error.message}`);
      this.moveToFailed(filePath);
    } finally {
      this.processingQueue.delete(filePath);
    }
  }

  /**
   * 执行处理
   */
  private async executeProcessing(
    processor: FileProcessor,
    event: FileEvent,
    originalPath: string,
  ): Promise<void> {
    try {
      await processor.process(event);

      // 移动到完成目录
      const completedPath = path.join(
        this.watchDir,
        'completed',
        path.basename(event.filePath),
      );
      fs.renameSync(event.filePath, completedPath);

      this.logger.log(`Successfully processed: ${event.fileName}`);
    } catch (error) {
      this.logger.error(`Processing failed for ${event.fileName}: ${error.message}`);
      this.moveToFailed(event.filePath);
      throw error;
    }
  }

  /**
   * 移动到失败目录
   */
  private moveToFailed(filePath: string): void {
    try {
      const failedPath = path.join(
        this.watchDir,
        'failed',
        path.basename(filePath),
      );

      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, failedPath);
      }
    } catch (error) {
      this.logger.error(`Failed to move file to failed directory: ${error.message}`);
    }
  }

  /**
   * 获取监控状态
   */
  getStatus(): {
    enabled: boolean;
    watchDir: string;
    isWatching: boolean;
    queueSize: number;
    processorCount: number;
  } {
    return {
      enabled: this.enabled,
      watchDir: this.watchDir,
      isWatching: this.watcher !== null,
      queueSize: this.processingQueue.size,
      processorCount: this.processors.length,
    };
  }

  /**
   * 获取各目录文件数量
   */
  getDirectoryStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    const dirs = ['inbox', 'processing', 'completed', 'failed'];

    for (const dir of dirs) {
      const dirPath = path.join(this.watchDir, dir);
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        stats[dir] = files.filter(f => {
          const filePath = path.join(dirPath, f);
          return fs.statSync(filePath).isFile();
        }).length;
      } else {
        stats[dir] = 0;
      }
    }

    return stats;
  }
}
