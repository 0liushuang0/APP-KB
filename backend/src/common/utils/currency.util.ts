import { EntityManager } from 'typeorm';

/**
 * 币种与汇率（全系统一份口径）。
 *
 * 报价/合同可以用美元、欧元出单（活跃客户七成在海外），但工作台、客户 360、周报、
 * 业务指标里的金额必须折成人民币再加总 —— 否则 1 万美元和 1 万人民币会被当成一样多。
 *
 * 汇率：单据上存「出单时的汇率」（1 外币 = x 人民币），之后汇率变动不改历史单据；
 * 新建单据的默认汇率取系统配置 exchange_rates（设置 → 系统配置 可改），没配用下面的参考值。
 */
export const CURRENCIES = ['CNY', 'USD', 'EUR'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const CURRENCY_SYMBOL: Record<string, string> = { CNY: '¥', USD: '$', EUR: '€' };
export const CURRENCY_NAME_ZH: Record<string, string> = { CNY: '人民币', USD: '美元', EUR: '欧元' };
export const CURRENCY_NAME_EN: Record<string, string> = { CNY: 'RMB', USD: 'US Dollars', EUR: 'Euros' };

/** 参考汇率（仅在系统配置没填时使用；出单时可手改） */
export const DEFAULT_RATES: Record<string, number> = { CNY: 1, USD: 7.1, EUR: 7.75 };

export const EXCHANGE_RATES_KEY = 'exchange_rates';

/** 解析系统配置里的汇率 JSON；坏值、非正数一律忽略，回退参考值 */
export function parseRates(raw?: string | null): Record<string, number> {
  const out = { ...DEFAULT_RATES };
  if (!raw) return out;
  try {
    const obj = JSON.parse(raw);
    for (const [k, v] of Object.entries(obj || {})) {
      const n = Number(v);
      if (k && Number.isFinite(n) && n > 0) out[k.toUpperCase()] = n;
    }
  } catch {
    /* 配置写坏了不影响出单，用参考值 */
  }
  out.CNY = 1;
  return out;
}

export async function loadRates(manager: EntityManager): Promise<Record<string, number>> {
  try {
    const row = await manager
      .createQueryBuilder()
      .select('c.value', 'value')
      .from('system_configs', 'c')
      .where('c.key = :k', { k: EXCHANGE_RATES_KEY })
      .getRawOne<{ value: string }>();
    return parseRates(row?.value);
  } catch {
    return { ...DEFAULT_RATES };
  }
}

/**
 * 折人民币。单据自带汇率优先（出单时锁定的），没有再用当前配置汇率。
 * currency 为空视为人民币（历史单据都是人民币）。
 */
export function toCny(
  amount: unknown,
  currency?: string | null,
  rate?: unknown,
  rates: Record<string, number> = DEFAULT_RATES,
): number {
  const n = Number(amount || 0) || 0;
  const cur = (currency || 'CNY').toUpperCase();
  if (cur === 'CNY') return n;
  const r = Number(rate);
  const use = Number.isFinite(r) && r > 0 ? r : rates[cur] || DEFAULT_RATES[cur] || 1;
  return Math.round(n * use * 100) / 100;
}
