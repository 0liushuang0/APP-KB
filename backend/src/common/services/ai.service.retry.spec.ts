import { AiService } from './ai.service';

/** 解析请求只对瞬时错误重试(连接重置/超时/5xx), 确定性错误(422)不重试 */
function make(post: jest.Mock): AiService {
  const svc: any = Object.create(AiService.prototype);
  svc.client = { post };
  svc.logger = { warn: jest.fn(), error: jest.fn() };
  return svc as AiService;
}
const err = (o: any) => Object.assign(new Error('x'), o);

describe('AiService.parseFileDetailed retry', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('retries ECONNRESET and 5xx, then succeeds', async () => {
    const post = jest.fn()
      .mockRejectedValueOnce(err({ code: 'ECONNRESET' }))
      .mockRejectedValueOnce(err({ response: { status: 502 } }))
      .mockResolvedValueOnce({ data: { text: '解析出的正文' } });
    const p = make(post).parseFileDetailed('a.docx', 'QUJD');
    await jest.runAllTimersAsync();
    await expect(p).resolves.toEqual({ text: '解析出的正文' });
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('does not retry 422 (file cannot be parsed) and passes the reason through', async () => {
    const post = jest.fn().mockRejectedValue(err({ response: { status: 422, data: { detail: '未能提取出可读文本' } } }));
    const r = await make(post).parseFileDetailed('a.pdf', 'QUJD');
    expect(r).toEqual({ text: '', error: '未能提取出可读文本' });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('gives up after 3 attempts with a friendly message', async () => {
    const post = jest.fn().mockRejectedValue(err({ code: 'ECONNABORTED' }));
    const p = make(post).parseFileDetailed('a.docx', 'QUJD');
    await jest.runAllTimersAsync();
    const r = await p;
    expect(r.text).toBe('');
    expect(r.error).toMatch(/AI 服务/);
    expect(post).toHaveBeenCalledTimes(3);
  });
});
