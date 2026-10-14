import { execFileSync } from 'child_process';

/**
 * 列表接口契约测试：断言联动字段（客户名、附件计数）在返回里存在且形状正确。
 *
 * 背景：客户名/附件计数由各模块 attachRelations 逐行贴上，历史上整类失效过
 * （PG 别名折叠 → 全空；计数口径错 → 显示 2/5）。这类问题单测测不到
 * （要真库真链路），靠运行中的服务做契约锁定最直接。
 *
 * 运行条件：本机 13101 的后端在跑（开发机/部署机恒满足）。
 * 服务不在时自动跳过 —— CI 纯单测阶段不误报。
 */
const BASE = 'http://127.0.0.1:13101/api';
let serviceUp = false;
try {
  // 参数数组形式执行（不经 shell）；stdout 丢弃，退出码非 0 视为服务不在
  execFileSync('curl', ['-s', '-m', '2', `${BASE}/health`], { stdio: 'ignore' });
  serviceUp = true;
} catch {
  serviceUp = false;
}

const d = serviceUp ? describe : describe.skip;

async function login(): Promise<string> {
  const r = await fetch(`${BASE}/auth/single-mode-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const j: any = await r.json();
  return (j.data && (j.data.accessToken || j.data.token)) || j.accessToken || '';
}

async function list(token: string, ep: string): Promise<any[]> {
  const r = await fetch(`${BASE}/${ep}?pageSize=5`, { headers: { Authorization: `Bearer ${token}` } });
  expect(r.status).toBe(200);
  const j: any = await r.json();
  expect(j.success).toBe(true);
  return (j.data && j.data.list) || [];
}

d('契约：核心列表接口的联动字段', () => {
  let token = '';
  beforeAll(async () => {
    token = await login();
  });

  it.each([
    ['customers', 'attachmentTotal'],
    ['requirements', 'attachmentCounts'],
    ['proposals', 'attachmentCounts'],
    ['quotations', 'attachmentCounts'],
    ['contracts', 'attachmentCounts'],
    ['projects', 'attachmentCounts'],
    ['after-sales', 'attachmentCounts'],
  ])('%s 返回附件计数字段（且为数字）', async (ep, field) => {
    const rows = await list(token, ep);
    for (const row of rows) {
      if (field === 'attachmentTotal') {
        expect(typeof row.attachmentTotal).toBe('number');
      } else {
        expect(row.attachmentCounts).toBeTruthy();
        expect(typeof row.attachmentCounts.input).toBe('number');
        expect(typeof row.attachmentCounts.output).toBe('number');
      }
    }
  });

  it.each([
    ['requirements', 'customerName'],
    ['proposals', 'customerShortName'],
    ['quotations', 'customerShortName'],
    ['contracts', 'customerShortName'],
    ['projects', 'customerShortName'],
    ['after-sales', 'customerName'],
  ])('%s 返回客户名字段（键存在，链断时可为 null 但不能缺键）', async (ep, field) => {
    const rows = await list(token, ep);
    for (const row of rows) {
      expect(row).toHaveProperty(field);
    }
  });

  it('系统统计接口可用', async () => {
    const r = await fetch(`${BASE}/system/module-stats`, { headers: { Authorization: `Bearer ${token}` } });
    const j: any = await r.json();
    expect(j.success).toBe(true);
    expect(j.data).toHaveProperty('customers');
  });
});
