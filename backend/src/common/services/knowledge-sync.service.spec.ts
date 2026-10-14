import { KnowledgeSyncService } from './knowledge-sync.service';

/** 向量同步在后台排队: 保存接口不等嵌入模型(原先慢时前端 30 秒超时) */
describe('KnowledgeSyncService', () => {
  const obj = { id: 'p1', objectType: 'product', title: '球笼式联轴器', content: '球笼式联轴器 标准型' };

  it('returns immediately even when the AI service hangs', async () => {
    const ai: any = { deleteChunks: jest.fn(() => new Promise(() => undefined)), addChunks: jest.fn() };
    const svc = new KnowledgeSyncService(ai);
    const started = Date.now();
    await svc.syncObject(obj);
    await svc.deleteObject('product', 'p2');
    expect(Date.now() - started).toBeLessThan(100);
    expect(ai.addChunks).not.toHaveBeenCalled();
  });

  it('runs jobs of one object in order (delete old chunks, then add new) and flush waits for them', async () => {
    const calls: string[] = [];
    const ai: any = {
      deleteChunks: jest.fn(async (t: string, id: string) => {
        await new Promise((r) => setTimeout(r, 20));
        calls.push(`del ${t}:${id}`);
      }),
      addChunks: jest.fn(async (chunks: any[]) => {
        calls.push(`add ${chunks[0].source_id} ${chunks[0].content.split('\n')[1]}`);
        return { indexed: chunks.length, skipped: 0 };
      }),
    };
    const svc = new KnowledgeSyncService(ai);
    await svc.syncObject(obj);
    await svc.syncObject({ ...obj, content: '第二次保存' });
    await svc.flush();
    expect(calls).toEqual(['del product:p1', 'add p1 球笼式联轴器 标准型', 'del product:p1', 'add p1 第二次保存']);
  });

  it('logs failures instead of throwing', async () => {
    const ai: any = { deleteChunks: jest.fn(async () => { throw new Error('down'); }), addChunks: jest.fn() };
    const svc = new KnowledgeSyncService(ai);
    await expect(svc.syncObject(obj)).resolves.toBeUndefined();
    await expect(svc.flush()).resolves.toBeUndefined();
  });
});
