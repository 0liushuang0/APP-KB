import { addDays, dateStr, daysUntil, dueStage, planReminders, reminderKey, reminderMessage, DuePaymentRow } from './payment-due';
import { PaymentDueScheduler } from './payment-due.scheduler';

const row = (over: Partial<DuePaymentRow>): DuePaymentRow => ({
  id: 'p1',
  contractId: 'c1',
  nodeName: '发货款',
  dueDate: '2026-10-20',
  dueAmount: 300000,
  contractNo: 'CON-2026-001',
  contractTitle: '圆盘剪',
  currency: 'CNY',
  ownerId: 'u1',
  ...over,
});

describe('回款到期提醒规则', () => {
  it('按日历日算天数，跨月不出错', () => {
    expect(daysUntil('2026-10-20', '2026-10-16')).toBe(4);
    expect(daysUntil('2026-11-01', '2026-10-31')).toBe(1);
    expect(daysUntil('2026-10-10', '2026-10-16')).toBe(-6);
    expect(addDays('2026-10-28', 7)).toBe('2026-11-04');
  });

  it('date 列两种形态都转成本地日期', () => {
    expect(dateStr('2026-10-20')).toBe('2026-10-20');
    expect(dateStr(new Date(2026, 9, 20))).toBe('2026-10-20');
    expect(dateStr(null)).toBeNull();
  });

  it('阶段：7 天内 / 今天 / 逾期按周，超过 4 周不再推', () => {
    expect(dueStage(8)).toBeNull();
    expect(dueStage(7)).toBe('soon');
    expect(dueStage(1)).toBe('soon');
    expect(dueStage(0)).toBe('today');
    expect(dueStage(-1)).toBe('overdue-w0');
    expect(dueStage(-7)).toBe('overdue-w0');
    expect(dueStage(-8)).toBe('overdue-w1');
    expect(dueStage(-28)).toBe('overdue-w3');
    expect(dueStage(-29)).toBeNull();
  });

  it('按负责人分组、跳过已提醒和没有负责人的，最急的排前面', () => {
    const rows = [
      row({ id: 'a', dueDate: '2026-10-20' }), // 4 天后
      row({ id: 'b', dueDate: '2026-10-10' }), // 逾期 6 天
      row({ id: 'c', dueDate: '2026-10-16', ownerId: 'u2' }), // 今天
      row({ id: 'd', dueDate: '2026-10-18', ownerId: null }), // 没负责人
      row({ id: 'e', dueDate: '2026-12-01' }), // 太远
      row({ id: 'f', dueDate: '2026-10-19' }), // 已提醒过
    ];
    const plan = planReminders(rows, '2026-10-16', new Set([reminderKey('f', 'soon')]));
    expect([...plan.keys()].sort()).toEqual(['u1', 'u2']);
    expect(plan.get('u1')!.map((i) => i.row.id)).toEqual(['b', 'a']);
    expect(plan.get('u1')![0].key).toBe('b:overdue-w0');
    expect(plan.get('u2')![0].key).toBe('c:today');
  });

  it('同一节点进入下一阶段会再提醒一次', () => {
    const r = [row({ id: 'a', dueDate: '2026-10-20' })];
    const sent = new Set([reminderKey('a', 'soon')]);
    expect(planReminders(r, '2026-10-17', sent).size).toBe(0); // 还在 7 天窗口
    expect(planReminders(r, '2026-10-20', sent).get('u1')![0].key).toBe('a:today');
  });

  it('通知文案：单笔写清是哪笔，多笔给总数并按币种显示金额', () => {
    const one = reminderMessage([{ row: row({}), key: 'p1:soon', daysLeft: 4 }]);
    expect(one.title).toBe('回款提醒：CON-2026-001 发货款4 天后到期');
    expect(one.content).toContain('¥300,000');
    const many = reminderMessage([
      { row: row({ id: 'x', currency: 'USD', dueAmount: 50000 }), key: 'x:overdue-w0', daysLeft: -3 },
      { row: row({ id: 'y' }), key: 'y:soon', daysLeft: 2 },
    ]);
    expect(many.title).toBe('回款提醒：2 笔回款需要跟进（1 笔已逾期）');
    expect(many.content.split('\n')).toHaveLength(2);
    expect(many.content).toContain('$50,000');
    expect(many.content).toContain('已逾期 3 天');
  });
});

describe('PaymentDueScheduler.runOnce', () => {
  const build = (opts: { sentKeys?: string[]; failNotify?: boolean } = {}) => {
    const inserted: any[] = [];
    const notified: any[] = [];
    const auditRepo = {
      createQueryBuilder: () => {
        const qb: any = {
          select: () => qb,
          where: () => qb,
          andWhere: () => qb,
          getRawMany: async () => (opts.sentKeys || []).map((objectId) => ({ objectId })),
        };
        return qb;
      },
      insert: async (r: any) => inserted.push(r),
    };
    const manager = { getRepository: () => auditRepo } as any;
    const payments = {
      manager,
      find: async () => [
        { id: 'p1', contractId: 'c1', nodeName: '发货款', dueDate: '2026-10-18', dueAmount: '100000.00' },
        { id: 'p2', contractId: 'c1', nodeName: '验收款', dueDate: '2026-10-12', dueAmount: '50000.00' },
        { id: 'p3', contractId: 'c2', nodeName: '首付款', dueDate: '2026-10-15', dueAmount: '10' },
      ],
    } as any;
    const contracts = {
      find: async () => [
        { id: 'c1', contractNo: 'CON-1', title: 'A', currency: 'CNY', ownerId: 'u1', status: 'executing' },
        { id: 'c2', contractNo: 'CON-2', title: 'B', currency: 'CNY', ownerId: 'u2', status: 'terminated' },
      ],
    } as any;
    const notifications = {
      create: async (n: any) => {
        if (opts.failNotify) throw new Error('db down');
        notified.push(n);
        return n;
      },
    } as any;
    const s = new PaymentDueScheduler(payments, contracts, notifications, {} as any);
    return { s, inserted, notified };
  };
  const now = new Date(2026, 9, 16, 9, 0);

  it('一位负责人一条通知，已终止合同不提醒，每笔记一条自动化记录', async () => {
    const { s, inserted, notified } = build();
    const r = await s.runOnce(now);
    expect(r).toEqual({ candidates: 2, sent: 2, owners: 1 });
    expect(notified).toHaveLength(1);
    expect(notified[0]).toMatchObject({ type: 'payment', recipientId: 'u1', linkUrl: '/contracts?focus=payment&owner=me' });
    expect(inserted.map((i) => i.objectId).sort()).toEqual(['p1:soon', 'p2:overdue-w0']);
    expect(inserted.every((i) => i.action === 'auto' && i.objectType === 'payment_reminded')).toBe(true);
  });

  it('已提醒过的阶段不再发', async () => {
    const { s, notified } = build({ sentKeys: ['p1:soon', 'p2:overdue-w0'] });
    expect((await s.runOnce(now)).sent).toBe(0);
    expect(notified).toHaveLength(0);
  });

  it('通知没发出去就不记，下一轮重试', async () => {
    const { s, inserted } = build({ failNotify: true });
    expect((await s.runOnce(now)).sent).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});
