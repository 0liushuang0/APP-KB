import { DynamicModule, Module, Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  TaskQueueService,
  TaskType,
  TaskStatus,
  TaskResult,
} from './task-queue.service';
import { AiTaskProcessor } from './task-processor.service';

/**
 * 任务队列模块。
 *
 * BullMQ 依赖 Redis，而单机个人版（默认）不带 Redis。之前模块无条件注册
 * BullModule.forRootAsync，导致每次启动都尝试连 localhost:6379 并失败；
 * 加上 AiTaskProcessor 全是 TODO，真正的 AI 调用走 axios 同步，队列从未被用到。
 *
 * 现在改为按需启用：仅当显式设置 REDIS_ENABLED=true 时才接入 BullMQ，
 * 否则注册一个 NoopTaskQueueService（绑定到 TaskQueueService 令牌），调用时仅
 * 记日志而不报错——单机版本不需要异步队列。
 *
 * 注意：NoopTaskQueueService 不能 extends TaskQueueService，因为后者构造函数
 * 用 @InjectQueue('ai-tasks') 注入，在无 BullModule 时会失败。这里用独立类实现
 * 同样的方法签名，通过 useClass 绑定到 TaskQueueService 令牌即可。
 */
class NoopTaskQueueService {
  private readonly logger = new Logger('NoopTaskQueue');

  async addTask(type: TaskType): Promise<string> {
    this.logger.warn(
      `addTask(${type}) 被调用但未启用 Redis（REDIS_ENABLED!=true），任务已丢弃。`,
    );
    return '';
  }
  async getTaskStatus(): Promise<TaskResult | null> {
    return null;
  }
  async getQueueStats() {
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
  }
  async cleanCompletedJobs(): Promise<number> {
    return 0;
  }
  async cleanFailedJobs(): Promise<number> {
    return 0;
  }
  async retryFailedTask(): Promise<boolean> {
    return false;
  }
  async cancelTask(): Promise<boolean> {
    return false;
  }
}

@Module({})
export class TaskQueueModule {
  /**
   * 根据 REDIS_ENABLED 环境变量决定是否接入 BullMQ。
   * - true：注册 BullModule + 真实 TaskQueueService + AiTaskProcessor
   * - 其它：注册 NoopTaskQueueService 绑定到 TaskQueueService 令牌
   */
  static register(): DynamicModule {
    const redisEnabled = process.env.REDIS_ENABLED === 'true';

    if (!redisEnabled) {
      return {
        module: TaskQueueModule,
        providers: [{ provide: TaskQueueService, useClass: NoopTaskQueueService }],
        exports: [TaskQueueService],
      };
    }

    return {
      module: TaskQueueModule,
      imports: [
        BullModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: async (configService: ConfigService) => ({
            connection: {
              host: configService.get<string>('REDIS_HOST', 'localhost'),
              port: configService.get<number>('REDIS_PORT', 6379),
              password: configService.get<string>('REDIS_PASSWORD') || undefined,
            },
          }),
          inject: [ConfigService],
        }),
        BullModule.registerQueue({ name: 'ai-tasks' }),
      ],
      providers: [TaskQueueService, AiTaskProcessor],
      exports: [TaskQueueService],
      // AiTaskProcessor 通过 @Processor 装饰器自动绑定，BullModule 注册后即可发现
    };
  }
}
