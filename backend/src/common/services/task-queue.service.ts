import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';

/**
 * 任务类型
 */
export enum TaskType {
  DOCUMENT_PARSE = 'document-parse',
  REQUIREMENT_ANALYZE = 'requirement-analyze',
  PROPOSAL_GENERATE = 'proposal-generate',
  TRANSLATION = 'translation',
  CUSTOMER_MATCH = 'customer-match',
}

/**
 * 任务状态
 */
export enum TaskStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * 任务结果
 */
export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  result?: any;
  error?: string;
  progress: number;
  createdAt: Date;
  completedAt?: Date;
}

/**
 * 异步任务队列服务
 */
@Injectable()
export class TaskQueueService {
  private readonly logger = new Logger(TaskQueueService.name);

  constructor(
    @InjectQueue('ai-tasks') private readonly aiTaskQueue: Queue,
  ) {}

  /**
   * 添加任务到队列
   */
  async addTask(
    type: TaskType,
    data: any,
    options: {
      priority?: number;
      delay?: number;
      attempts?: number;
    } = {},
  ): Promise<string> {
    const job = await this.aiTaskQueue.add(type, data, {
      priority: options.priority || 0,
      delay: options.delay || 0,
      attempts: options.attempts || 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });

    this.logger.log(`Added task ${job.id} of type ${type}`);
    return job.id;
  }

  /**
   * 获取任务状态
   */
  async getTaskStatus(taskId: string): Promise<TaskResult | null> {
    const job = await this.aiTaskQueue.getJob(taskId);

    if (!job) {
      return null;
    }

    const state = await job.getState();
    const progress = job.progress as number || 0;

    return {
      taskId: job.id,
      status: this.mapJobState(state),
      result: job.returnvalue,
      error: job.failedReason,
      progress,
      createdAt: new Date(job.timestamp),
      completedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
    };
  }

  /**
   * 映射任务状态
   */
  private mapJobState(state: string): TaskStatus {
    switch (state) {
      case 'waiting':
      case 'delayed':
        return TaskStatus.PENDING;
      case 'active':
        return TaskStatus.PROCESSING;
      case 'completed':
        return TaskStatus.COMPLETED;
      case 'failed':
        return TaskStatus.FAILED;
      default:
        return TaskStatus.PENDING;
    }
  }

  /**
   * 获取队列统计
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.aiTaskQueue.getWaitingCount(),
      this.aiTaskQueue.getActiveCount(),
      this.aiTaskQueue.getCompletedCount(),
      this.aiTaskQueue.getFailedCount(),
      this.aiTaskQueue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * 清理完成的任务
   */
  async cleanCompletedJobs(grace: number = 3600000): Promise<number> {
    const jobs = await this.aiTaskQueue.clean(grace, 100, 'completed');
    this.logger.log(`Cleaned ${jobs.length} completed jobs`);
    return jobs.length;
  }

  /**
   * 清理失败的任务
   */
  async cleanFailedJobs(grace: number = 86400000): Promise<number> {
    const jobs = await this.aiTaskQueue.clean(grace, 100, 'failed');
    this.logger.log(`Cleaned ${jobs.length} failed jobs`);
    return jobs.length;
  }

  /**
   * 重试失败的任务
   */
  async retryFailedTask(taskId: string): Promise<boolean> {
    const job = await this.aiTaskQueue.getJob(taskId);

    if (!job) {
      return false;
    }

    const state = await job.getState();
    if (state === 'failed') {
      await job.retry();
      this.logger.log(`Retrying failed task ${taskId}`);
      return true;
    }

    return false;
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const job = await this.aiTaskQueue.getJob(taskId);

    if (!job) {
      return false;
    }

    const state = await job.getState();
    if (state === 'waiting' || state === 'delayed') {
      await job.remove();
      this.logger.log(`Cancelled task ${taskId}`);
      return true;
    }

    return false;
  }
}
