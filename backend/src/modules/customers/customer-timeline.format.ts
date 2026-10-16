import { CURRENCY_SYMBOL } from '../../common/utils/currency.util';

/** 时间线标题里的金额：原币种符号 + 千分位（外币单据显示原币，不折算） */
export function fmtMoneyPlain(amount: any, currency?: string | null): string {
  const n = Number(amount || 0) || 0;
  if (!n) return '';
  const cur = (currency || 'CNY').toUpperCase();
  return `${CURRENCY_SYMBOL[cur] || `${cur} `}${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}
