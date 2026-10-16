/**
 * 报价明细的成本估算（纯函数，可测）。
 *
 * 原来报价明细 0 行有成本、毛利无从计算：成本只能逐行手填，而供应商产品 595 条与产品库 0 映射。
 * 现在按以下顺序自动带出（每一步都说明来源，给人核对）：
 *   1. 型号价格表里该型号的「成本价」（业务维护的内部成本，最准）；
 *   2. 映射到该产品的供应产品的采购价：有询价记录取最近一次实际报价，否则取目录价区间中值；
 *      映射了多家时取最高的那家 —— 宁可毛利算低，也不让毛利虚高；外币按汇率折人民币；
 *   3. 产品 BOM 每行都有成本时，按 Σ(成本 × 用量) 汇总。
 * 都没有就留空，前端提示「缺成本」。
 */
import { toCny } from '../../common/utils/currency.util';

export interface CostPriceItem {
  model?: string;
  costPrice?: number | string | null;
}

export interface CostSupplierProduct {
  id: string;
  supplierId?: string | null;
  supplierName?: string | null;
  productName: string;
  brand?: string | null;
  model?: string | null;
  priceMin?: number | string | null;
  priceMax?: number | string | null;
  currency?: string | null;
  /** 该供应产品最近一次询价（supplier_quotes） */
  latestQuote?: { unitPrice: number | string; currency?: string | null; quotedAt?: any } | null;
}

export interface CostBomRow {
  cost?: number | string | null;
  quantity?: number | string | null;
}

export type CostSource = 'price_list' | 'supplier' | 'bom';

export interface CostEstimate {
  cost: number | null;
  source: CostSource | null;
  /** 给人看的来源说明 */
  label: string;
  supplierProductId?: string;
  supplierId?: string;
  supplierName?: string;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 一条供应产品的参考采购价（人民币） */
export function supplierReferencePrice(
  sp: CostSupplierProduct,
  rates?: Record<string, number>,
): { price: number; basis: string } | null {
  const q = sp.latestQuote ? num(sp.latestQuote.unitPrice) : null;
  if (q != null) {
    return { price: toCny(q, sp.latestQuote?.currency || sp.currency, undefined, rates), basis: '最近一次询价' };
  }
  const lo = num(sp.priceMin);
  const hi = num(sp.priceMax);
  if (lo == null && hi == null) return null;
  const mid = lo != null && hi != null ? (lo + hi) / 2 : (lo ?? hi)!;
  return { price: toCny(mid, sp.currency, undefined, rates), basis: lo != null && hi != null ? '目录价区间中值' : '目录价' };
}

export function estimateCost(input: {
  priceList?: CostPriceItem[] | null;
  /** 报价行选定的型号（草稿按需求规格匹配出的型号） */
  model?: string | null;
  suppliers?: CostSupplierProduct[];
  bom?: CostBomRow[];
  rates?: Record<string, number>;
}): CostEstimate {
  // ① 型号价格表的成本价
  const list = (input.priceList || []).filter((m) => m && m.model);
  const row = input.model
    ? list.find((m) => String(m.model) === String(input.model))
    : list.length === 1
      ? list[0]
      : undefined;
  const listCost = row ? num(row.costPrice) : null;
  if (listCost != null) {
    return { cost: round2(listCost), source: 'price_list', label: `型号价格表 ${row!.model} 的成本价` };
  }

  // ② 映射的供应产品采购价：多家取最高
  const priced = (input.suppliers || [])
    .map((sp) => ({ sp, ref: supplierReferencePrice(sp, input.rates) }))
    .filter((x): x is { sp: CostSupplierProduct; ref: { price: number; basis: string } } => !!x.ref)
    .sort((a, b) => b.ref.price - a.ref.price);
  if (priced.length) {
    const { sp, ref } = priced[0];
    const who = [sp.supplierName, sp.brand, sp.productName].filter(Boolean).join(' ');
    const many = priced.length > 1 ? `（映射了 ${priced.length} 家，取最高）` : '';
    return {
      cost: round2(ref.price),
      source: 'supplier',
      label: `供应商采购价：${who}，${ref.basis}${many}`,
      supplierProductId: sp.id,
      supplierId: sp.supplierId || undefined,
      supplierName: sp.supplierName || undefined,
    };
  }

  // ③ BOM 汇总（每一行都有成本才算，缺一行就不给，免得少算）
  const bom = input.bom || [];
  if (bom.length && bom.every((b) => num(b.cost) != null)) {
    const total = bom.reduce((s, b) => s + num(b.cost)! * (Number(b.quantity) || 1), 0);
    return { cost: round2(total), source: 'bom', label: `产品 BOM ${bom.length} 行成本汇总` };
  }

  return { cost: null, source: null, label: '' };
}

/** 毛利率（%），无成本或无收入时为 null */
export function marginRate(revenue: number, cost: number): number | null {
  if (!(revenue > 0) || !(cost >= 0)) return null;
  return Math.round(((revenue - cost) / revenue) * 1000) / 10;
}
