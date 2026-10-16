/**
 * 业务结果指标（纯函数，可测）——「系统替你做了什么」之外，回答「业务做得怎么样」：
 *   · 报价响应天数：需求时间 → 该需求第一份报价的报价日期
 *   · 需求→签约周期：需求时间 → 第一份签约合同的签订日
 *   · 赢单率：已签约需求 ÷（已签约 + 已丢单）
 *   · 丢单原因分布
 *   · 回款及时率：到期的回款节点里，按时（到期日当天及以前）收到的占比
 *
 * 数据可信度：历史单据多为 10-14/15 集中补录，创建时间不代表业务发生时间。
 * 所以每个周期指标都给出「样本数」和其中「两头都是真实业务日期」的条数（需求填了需求时间、报价填了报价日期、合同填了签订日）；
 * 只有补录日期的样本单独标出，界面上提示「按真实日期录入后才准」，不拿它冒充业务结论。
 */
export interface CReq { id: string; ownerId?: string | null; requirementDate?: any; createdAt?: any; status?: string | null; lossReason?: string | null; isCurrent?: boolean | null }
export interface CProp { id: string; requirementId?: string | null }
export interface CQuote { id: string; proposalId?: string | null; quotedAt?: any; createdAt?: any }
export interface CContract { id: string; quotationId?: string | null; signedDate?: any; createdAt?: any; status?: string | null }
export interface CPayment { contractId: string; dueDate?: any; receivedDate?: any; dueAmount?: any; receivedAmount?: any }

export interface CycleStat {
  /** 样本数 */
  n: number;
  /** 两头都是真实业务日期的样本数 */
  nReal: number;
  median: number | null;
  avg: number | null;
  /** 只按真实日期样本算的中位数（样本 ≥ 3 才给） */
  medianReal: number | null;
}

export interface CycleMetrics {
  windowDays: number;
  quoteResponse: CycleStat;
  reqToSign: CycleStat;
  winRate: { won: number; lost: number; rate: number | null };
  lossReasons: Array<{ reason: string; count: number }>;
  paymentOnTime: { due: number; onTime: number; rate: number | null; overdueOpen: number };
}

const DAY = 86_400_000;
const t = (v: any): number => (v ? new Date(v).getTime() : NaN);
const valid = (n: number) => !Number.isNaN(n);

function stat(samples: Array<{ days: number; real: boolean }>): CycleStat {
  const median = (arr: number[]) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
  };
  const all = samples.map((s) => s.days);
  const real = samples.filter((s) => s.real).map((s) => s.days);
  return {
    n: samples.length,
    nReal: real.length,
    median: median(all),
    avg: all.length ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10) / 10 : null,
    medianReal: real.length >= 3 ? median(real) : null,
  };
}

/**
 * @param windowDays 只统计「结束事件」（报价/签约/丢单/回款到期）落在最近 N 天内的样本；0 = 全部
 */
export function cycleMetrics(
  input: { reqs: CReq[]; props: CProp[]; quotes: CQuote[]; contracts: CContract[]; payments: CPayment[] },
  now = new Date(),
  windowDays = 180,
): CycleMetrics {
  const since = windowDays > 0 ? now.getTime() - windowDays * DAY : -Infinity;
  const inWindow = (ms: number) => valid(ms) && ms >= since && ms <= now.getTime() + DAY;
  const reqs = input.reqs.filter((r) => r.isCurrent !== false);
  const reqById = new Map(reqs.map((r) => [r.id, r]));
  const propReq = new Map<string, string>();
  for (const p of input.props) if (p.requirementId && reqById.has(p.requirementId)) propReq.set(p.id, p.requirementId);

  const reqStart = (r: CReq) => (valid(t(r.requirementDate)) ? { ms: t(r.requirementDate), real: true } : { ms: t(r.createdAt), real: false });

  // 每条需求的第一份报价
  const firstQuote = new Map<string, { ms: number; real: boolean; quoteId: string }>();
  const quoteReq = new Map<string, string>();
  for (const q of input.quotes) {
    const rid = q.proposalId ? propReq.get(q.proposalId) : undefined;
    if (!rid) continue;
    quoteReq.set(q.id, rid);
    const ms = valid(t(q.quotedAt)) ? t(q.quotedAt) : t(q.createdAt);
    if (!valid(ms)) continue;
    const cur = firstQuote.get(rid);
    if (!cur || ms < cur.ms) firstQuote.set(rid, { ms, real: valid(t(q.quotedAt)), quoteId: q.id });
  }

  const qSamples: Array<{ days: number; real: boolean }> = [];
  for (const [rid, q] of firstQuote) {
    const r = reqById.get(rid)!;
    const s = reqStart(r);
    if (!valid(s.ms) || !inWindow(q.ms)) continue;
    qSamples.push({ days: Math.max(0, (q.ms - s.ms) / DAY), real: s.real && q.real });
  }

  // 每条需求的第一份签约合同
  const firstSign = new Map<string, { ms: number; real: boolean }>();
  for (const c of input.contracts) {
    if (c.status === 'draft' || c.status === 'terminated') continue;
    const rid = c.quotationId ? quoteReq.get(c.quotationId) : undefined;
    if (!rid) continue;
    const ms = valid(t(c.signedDate)) ? t(c.signedDate) : t(c.createdAt);
    if (!valid(ms)) continue;
    const cur = firstSign.get(rid);
    if (!cur || ms < cur.ms) firstSign.set(rid, { ms, real: valid(t(c.signedDate)) });
  }
  const sSamples: Array<{ days: number; real: boolean }> = [];
  for (const [rid, c] of firstSign) {
    const s = reqStart(reqById.get(rid)!);
    if (!valid(s.ms) || !inWindow(c.ms)) continue;
    sSamples.push({ days: Math.max(0, (c.ms - s.ms) / DAY), real: s.real && c.real });
  }

  // 赢单率与丢单原因
  const won = [...firstSign.values()].filter((c) => inWindow(c.ms)).length;
  const lostReqs = reqs.filter((r) => r.status === 'lost' && inWindow(t((r as any).updatedAt) || t(r.createdAt)));
  const lost = lostReqs.length;
  const reasonCount = new Map<string, number>();
  for (const r of lostReqs) {
    const k = (r.lossReason || '').trim() || '未填原因';
    reasonCount.set(k, (reasonCount.get(k) || 0) + 1);
  }

  // 回款及时率：到期日已过（或今天到期）的节点
  let due = 0;
  let onTime = 0;
  let overdueOpen = 0;
  for (const p of input.payments) {
    const d = t(p.dueDate);
    if (!valid(d) || d > now.getTime() || !inWindow(d)) continue;
    due++;
    const rcv = t(p.receivedDate);
    if (valid(rcv) && rcv <= d + DAY - 1) onTime++;
    if (!valid(rcv)) overdueOpen++;
  }

  return {
    windowDays,
    quoteResponse: stat(qSamples),
    reqToSign: stat(sSamples),
    winRate: { won, lost, rate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null },
    lossReasons: [...reasonCount.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    paymentOnTime: { due, onTime, rate: due ? Math.round((onTime / due) * 100) : null, overdueOpen },
  };
}
