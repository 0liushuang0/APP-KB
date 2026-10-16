/**
 * 回款到期提醒（纯函数，可测）。
 *
 * 原来回款到期只在「我的今天」里有个计数，不打开工作台就不知道；合同负责人要在到期前收到提醒。
 *
 * 每个未收款节点按距应收日的天数落到一个「阶段」，同一节点同一阶段只提醒一次：
 *   · soon        7 天内到期（第一次进入 7 天窗口时提醒）
 *   · today       今天到期
 *   · overdue-wN  逾期第 N+1 周（每周提醒一次，最多 4 次）
 * 逾期超过 4 周不再推送 —— 多半是收了款没登记，继续推只会让人习惯性忽略通知；
 * 这些节点仍在「我的今天 → 回款到期」里，周报也会列出。
 */

export const SOON_DAYS = 7;
export const OVERDUE_WEEKS = 4;

export interface DuePaymentRow {
  id: string;
  contractId: string;
  nodeName: string;
  /** YYYY-MM-DD */
  dueDate: string;
  dueAmount: number;
  contractNo?: string | null;
  contractTitle?: string | null;
  currency?: string | null;
  ownerId?: string | null;
}

export interface ReminderItem {
  row: DuePaymentRow;
  key: string;
  daysLeft: number;
}

/** date 列可能是 'YYYY-MM-DD' 字符串（SQLite）或本地零点的 Date（PG）；统一成本地日期字符串 */
export function dateStr(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v as string);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 两个 YYYY-MM-DD 之间相差的天数（due - today），按日历日算，不受时区影响 */
export function daysUntil(due: string, today: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(due) - t(today)) / 86_400_000);
}

export function addDays(day: string, n: number): string {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + n));
  return d.toISOString().slice(0, 10);
}

/** 当前该提醒的阶段；不在提醒范围内返回 null */
export function dueStage(daysLeft: number): string | null {
  if (daysLeft > SOON_DAYS) return null;
  if (daysLeft > 0) return 'soon';
  if (daysLeft === 0) return 'today';
  const week = Math.floor((-daysLeft - 1) / 7);
  return week < OVERDUE_WEEKS ? `overdue-w${week}` : null;
}

export const reminderKey = (paymentId: string, stage: string) => `${paymentId}:${stage}`;

/**
 * 算出这一轮要提醒的节点，按负责人分组。
 * 没有负责人的合同不提醒（没人可推），已经提醒过的（paymentId:阶段）跳过。
 */
export function planReminders(rows: DuePaymentRow[], today: string, alreadySent: Set<string>): Map<string, ReminderItem[]> {
  const out = new Map<string, ReminderItem[]>();
  for (const row of rows) {
    if (!row.ownerId || !row.dueDate) continue;
    const daysLeft = daysUntil(row.dueDate, today);
    const stage = dueStage(daysLeft);
    if (!stage) continue;
    const key = reminderKey(row.id, stage);
    if (alreadySent.has(key)) continue;
    const list = out.get(row.ownerId) || [];
    list.push({ row, key, daysLeft });
    out.set(row.ownerId, list);
  }
  // 最急的排前面：逾期最久 → 今天 → 即将到期
  for (const list of out.values()) list.sort((a, b) => a.daysLeft - b.daysLeft);
  return out;
}

const SYMBOL: Record<string, string> = { CNY: '¥', USD: '$', EUR: '€' };

export function whenText(daysLeft: number): string {
  if (daysLeft > 0) return `${daysLeft} 天后到期`;
  if (daysLeft === 0) return '今天到期';
  return `已逾期 ${-daysLeft} 天`;
}

/** 一位负责人一条通知：标题给总数与最急的情况，正文逐条列出（最多 8 条） */
export function reminderMessage(items: ReminderItem[]): { title: string; content: string } {
  const overdue = items.filter((i) => i.daysLeft < 0).length;
  const today = items.filter((i) => i.daysLeft === 0).length;
  const head = overdue ? `${overdue} 笔已逾期` : today ? `${today} 笔今天到期` : `${items.length} 笔 ${SOON_DAYS} 天内到期`;
  const title = items.length === 1 ? `回款提醒：${items[0].row.contractNo || items[0].row.contractTitle || '合同'} ${items[0].row.nodeName}${whenText(items[0].daysLeft)}` : `回款提醒：${items.length} 笔回款需要跟进（${head}）`;
  const lines = items.slice(0, 8).map(({ row, daysLeft }) => {
    const amount = Number(row.dueAmount || 0);
    const money = amount > 0 ? ` ${SYMBOL[row.currency || 'CNY'] || ''}${amount.toLocaleString('zh-CN')}` : '';
    const name = [row.contractNo, row.contractTitle].filter(Boolean).join(' ');
    return `· ${name} ${row.nodeName}${money}，应收 ${row.dueDate}，${whenText(daysLeft)}`;
  });
  if (items.length > 8) lines.push(`…另有 ${items.length - 8} 笔`);
  return { title: title.slice(0, 200), content: lines.join('\n') };
}
