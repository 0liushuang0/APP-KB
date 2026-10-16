/**
 * 币种显示（与后端 common/utils/currency.util.ts 同一份口径）。
 *
 * 报价/合同可以出美元、欧元单；单据上显示原币金额，工作台等汇总一律是折人民币后的数。
 */
export const CURRENCY_OPTIONS = [
  { value: 'CNY', label: '人民币 CNY' },
  { value: 'USD', label: '美元 USD' },
  { value: 'EUR', label: '欧元 EUR' },
]

export const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '中文报价单' },
  { value: 'en', label: '英文报价单' },
]

const SYMBOL: Record<string, string> = { CNY: '¥', USD: '$', EUR: '€' }

export const currencySymbol = (currency?: string | null) => SYMBOL[(currency || 'CNY').toUpperCase()] || `${currency} `

/** 带币种符号的金额：¥1,234.00 / $1,234.00 */
export function fmtMoney(amount: unknown, currency?: string | null, digits = 0): string {
  const n = Number(amount || 0) || 0
  return `${currencySymbol(currency)}${n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`
}

/** 外币金额折人民币（单据锁定的汇率） */
export function toCny(amount: unknown, currency?: string | null, rate?: unknown): number {
  const n = Number(amount || 0) || 0
  if (!currency || currency === 'CNY') return n
  const r = Number(rate)
  return r > 0 ? Math.round(n * r * 100) / 100 : n
}
