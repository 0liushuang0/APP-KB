import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

/**
 * 事务封装。
 *
 * 背景：此前全库没有一处事务。报价的"主表 + 明细 + 审批流"、供应商的
 * "主表 + 能力 + 产品目录"这类多表写入若中途失败，会留下没有明细的报价单、
 * 没有能力项的供应商 —— 金额还在，业务上却是脏数据。
 *
 * 用法要点：
 *   · 事务内只做数据库写入
 *   · AI 同步、文件落盘、外部 HTTP 等副作用放到 afterCommit，
 *     否则一次 AI 服务超时会把整笔业务数据回滚掉
 */
@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * 在事务中执行一组数据库写入。
   *
   * @param work      事务体，拿到 EntityManager 后用 manager.getRepository(X) 操作
   * @param afterCommit 提交成功后才执行的副作用（AI 同步、通知等）。
   *                    这里抛错不会回滚事务，只记日志 —— 业务数据已经落库，
   *                    副作用失败不应该让用户以为保存失败了。
   */
  async run<T>(
    work: (manager: EntityManager) => Promise<T>,
    afterCommit?: (result: T) => Promise<void>,
  ): Promise<T> {
    const result = await this.dataSource.transaction(async (manager) => work(manager));

    if (afterCommit) {
      try {
        await afterCommit(result);
      } catch (err: any) {
        // 副作用失败不影响已提交的数据，但要留痕以便排查
        this.logger.error(`事务后置操作失败（数据已提交）：${err?.message}`, err?.stack);
      }
    }

    return result;
  }
}
