/**
 * 客户统一时间线（纯函数，可测）。
 *
 * 原来客户互动散在三处：沟通记录（客户 360 只能看、没有录入口）、需求记录（在每条需求里）、
 * 工作任务（单独一页），单据的来龙去脉还得逐个页面翻。这里把同一客户发生过的一切按时间排成一条线：
 *   沟通 · 需求记录 · 工作任务 · 单据（需求/方案/报价/合同/项目/售后/回款）· 资料上传 · 单据修改
 */
import { fmtMoneyPlain } from './customer-timeline.format';

export type TimelineKind =
  | 'followup' | 'log' | 'task'
  | 'requirement' | 'proposal' | 'quotation' | 'contract' | 'payment' | 'project' | 'ticket'
  | 'document' | 'change';

/** 前端筛选用的大类 */
export const TIMELINE_GROUP: Record<TimelineKind, 'contact' | 'log' | 'task' | 'doc' | 'file' | 'change'> = {
  followup: 'contact',
  log: 'log',
  task: 'task',
  requirement: 'doc',
  proposal: 'doc',
  quotation: 'doc',
  contract: 'doc',
  payment: 'doc',
  project: 'doc',
  ticket: 'doc',
  document: 'file',
  change: 'change',
};

export interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  group: string;
  at: string;
  title: string;
  detail?: string;
  link?: string;
  actor?: string;
  /** 时间取的是录入时间（没填业务日期），提示「补录」 */
  entryDate?: boolean;
}

export interface TimelineSources {
  followUps?: any[];
  requirements?: any[];
  proposals?: any[];
  quotations?: any[];
  contracts?: any[];
  projects?: any[];
  tickets?: any[];
  documents?: any[];
  logs?: any[];
  tasks?: any[];
  payments?: any[];
  changes?: any[];
  /** userId → 显示名 */
  users?: Map<string, string>;
}

const LOG_TYPE: Record<string, string> = { communication: '沟通交流', change: '需求变更', confirm: '客户确认', other: '其他' };
const TASK_STATUS: Record<string, string> = { todo: '待办', doing: '进行中', done: '已完成', cancelled: '已取消' };
const STAGE: Record<string, string> = { raw: '原始资料', requirement: '需求', analysis: '分析', solution: '方案', quotation: '报价', contract: '合同' };
const OBJECT: Record<string, { label: string; path: string }> = {
  requirements: { label: '需求', path: '/requirements' },
  proposals: { label: '方案', path: '/proposals' },
  quotations: { label: '报价', path: '/quotations' },
  contracts: { label: '合同', path: '/contracts' },
  projects: { label: '项目', path: '/projects' },
  'after-sales': { label: '售后工单', path: '/after-sales' },
  customers: { label: '客户档案', path: '/customers' },
};
const FIELD: Record<string, string> = {
  status: '状态', title: '标题', name: '名称', amount: '金额', items: '明细', notes: '备注', description: '描述',
  priority: '优先级', paymentTerms: '付款条件', deliveryDays: '交货期', warrantyMonths: '质保期', signedDate: '签订日期',
  templateCategory: '产品类型', requirementDate: '需求时间', nextFollowUpDate: '下次跟进', contactName: '联系人',
  contactPhone: '联系电话', ownerId: '负责人', progress: '进度', endDate: '完工日期', startDate: '开工日期',
  level: '客户等级', region: '区域', businessStatus: '业务状态', spec: '结构化参数', currency: '币种',
};

const iso = (v: any): string | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const clip = (s: any, n = 120) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export function buildTimeline(src: TimelineSources, limit = 300): TimelineEvent[] {
  const users = src.users || new Map<string, string>();
  const who = (id?: string | null) => (id ? users.get(id) || undefined : undefined);
  const out: TimelineEvent[] = [];
  const push = (e: Omit<TimelineEvent, 'group'> & { at: string | null }) => {
    if (!e.at) return;
    out.push({ ...e, at: e.at, group: TIMELINE_GROUP[e.kind] });
  };

  for (const f of src.followUps || []) {
    const extra = [
      f.participants ? `我方：${f.participants}` : '',
      f.customerParticipants ? `客户方：${f.customerParticipants}` : '',
      f.focusPoints ? `关注：${f.focusPoints}` : '',
      f.nextAction ? `下一步：${f.nextAction}` : '',
    ].filter(Boolean).join('｜');
    push({
      id: `followup:${f.id}`, kind: 'followup', at: iso(f.followUpAt) || iso(f.createdAt),
      title: `${f.method || '沟通'}：${clip(f.content, 80)}`,
      detail: [clip(f.content, 600), extra].filter(Boolean).join('\n'),
      actor: who(f.createdBy),
    });
  }
  for (const r of src.requirements || []) {
    push({
      id: `requirement:${r.id}`, kind: 'requirement', at: iso(r.requirementDate) || iso(r.createdAt),
      entryDate: !r.requirementDate,
      title: `新需求 ${r.requirementNo || ''} ${r.title || ''}`.trim(),
      detail: [r.templateCategory ? `产品类型：${r.templateCategory}` : '', r.status ? `状态：${r.status}` : ''].filter(Boolean).join('｜'),
      link: `/requirements/${r.id}`, actor: who(r.ownerId),
    });
  }
  for (const p of src.proposals || []) {
    push({
      id: `proposal:${p.id}`, kind: 'proposal', at: iso(p.createdAt),
      title: `出方案 ${p.proposalNo || ''}`.trim(), link: `/proposals?highlight=${p.id}`, actor: who(p.ownerId),
    });
  }
  for (const q of src.quotations || []) {
    push({
      id: `quotation:${q.id}`, kind: 'quotation', at: iso(q.quotedAt) || iso(q.createdAt), entryDate: !q.quotedAt,
      title: `报价 ${q.quotationNo || ''} ${fmtMoneyPlain(q.amount, q.currency)}`.trim(),
      detail: q.status ? `状态：${q.status}` : undefined,
      link: `/quotations?highlight=${q.id}`, actor: who(q.ownerId),
    });
  }
  for (const c of src.contracts || []) {
    push({
      id: `contract:${c.id}`, kind: 'contract', at: iso(c.signedDate) || iso(c.createdAt), entryDate: !c.signedDate,
      title: `${c.signedDate ? '签约' : '合同起草'} ${c.contractNo || ''} ${fmtMoneyPlain(c.amount, c.currency)}`.trim(),
      detail: c.title || undefined, link: `/contracts?highlight=${c.id}`, actor: who(c.ownerId),
    });
  }
  for (const pay of src.payments || []) {
    push({
      id: `payment:${pay.id}`, kind: 'payment', at: iso(pay.receivedDate),
      title: `回款到账 ${fmtMoneyPlain(pay.receivedAmount ?? pay.dueAmount, pay.currency)}${pay.nodeName ? `（${pay.nodeName}）` : ''}`,
      detail: pay.contractNo ? `合同 ${pay.contractNo}` : undefined,
      link: pay.contractId ? `/contracts?highlight=${pay.contractId}` : undefined,
    });
  }
  for (const pj of src.projects || []) {
    push({
      id: `project:${pj.id}`, kind: 'project', at: iso(pj.startDate) || iso(pj.createdAt), entryDate: !pj.startDate,
      title: `项目立项 ${pj.projectNo || ''} ${pj.name || ''}`.trim(),
      link: `/projects?highlight=${pj.id}`, actor: who(pj.managerId),
    });
  }
  for (const t of src.tickets || []) {
    push({
      id: `ticket:${t.id}`, kind: 'ticket', at: iso(t.createdAt),
      title: `售后工单 ${t.ticketNo || ''} ${t.title || ''}`.trim(), detail: t.status ? `状态：${t.status}` : undefined,
      link: `/after-sales?highlight=${t.id}`,
    });
  }
  for (const d of src.documents || []) {
    const title = d.document?.title || d.document?.fileName || d.description || '资料';
    push({
      id: `document:${d.id}`, kind: 'document', at: iso(d.createdAt),
      title: `上传资料《${clip(title, 60)}》`, detail: d.stage ? `阶段：${STAGE[d.stage] || d.stage}` : undefined,
      actor: d.uploadedByName || who(d.uploadedBy),
    });
  }
  for (const l of src.logs || []) {
    push({
      id: `log:${l.id}`, kind: 'log', at: iso(l.createdAt),
      title: `需求记录 · ${LOG_TYPE[l.type] || l.type || '其他'}：${clip(l.content, 80)}`,
      detail: [l.requirementNo ? `需求 ${l.requirementNo}` : '', clip(l.content, 600)].filter(Boolean).join('\n'),
      link: l.requirementId ? `/requirements/${l.requirementId}` : undefined, actor: l.actorName || who(l.actorId),
    });
  }
  for (const t of src.tasks || []) {
    push({
      id: `task:${t.id}`, kind: 'task', at: iso(t.workDate) || iso(t.createdAt),
      title: `工作任务 ${t.taskNo || ''} ${t.title || ''}（${TASK_STATUS[t.status] || t.status || '—'}）`.replace(/\s+/g, ' ').trim(),
      detail: clip(t.content, 300) || undefined, link: `/work-tasks?highlight=${t.id}`, actor: who(t.ownerId),
    });
  }

  // 单据修改：同一张单据同一天只记一条；创建后 2 分钟内的保存属于新建流程本身，不算修改
  const created = new Map<string, number>();
  for (const e of out) {
    const [kind, id] = e.id.split(':');
    if (kind && id) created.set(id, new Date(e.at).getTime());
  }
  const seen = new Set<string>();
  for (const ch of src.changes || []) {
    const at = iso(ch.createdAt);
    if (!at || !ch.objectId) continue;
    const c0 = created.get(ch.objectId);
    if (c0 && Math.abs(new Date(at).getTime() - c0) < 120_000) continue;
    const key = `${ch.objectId}:${at.slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const obj = OBJECT[ch.objectType] || { label: ch.objectType, path: '' };
    const fields = String(ch.detail || '').replace(/^fields:\s*/, '').split(/,\s*/).filter(Boolean);
    push({
      id: `change:${ch.id}`, kind: 'change', at,
      title: `修改了${obj.label}${ch.refNo ? ` ${ch.refNo}` : ''}`,
      detail: fields.length ? `涉及：${fields.slice(0, 8).map((f) => FIELD[f] || f).join('、')}${fields.length > 8 ? ' 等' : ''}` : undefined,
      link: obj.path ? (ch.objectType === 'requirements' ? `${obj.path}/${ch.objectId}` : `${obj.path}?highlight=${ch.objectId}`) : undefined,
      actor: who(ch.userId),
    });
  }

  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export interface FollowUpDraft {
  method: string;
  followUpAt: string | null;
  participants: string;
  customerParticipants: string;
  content: string;
  focusPoints: string;
  nextAction: string;
  deadline: string | null;
}

/**
 * 粘贴的邮件 / 聊天记录 → 沟通记录草稿（规则版，不依赖大模型）。
 *  · 有 From/发件人/Subject/主题 → 邮件；有「昵称 时:分」式的聊天行 → 微信；
 *  · 邮件头里的日期 → 沟通日期；发件人/收件人 → 双方参与人；
 *  · 含「下一步 / 请尽快 / 下周 / 安排 / 跟进」的句子 → 下一步行动。
 * 大模型可用时由服务层再做一遍摘要与字段抽取，规则结果兜底。
 */
export function parseFollowUpText(raw: string, now = new Date()): FollowUpDraft {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  const lines = text.split('\n').map((l) => l.trim());
  const header = (re: RegExp) => {
    for (const l of lines.slice(0, 15)) {
      const m = l.match(re);
      if (m) return m[1].trim();
    }
    return '';
  };
  const from = header(/^(?:from|发件人|寄件人)\s*[:：]\s*(.+)$/i);
  const to = header(/^(?:to|收件人)\s*[:：]\s*(.+)$/i);
  const subject = header(/^(?:subject|主题)\s*[:：]\s*(.+)$/i);
  const dateText = header(/^(?:date|sent|发送时间|日期|时间)\s*[:：]\s*(.+)$/i);
  const isEmail = !!(from || subject);
  const chatLine = /^[^\s:：]{1,20}\s+(?:\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s+)?\d{1,2}:\d{2}(?::\d{2})?$/;
  const isChat = !isEmail && lines.filter((l) => chatLine.test(l)).length >= 1;

  let followUpAt: string | null = null;
  const d = dateText ? new Date(dateText.replace(/年|月/g, '-').replace(/日/g, '')) : null;
  if (d && !Number.isNaN(d.getTime())) followUpAt = d.toISOString();
  if (!followUpAt) {
    const m = text.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})/);
    if (m) {
      const dd = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
      if (dd.getTime() <= now.getTime() + 86400000) followUpAt = dd.toISOString();
    }
  }

  const body = lines
    .filter((l) => !/^(?:from|to|cc|subject|date|sent|发件人|收件人|抄送|主题|发送时间|寄件人)\s*[:：]/i.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const sentences = body.split(/(?<=[。！？!?；;\n])/).map((s) => s.trim()).filter(Boolean);
  const next = sentences.filter((s) => /下一步|请尽快|尽快|下周|明天|安排|跟进|回复|确认后|next step|please|kindly/i.test(s)).slice(0, 3);
  const focus = sentences.filter((s) => /关注|担心|要求|必须|希望|价格|交期|预算|质保|concern|require|budget|delivery|price/i.test(s)).slice(0, 3);

  const chatPeople = isChat
    ? [...new Set(lines.filter((l) => chatLine.test(l)).map((l) => l.split(/\s+/)[0]))].slice(0, 6).join('、')
    : '';
  const strip = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

  return {
    method: isEmail ? '邮件' : isChat ? '微信' : '电话',
    followUpAt,
    participants: '',
    customerParticipants: isEmail ? strip(from) : chatPeople,
    content: [subject ? `【${subject}】` : '', body].filter(Boolean).join('\n').slice(0, 4000),
    focusPoints: focus.join(' ').slice(0, 500),
    nextAction: next.join(' ').slice(0, 500),
    deadline: null,
    ...(isEmail && to ? { participants: strip(to) } : {}),
  };
}
