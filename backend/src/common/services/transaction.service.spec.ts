import { DataSource, EntityManager } from 'typeorm';
import { TransactionService } from './transaction.service';

/**
 * 用假的 DataSource 验证 TransactionService 的语义：
 *   · 事务体抛错 → 整体回滚，afterCommit 不执行
 *   · 事务体成功 → afterCommit 执行
 *   · afterCommit 抛错 → 不影响已提交的结果（只记日志）
 *
 * 真正的回滚行为由 TypeORM/SQLite 保证，这里验证的是我们的封装没有把它用错。
 */
function makeDataSource(): { ds: DataSource; committed: boolean[] } {
  const committed: boolean[] = [];
  const ds = {
    async transaction(work: (m: EntityManager) => Promise<any>) {
      // 模拟 TypeORM：work 抛错则不提交并向上抛
      try {
        const r = await work({} as EntityManager);
        committed.push(true);
        return r;
      } catch (err) {
        committed.push(false);
        throw err;
      }
    },
  } as unknown as DataSource;
  return { ds, committed };
}

describe('TransactionService', () => {
  it('事务体成功时提交并执行 afterCommit', async () => {
    const { ds, committed } = makeDataSource();
    const svc = new TransactionService(ds);
    const after = jest.fn().mockResolvedValue(undefined);

    const result = await svc.run(async () => 'ok', after);

    expect(result).toBe('ok');
    expect(committed).toEqual([true]);
    expect(after).toHaveBeenCalledWith('ok');
  });

  it('事务体抛错时不提交，且 afterCommit 不执行', async () => {
    const { ds, committed } = makeDataSource();
    const svc = new TransactionService(ds);
    const after = jest.fn();

    await expect(
      svc.run(async () => {
        throw new Error('明细写入失败');
      }, after),
    ).rejects.toThrow('明细写入失败');

    expect(committed).toEqual([false]);
    // 关键：数据没落库时绝不能去同步知识库或发通知
    expect(after).not.toHaveBeenCalled();
  });

  it('afterCommit 失败不影响已提交的结果', async () => {
    const { ds } = makeDataSource();
    const svc = new TransactionService(ds);
    jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);

    // AI 同步超时属于此类：业务数据已经存好了，不该让用户以为保存失败
    const result = await svc.run(
      async () => ({ id: 'q1' }),
      async () => {
        throw new Error('AI 服务超时');
      },
    );

    expect(result).toEqual({ id: 'q1' });
  });

  it('没有 afterCommit 时也能正常返回', async () => {
    const { ds, committed } = makeDataSource();
    const svc = new TransactionService(ds);
    await expect(svc.run(async () => 42)).resolves.toBe(42);
    expect(committed).toEqual([true]);
  });
});
