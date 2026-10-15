/**
 * 业务口径（纯函数）—— 工作台、各列表页统计卡共用一份定义。
 *
 * 原来同一屏上"成交"有三套算法：流水线按合同（2 个 / 296 万）、漏斗按项目 dealStage=won（4 个）、
 * "本月成交额"按 won 项目所关联报价的金额（报价已删 → 0 元），成单率因此显示 400%。
 *
 * 统一定义：
 *   成交 = 签约合同；成交金额 = 合同金额；成交时间 = 签约日（没填用创建日）
 *   漏斗 = 按需求实际走到哪一步：需求 → 出方案 → 已报价 → 已签约（逐级不可能变大）
 *   直签 = 没走报价直接签的合同，单独计数，不混进漏斗
 *   成单率 = 已签约的报价 ÷ 全部报价（≤ 100%）
 */
export interface MReq { id: string; status?: string | null; isCurrent?: boolean | null; createdAt?: any; expectedAmount?: any }
export interface MProp { id: string; requirementId?: string | null }
export interface MQuote { id: string; proposalId?: string | null; amount?: any; status?: string | null; createdAt?: any; updatedAt?: any }
export interface MContract { id: string; quotationId?: string | null; amount?: any; signedDate?: any; createdAt?: any; status?: string | null }

const num = (v: any) => Number(v || 0) || 0;
const time = (v: any) => (v ? new Date(v).getTime() : NaN);

export function dealDate(c: MContract): Date | null {
  const t = time(c.signedDate);
  if (!Number.isNaN(t)) return new Date(t);
  const t2 = time(c.createdAt);
  return Number.isNaN(t2) ? null : new Date(t2);
}

export interface ChainFacts {
  reqWithProposal: Set<string>;
  reqQuoted: Set<string>;
  reqSigned: Set<string>;
  quoteSigned: Set<string>;
  directContracts: MContract[];
  chainContracts: MContract[];
}

/** 沿 需求 → 方案 → 报价 → 合同 的 id 链推出每张单据走到了哪一步 */
export function chainFacts(reqs: MReq[], props: MProp[], quotes: MQuote[], contracts: MContract[]): ChainFacts {
  const reqIds = new Set(reqs.map((r) => r.id));
  const quoteIds = new Set(quotes.map((q) => q.id));
  const propToReq = new Map<string, string>();
  for (const p of props) if (p.requirementId && reqIds.has(p.requirementId)) propToReq.set(p.id, p.requirementId);
  const quoteToReq = new Map<string, string>();
  for (const q of quotes) {
    const r = q.proposalId ? propToReq.get(q.proposalId) : undefined;
    if (r) quoteToReq.set(q.id, r);
  }
  const reqWithProposal = new Set(propToReq.values());
  const reqQuoted = new Set(quoteToReq.values());
  const reqSigned = new Set<string>();
  const quoteSigned = new Set<string>();
  const directContracts: MContract[] = [];
  const chainContracts: MContract[] = [];
  for (const c of contracts) {
    if (c.quotationId && quoteIds.has(c.quotationId)) {
      quoteSigned.add(c.quotationId);
      chainContracts.push(c);
      const r = quoteToReq.get(c.quotationId);
      if (r) reqSigned.add(r);
    } else {
      directContracts.push(c); // 没走报价（或所挂报价已删除）的直签合同
    }
  }
  return { reqWithProposal, reqQuoted, reqSigned, quoteSigned, directContracts, chainContracts };
}

export interface FunnelStage { stage: string; value: number; amount: number; rate: number }

export function buildFunnel(reqs: MReq[], props: MProp[], quotes: MQuote[], contracts: MContract[]) {
  const active = reqs.filter((r) => r.isCurrent !== false && r.status !== 'lost');
  const f = chainFacts(active, props, quotes, contracts);
  const reqAmount = (ids: Set<string> | null) =>
    active.filter((r) => !ids || ids.has(r.id)).reduce((s, r) => s + num(r.expectedAmount), 0);
  const quotedAmount = quotes
    .filter((q) => {
      const p = props.find((x) => x.id === q.proposalId);
      return !!p?.requirementId && f.reqQuoted.has(p.requirementId);
    })
    .reduce((s, q) => s + num(q.amount), 0);
  const signedAmount = f.chainContracts.reduce((s, c) => s + num(c.amount), 0);
  const base = active.length;
  const rate = (v: number) => (base > 0 ? Math.round((v / base) * 100) : 0);
  const stages: FunnelStage[] = [
    { stage: '需求', value: base, amount: reqAmount(null), rate: base ? 100 : 0 },
    { stage: '出方案', value: f.reqWithProposal.size, amount: reqAmount(f.reqWithProposal), rate: rate(f.reqWithProposal.size) },
    { stage: '已报价', value: f.reqQuoted.size, amount: quotedAmount, rate: rate(f.reqQuoted.size) },
    { stage: '已签约', value: f.reqSigned.size, amount: signedAmount, rate: rate(f.reqSigned.size) },
  ];
  return {
    stages,
    direct: { count: f.directContracts.length, amount: f.directContracts.reduce((s, c) => s + num(c.amount), 0) },
  };
}

export function winRate(quotes: MQuote[], contracts: MContract[]): number {
  if (!quotes.length) return 0;
  const ids = new Set(quotes.map((q) => q.id));
  const signed = new Set(contracts.filter((c) => c.quotationId && ids.has(c.quotationId)).map((c) => c.quotationId));
  return Math.min(100, Math.round((signed.size / quotes.length) * 100));
}

export function dealsBetween(contracts: MContract[], from: Date, to?: Date) {
  const rows = contracts.filter((c) => {
    const d = dealDate(c);
    return !!d && d.getTime() >= from.getTime() && (!to || d.getTime() < to.getTime());
  });
  return { count: rows.length, amount: rows.reduce((s, c) => s + num(c.amount), 0) };
}

/** 近 N 个月：报价额/单数 与 签约额/单数，两条序列同一口径 */
export function monthlyTrend(quotes: MQuote[], contracts: MContract[], now: Date, months = 6) {
  const out: Array<{ month: string; quoteAmount: number; quoteCount: number; dealAmount: number; dealCount: number }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const qs = quotes.filter((q) => {
      const t = time(q.createdAt);
      return t >= from.getTime() && t < to.getTime();
    });
    const d = dealsBetween(contracts, from, to);
    out.push({
      month: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`,
      quoteAmount: qs.reduce((s, q) => s + num(q.amount), 0),
      quoteCount: qs.length,
      dealAmount: d.amount,
      dealCount: d.count,
    });
  }
  return out;
}

/** 环比：上期为 0 时不算百分比 */
export function delta(cur: number, prev: number): number | null {
  return prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10;
}
