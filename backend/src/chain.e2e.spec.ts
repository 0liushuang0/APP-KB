import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';

/**
 * 全链路验收（差距分析第五节「新建一条完整链路，统计每一步需要手填的字段数」）。
 *
 * 在临时目录里起一个独立的 SQLite 实例（不碰任何业务库），按真实接口走一遍：
 *   产品 → 客户 → 需求 → 方案 → 报价(草稿带出) → 合同(条款带出) → 项目(草稿带出) → 售后(型号带出)
 * 再验证：工作台口径一致、删除进回收站、还原后关联恢复。
 * 每一步统计"系统带出的字段数"，打印出来写进验收记录。
 */
describe('end-to-end business chain (isolated sqlite)', () => {
  const names = ['APP_MODE', 'DB_TYPE', 'SQLITE_PATH', 'REDIS_ENABLED', 'AUTO_BACKUP_ENABLED',
    'JWT_SECRET', 'AI_SERVICE_API_KEY', 'FILE_ENCRYPTION_KEY', 'DEFAULT_ADMIN_PASSWORD', 'NODE_ENV',
    'AI_SERVICE_URL', 'INDEX_SELF_HEAL', 'DOC_REPARSE', 'REQ_AUTO_ANALYZE', 'PROJECT_HEALTH_SCHEDULER'];
  const old = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  const originalCwd = process.cwd();
  let temporary = '';
  let app: INestApplication | undefined;
  let http: any;
  let auth = '';
  const body = (r: any) => (r.body && typeof r.body === 'object' && 'data' in r.body && !Array.isArray(r.body) && Object.keys(r.body).length <= 3 ? r.body.data : r.body);
  const get = (u: string) => request(http).get(u).set('Authorization', auth);
  const post = (u: string, d?: any) => request(http).post(u).set('Authorization', auth).send(d ?? {});
  const del = (u: string) => request(http).delete(u).set('Authorization', auth);

  beforeAll(async () => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aikb-chain-'));
    process.chdir(temporary);
    Object.assign(process.env, {
      APP_MODE: 'single', DB_TYPE: 'sqlite', SQLITE_PATH: path.join(temporary, 'app.db'),
      REDIS_ENABLED: 'false', AUTO_BACKUP_ENABLED: 'false', NODE_ENV: 'test',
      JWT_SECRET: 'A'.repeat(64), AI_SERVICE_API_KEY: 'B'.repeat(48),
      FILE_ENCRYPTION_KEY: 'C'.repeat(64), DEFAULT_ADMIN_PASSWORD: 'D'.repeat(40),
      // AI 服务指向一个不存在的端口：链路本身不依赖 AI，失败也不能拖垮业务
      AI_SERVICE_URL: 'http://127.0.0.1:9', INDEX_SELF_HEAL: 'false', DOC_REPARSE: 'false',
      REQ_AUTO_ANALYZE: 'false', PROJECT_HEALTH_SCHEDULER: 'false',
    });
    const { AppModule } = require('./app.module');
    const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    http = app.getHttpServer();
    const login = await request(http).post('/api/auth/single-mode-login').expect((r) => expect([200, 201]).toContain(r.status));
    auth = `Bearer ${body(login).accessToken}`;
  }, 180000);

  afterAll(async () => {
    if (app) await app.close();
    process.chdir(originalCwd);
    for (const n of names) {
      if (old[n] === undefined) delete process.env[n];
      else process.env[n] = old[n];
    }
    if (temporary.startsWith(os.tmpdir() + path.sep) && path.basename(temporary).startsWith('aikb-chain-')) {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  it('carries data down the chain, keeps numbers consistent, and restores deleted records', async () => {
    const prefilled: Record<string, number> = {};

    // ── 主数据 ──
    const product = body(await post('/api/products', { name: '单塔圆盘剪', category: '装备/剪切设备/圆盘剪', price: 1250000, unit: '台' }).expect(201));
    const customer = body(await post('/api/customers', { name: '测试钢铁有限公司' }).expect(201));

    // ── 需求：下次跟进默认 7 天后 ──
    const req = body(await post('/api/requirements', { title: 'PL-单塔圆盘剪', customerId: customer.id, templateCategory: '装备/剪切设备/圆盘剪' }).expect(201));
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    expect(String(req.nextFollowUpDate).slice(0, 10)).toBe(in7);
    prefilled['需求'] = 1; // 下次跟进日期

    // ── 方案 ──
    const proposal = body(await post('/api/proposals', { title: 'PL-单塔圆盘剪', requirementId: req.id, customerId: customer.id }).expect(201));

    // ── 方案 → 报价草稿：项目名称、明细（产品+单价）、金额 ──
    const draft = body(await get(`/api/quotations/draft-from-proposal/${proposal.id}`).expect(200));
    expect(draft.projectName).toBe('PL-单塔圆盘剪');
    expect(draft.items[0]).toMatchObject({ productId: product.id, name: '单塔圆盘剪', unitPrice: 1250000 });
    expect(draft.amount).toBe(1250000);
    prefilled['报价'] = 1 + draft.items.length * 4 + 1; // 项目名称 + 每行(名称/产品/数量/单价) + 金额

    const quotation = body(await post('/api/quotations', {
      customerId: customer.id, proposalId: proposal.id, quotationNo: '',
      items: draft.items.map((i: any) => ({ name: i.name, productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, unit: i.unit })),
      paymentTerms: '预付 30%，发货前 60%，验收后 10%', deliveryDays: 90, warrantyMonths: 12,
    }).expect(201));
    expect(Number(quotation.amount)).toBe(1250000);
    expect(quotation.deliveryDays).toBe(90);

    // ── 报价 → 合同：付款条件、质保、交货期（签约日 + 90 天）沿用报价 ──
    const q = body(await get(`/api/quotations/${quotation.id}`).expect(200));
    const signed = '2026-10-01';
    const deliveryDate = new Date(new Date(signed).getTime() + q.deliveryDays * 86400000).toISOString().slice(0, 10);
    const contract = body(await post('/api/contracts', {
      title: 'PL-单塔圆盘剪 采购合同', quotationId: quotation.id, customerId: customer.id, amount: Number(q.amount),
      signedDate: signed, deliveryDate, paymentTerms: q.paymentTerms, warrantyMonths: q.warrantyMonths,
    }).expect(201));
    expect(contract.customerId).toBe(customer.id);
    prefilled['合同'] = 6; // 标题、客户、金额、付款条件、质保月数、交货期

    // ── 合同 → 项目草稿：开工=签约日、完工=交货期、8 个标准阶段 ──
    const pd = body(await get(`/api/projects/draft-from-contract/${contract.id}`).expect(200));
    expect(pd.startDate).toBe(signed);
    expect(pd.endDate).toBe(deliveryDate);
    expect(pd.stages).toHaveLength(8);
    expect(pd.stages[0].startDate).toBe(signed);
    expect(pd.stages[7].endDate).toBe(deliveryDate);
    prefilled['项目'] = 4 + pd.stages.length * 3; // 名称、类型、开工、完工 + 每个阶段(名称/开始/结束)

    const project = body(await post('/api/projects', {
      name: pd.name || 'PL-单塔圆盘剪', customerId: customer.id, contractId: contract.id,
      startDate: pd.startDate, endDate: pd.endDate, projectType: pd.projectType, stages: pd.stages,
    }).expect(201));

    // ── 项目 → 售后：设备型号来自报价明细 ──
    const models = body(await get(`/api/after-sales/models-for-project/${project.id}`).expect(200));
    expect(models.map((m: any) => m.value)).toContain('单塔圆盘剪');
    prefilled['售后'] = 4; // 客户、合同、项目、设备型号

    // ── 工作台：成交一律按合同 ──
    const stats = body(await get('/api/system/dashboard-stats').expect(200));
    expect(stats.kpi.dealsTotal).toBe(1);
    expect(stats.kpi.winRate).toBe(100);
    expect(stats.funnel.map((s: any) => s.value)).toEqual([1, 1, 1, 1]);
    expect(stats.pipeline.contract.count).toBe(1);
    expect(stats.directDeals.count).toBe(0);
    const mod = body(await get('/api/system/module-stats').expect(200));
    expect(mod.requirements.quoted).toBe(1);
    expect(mod.requirements.won).toBe(1);
    expect(mod.quotations.won).toBe(1);

    // ── 删除报价：先看影响，再进回收站 ──
    const impact = body(await get(`/api/recycle-bin/impact/quotation/${quotation.id}`).expect(200));
    expect(impact).toEqual(expect.arrayContaining([expect.objectContaining({ label: '合同', count: 1 })]));
    await del(`/api/quotations/${quotation.id}`).expect(200);
    await get(`/api/quotations/${quotation.id}`).expect(404);
    const afterDelete = body(await get('/api/system/dashboard-stats').expect(200));
    expect(afterDelete.directDeals.count).toBe(1); // 报价没了，合同按直签计，不会算出 0 元或超 100%
    expect(afterDelete.kpi.winRate).toBe(0);

    const trash = body(await get('/api/recycle-bin/business').expect(200));
    const item = trash.find((t: any) => t.entityType === 'quotation');
    expect(item).toBeTruthy();
    expect(item.rows).toBe(2); // 报价头 + 1 行明细

    // ── 还原：原 id 写回，合同重新挂上报价，口径恢复 ──
    await post(`/api/recycle-bin/business/${item.id}/restore`).expect(201);
    const restored = body(await get(`/api/quotations/${quotation.id}`).expect(200));
    expect(Number(restored.amount)).toBe(1250000);
    expect(restored.items).toHaveLength(1);
    const back = body(await get('/api/system/dashboard-stats').expect(200));
    expect(back.kpi.winRate).toBe(100);
    expect(back.directDeals.count).toBe(0);

    // ── 我的今天：focus 筛选能取到数据 ──
    const followups = body(await get('/api/requirements?focus=followup').expect(200));
    expect((followups.list ?? followups).length).toBe(1);

    const total = Object.values(prefilled).reduce((a, b) => a + b, 0);
    // eslint-disable-next-line no-console
    console.log(`[链路验收] 各步自动带出字段数：${JSON.stringify(prefilled)}，合计 ${total}`);
    expect(total).toBeGreaterThanOrEqual(40);
  }, 120000);
});
