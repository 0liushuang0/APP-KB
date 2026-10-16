import { buildTimeline, parseFollowUpText } from './customer-timeline';

describe('客户统一时间线', () => {
  const users = new Map([['u1', '刘工']]);

  it('沟通、需求记录、任务、单据、资料、回款合成一条线，按时间倒序', () => {
    const events = buildTimeline({
      followUps: [{ id: 'f1', method: '微信', content: '客户确认宽度 1650', followUpAt: '2026-10-10T08:00:00Z', createdBy: 'u1', nextAction: '周五前报价' }],
      requirements: [{ id: 'r1', requirementNo: 'REQ-001', title: '拉矫机', requirementDate: '2026-10-01', createdAt: '2026-10-14T00:00:00Z' }],
      quotations: [{ id: 'q1', quotationNo: 'QUO-001', amount: 120000, currency: 'USD', createdAt: '2026-10-12T00:00:00Z' }],
      contracts: [{ id: 'c1', contractNo: 'CON-001', amount: 100, signedDate: '2026-10-15' }],
      payments: [{ id: 'p1', contractId: 'c1', receivedDate: '2026-10-16', receivedAmount: 30, nodeName: '预付款', contractNo: 'CON-001' }],
      logs: [{ id: 'l1', requirementId: 'r1', type: 'confirm', content: '客户确认技术参数', createdAt: '2026-10-11T00:00:00Z', actorName: '张三' }],
      tasks: [{ id: 't1', taskNo: 'WT-1', title: '拜访', status: 'done', workDate: '2026-10-09', ownerId: 'u1' }],
      documents: [{ id: 'd1', createdAt: '2026-10-13T00:00:00Z', stage: 'raw', document: { title: '技术协议.pdf' }, uploadedByName: '李四' }],
      users,
    });
    expect(events.map((e) => e.kind)).toEqual(['payment', 'contract', 'document', 'quotation', 'log', 'followup', 'task', 'requirement']);
    const f = events.find((e) => e.kind === 'followup')!;
    expect(f.actor).toBe('刘工');
    expect(f.detail).toContain('下一步：周五前报价');
    expect(events.find((e) => e.kind === 'quotation')!.title).toContain('$120,000');
    // 需求按业务日期（需求时间）排，不按补录时间
    expect(events.find((e) => e.kind === 'requirement')!.at.slice(0, 10)).toBe('2026-10-01');
    // 报价没填报价日期：按录入时间，并标记
    expect(events.find((e) => e.kind === 'quotation')!.entryDate).toBe(true);
  });

  it('单据修改：创建 2 分钟内的保存不算，同一单同一天只记一条，字段名翻成中文', () => {
    const events = buildTimeline({
      quotations: [{ id: 'q1', quotationNo: 'QUO-001', createdAt: '2026-10-12T00:00:00Z', quotedAt: null }],
      changes: [
        { id: 'a0', objectType: 'quotations', objectId: 'q1', detail: 'fields: items', createdAt: '2026-10-12T00:01:00Z' },
        { id: 'a1', objectType: 'quotations', objectId: 'q1', detail: 'fields: status, amount', createdAt: '2026-10-13T03:00:00Z', refNo: 'QUO-001' },
        { id: 'a2', objectType: 'quotations', objectId: 'q1', detail: 'fields: notes', createdAt: '2026-10-13T05:00:00Z', refNo: 'QUO-001' },
      ],
    });
    const changes = events.filter((e) => e.kind === 'change');
    expect(changes).toHaveLength(1);
    expect(changes[0].title).toBe('修改了报价 QUO-001');
    expect(changes[0].group).toBe('change');
  });
});

describe('粘贴邮件 / 聊天 → 沟通记录草稿', () => {
  it('邮件：方式、日期、客户方、下一步', () => {
    const d = parseFollowUpText(
      [
        'From: Rahul Sharma <rahul@jsw.in>',
        'To: 刘爽',
        'Date: 2026-10-14 09:30',
        'Subject: Tension leveller quotation',
        '',
        'Dear Liu, we are concerned about the delivery time.',
        'Please send the revised price by next Monday.',
      ].join('\n'),
      new Date('2026-10-16T00:00:00Z'),
    );
    expect(d.method).toBe('邮件');
    expect(d.followUpAt?.slice(0, 10)).toBe('2026-10-14');
    expect(d.customerParticipants).toContain('Rahul Sharma');
    expect(d.participants).toBe('刘爽');
    expect(d.content).toContain('【Tension leveller quotation】');
    expect(d.content).not.toMatch(/^From:/m);
    expect(d.nextAction).toContain('Please send the revised price');
    expect(d.focusPoints).toContain('delivery');
  });

  it('微信聊天：识别为微信，取聊天里的人', () => {
    const d = parseFollowUpText('王经理 10:32\n宽度改成 1650，下周安排技术交流\n刘爽 10:35\n好的，我们尽快出方案');
    expect(d.method).toBe('微信');
    expect(d.customerParticipants).toContain('王经理');
    expect(d.nextAction).toContain('下周安排技术交流');
  });

  it('普通文字默认记为电话，不编造日期', () => {
    const d = parseFollowUpText('客户来电询价，关注交期');
    expect(d.method).toBe('电话');
    expect(d.followUpAt).toBeNull();
    expect(d.focusPoints).toContain('交期');
  });
});
