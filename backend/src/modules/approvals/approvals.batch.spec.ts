import { ApprovalsService } from './approvals.service';

/** 审批中心: 列表带对象标题、批量通过、通过后回调(资料据此建索引) */
function make(flows: any[], titleRows: any[] = []) {
  const repo: any = {
    find: jest.fn(async () => flows),
    findOne: jest.fn(async ({ where }: any) => flows.find((f) => f.id === where.id) || null),
    save: jest.fn(async (f: any) => f),
  };
  const ds: any = { query: jest.fn(async (sql: string) => (sql.startsWith('SELECT') ? titleRows : [])) };
  const notifications: any = { create: jest.fn(async () => ({})) };
  return { svc: new ApprovalsService(repo, notifications, ds), repo, ds };
}

describe('ApprovalsService (approval center)', () => {
  it('adds object titles and document categories to list rows', async () => {
    const flows = [
      { id: 'a1', objectType: 'document', objectId: 'd1', status: 'pending' },
      { id: 'a2', objectType: 'customer', objectId: 'c1', status: 'pending' },
    ];
    const { svc, ds } = make(flows, [
      { id: 'd1', title: '宝钢联轴器 · 设备技术需求规格书', category: 'knowledge/workflow_import' },
      { id: 'c1', title: '宝山钢铁股份有限公司' },
    ]);
    const rows = await svc.findAll({ status: 'pending' });
    expect(rows.map((r) => r.objectTitle)).toEqual(['宝钢联轴器 · 设备技术需求规格书', '宝山钢铁股份有限公司']);
    expect(rows[0].objectCategory).toBe('knowledge/workflow_import');
    expect(ds.query).toHaveBeenCalledTimes(2); // 每种类型一条查询
  });

  it('approves many, skipping ones already handled, and fires approved callbacks per object type', async () => {
    const flows = [
      { id: 'a1', objectType: 'document', objectId: 'd1', status: 'pending' },
      { id: 'a2', objectType: 'document', objectId: 'd2', status: 'approved' },
      { id: 'a3', objectType: 'customer', objectId: 'c1', status: 'pending' },
    ];
    const { svc } = make(flows);
    const indexed: string[] = [];
    svc.onApproved('document', async (id) => { indexed.push(id); });
    const r = await svc.approveMany(['a1', 'a2', 'a3', 'a1'], 'u1');
    expect(r).toEqual({ approved: 2, skipped: 1 });
    expect(indexed).toEqual(['d1']); // 只有资料类型触发, 已处理的不重复
  });

  it('a failing callback does not break approval', async () => {
    const { svc } = make([{ id: 'a1', objectType: 'document', objectId: 'd1', status: 'pending' }]);
    svc.onApproved('document', async () => { throw new Error('ai offline'); });
    await expect(svc.approveById('a1', 'u1')).resolves.toMatchObject({ status: 'approved' });
  });
});
