import { Global, Module } from '@nestjs/common';
import { JobLockService } from './job-lock.service';

/** 定时任务分布式锁，全局可注入（各模块的调度器直接在构造函数里要 JobLockService） */
@Global()
@Module({
  providers: [JobLockService],
  exports: [JobLockService],
})
export class JobLockModule {}
