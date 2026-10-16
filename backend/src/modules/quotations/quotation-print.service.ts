import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Quotation, QuotationItem } from './entities/quotation.entity';
import { Customer, ContactPerson } from '../customers/entities/customer.entity';
import { SystemConfig } from '../system-config/entities/system-config.entity';
import { CURRENCY_NAME_EN, CURRENCY_NAME_ZH } from '../../common/utils/currency.util';

/** HTML 转义，防止客户名/备注里的尖括号破坏版面或注入脚本 */
function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const money = (v: unknown, lang: 'zh' | 'en' = 'zh') =>
  Number(v || 0).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 人民币大写，正式报价单需要 */
export function toChineseAmount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  const digits = '零壹贰叁肆伍陆柒捌玖';
  const units = ['', '拾', '佰', '仟'];
  const bigUnits = ['', '万', '亿', '万亿'];

  const yuan = Math.floor(n);
  const jiao = Math.floor(n * 10) % 10;
  const fen = Math.round(n * 100) % 10;

  if (yuan === 0 && jiao === 0 && fen === 0) return '零元整';

  /*
   * 按万分组从低到高拼。两处要补「零」：组内两个非零数字之间夹着 0（壹仟零壹拾），
   * 以及低位组不足千位或整组为 0 时与高位组之间（壹佰万零伍佰、壹亿零伍）。
   * 末尾的 0 不读（原实现把 1,205,000 写成「壹佰贰拾零万伍仟零元整」）。
   */
  let intPart = '';
  let remaining = yuan;
  let group = 0;
  let lowerHasGap = false;
  while (remaining > 0) {
    const chunk = remaining % 10000;
    if (chunk > 0) {
      let chunkStr = '';
      let zero = false;
      let c = chunk;
      for (let i = 0; c > 0; i++) {
        const d = c % 10;
        if (d === 0) {
          if (chunkStr) zero = true;
        } else {
          chunkStr = digits[d] + units[i] + (zero ? digits[0] : '') + chunkStr;
          zero = false;
        }
        c = Math.floor(c / 10);
      }
      intPart = chunkStr + bigUnits[group] + (intPart && lowerHasGap ? digits[0] : '') + intPart;
      lowerHasGap = chunk < 1000;
    } else if (intPart) {
      lowerHasGap = true;
    }
    remaining = Math.floor(remaining / 10000);
    group += 1;
  }

  let result = intPart ? `${intPart}元` : '';
  if (jiao === 0 && fen === 0) return `${result}整`;
  if (jiao > 0) result += `${digits[jiao]}角`;
  else if (fen > 0) result += digits[0];
  if (fen > 0) result += `${digits[fen]}分`;
  return result;
}

/**
 * 英文大写金额（外贸报价单惯例）：SAY US DOLLARS ONE HUNDRED TWENTY THOUSAND AND CENTS FIFTY ONLY
 */
export function toEnglishAmount(n: number, currency = 'USD'): string {
  if (!Number.isFinite(n) || n < 0) return '';
  const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE',
    'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
  const under1000 = (x: number): string => {
    const parts: string[] = [];
    if (x >= 100) {
      parts.push(`${ones[Math.floor(x / 100)]} HUNDRED`);
      x %= 100;
    }
    if (x >= 20) {
      parts.push(tens[Math.floor(x / 10)] + (x % 10 ? `-${ones[x % 10]}` : ''));
    } else if (x > 0) {
      parts.push(ones[x]);
    }
    return parts.join(' ');
  };
  const words = (x: number): string => {
    if (x === 0) return 'ZERO';
    const scales: Array<[number, string]> = [[1e9, 'BILLION'], [1e6, 'MILLION'], [1e3, 'THOUSAND']];
    const out: string[] = [];
    for (const [v, name] of scales) {
      if (x >= v) {
        out.push(`${under1000(Math.floor(x / v))} ${name}`);
        x %= v;
      }
    }
    if (x > 0) out.push(under1000(x));
    return out.join(' ');
  };
  const cents = Math.round(n * 100) % 100;
  const whole = Math.floor(Math.round(n * 100) / 100);
  const name = (CURRENCY_NAME_EN[currency] || currency).toUpperCase();
  return `SAY ${name} ${words(whole)}${cents ? ` AND CENTS ${words(cents)}` : ''} ONLY`;
}

const LABELS = {
  zh: {
    title: '报 价 单', docTitle: '报价单', customer: '客户名称：', contact: '联 系 人：', address: '客户地址：',
    no: '报价单号：', date: '报价日期：', validity: '有 效 期：', days: (n: string) => `${n} 天`,
    idx: '序号', name: '产品名称', spec: '规格型号', unit: '单位', qty: '数量',
    price: (c: string) => `单价(${c === 'CNY' ? '元' : CURRENCY_NAME_ZH[c] || c})`,
    amount: (c: string) => `金额(${c === 'CNY' ? '元' : CURRENCY_NAME_ZH[c] || c})`,
    lead: '交期', total: '合计', empty: '暂无明细', capital: '合计金额（大写）：',
    termsTitle: '报价说明', commercial: '商务条款', payment: '付款条件', delivery: '交货期', warranty: '质保期',
    deliveryVal: (d: number) => `合同生效后 ${d} 天`, warrantyVal: (m: number) => `${m} 个月`,
    remark: '备注：', seller: '供方（盖章）：', buyer: '需方（盖章）：', phone: '电话', tax: '税号',
    print: '打印 / 另存为 PDF', printHint: '在打印对话框中选择「另存为 PDF」即可导出', leadDays: (d: number) => `${d} 天`,
  },
  en: {
    title: 'QUOTATION', docTitle: 'Quotation', customer: 'Customer:', contact: 'Contact:', address: 'Address:',
    no: 'Quotation No.:', date: 'Date:', validity: 'Validity:', days: (n: string) => `${n} days`,
    idx: 'No.', name: 'Description', spec: 'Specification', unit: 'Unit', qty: 'Qty',
    price: (c: string) => `Unit Price (${c})`, amount: (c: string) => `Amount (${c})`,
    lead: 'Lead Time', total: 'TOTAL', empty: 'No items', capital: 'Total in words: ',
    termsTitle: 'Terms & Conditions', commercial: 'Commercial Terms', payment: 'Payment', delivery: 'Delivery', warranty: 'Warranty',
    deliveryVal: (d: number) => `${d} days after the contract takes effect`, warrantyVal: (m: number) => `${m} months`,
    remark: 'Remarks: ', seller: 'Seller (Stamp):', buyer: 'Buyer (Stamp):', phone: 'Tel', tax: 'Tax ID',
    print: 'Print / Save as PDF', printHint: 'Choose "Save as PDF" in the print dialog', leadDays: (d: number) => `${d} days`,
  },
};

const UNIT_EN: Record<string, string> = { 套: 'set', 台: 'unit', 件: 'pc', 个: 'pc', 只: 'pc', 根: 'pc', 米: 'm', 吨: 't', 批: 'lot', 项: 'item' };

@Injectable()
export class QuotationPrintService {
  constructor(
    @InjectRepository(Quotation) private quotations: Repository<Quotation>,
    @InjectRepository(QuotationItem) private items: Repository<QuotationItem>,
    @InjectRepository(Customer) private customers: Repository<Customer>,
    @InjectRepository(ContactPerson) private contacts: Repository<ContactPerson>,
    @InjectRepository(SystemConfig) private configs: Repository<SystemConfig>,
  ) {}

  /** 依次尝试多个键（公司信息的键历史上有 company.name / company_name 两种写法），都没有用默认值 */
  private async config(keys: string | string[], fallback: string): Promise<string> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const row = await this.configs.findOne({ where: { key } });
      if (row?.value) return row.value;
    }
    return fallback;
  }

  /**
   * 生成可打印的报价单 HTML（中文 / 英文两套模板，按报价单的语言；?lang= 可临时切换预览）。
   *
   * 不引 puppeteer：为了导出一张表格拉进来 300MB 的无头浏览器不划算，
   * 且服务端渲染 PDF 的中文字体在 Windows/Linux 上表现不一致。
   * 交给浏览器"打印为 PDF"，版面由 @page + print CSS 完全控制，
   * 用户还能在打印预览里直接调整。
   */
  async renderHtml(id: string, langOverride?: string): Promise<string> {
    const quotation = await this.quotations.findOne({ where: { id } });
    if (!quotation) return '<h1>报价单不存在</h1>';
    const lang: 'zh' | 'en' = (langOverride || quotation.language) === 'en' ? 'en' : 'zh';
    const L = LABELS[lang];
    const currency = (quotation.currency || 'CNY').toUpperCase();

    const [items, customer] = await Promise.all([
      this.items.find({ where: { quotationId: id }, order: { sortOrder: 'ASC' } }),
      quotation.customerId
        ? this.customers.findOne({ where: { id: quotation.customerId } })
        : Promise.resolve(null),
    ]);

    const contact = customer
      ? await this.contacts.findOne({ where: { customerId: customer.id, isPrimary: true } })
      : null;

    const [companyZh, companyEn, addrZh, addrEn, companyPhone, companyTax, validDays, termsZh, termsEn] = await Promise.all([
      this.config(['company_name', 'company.name'], '襄阳博亚精工装备股份有限公司'),
      this.config('company_name_en', ''),
      this.config(['company_address', 'company.address'], ''),
      this.config('company_address_en', ''),
      this.config(['company_phone', 'company.phone'], ''),
      this.config(['company_tax_no', 'company.taxNo'], ''),
      this.config('quotation.validDays', '30'),
      this.config(
        'quotation.terms',
        '1. 本报价有效期自报价之日起 {validDays} 天。\n' +
          '2. 价格为含税单价，税率以合同约定为准。\n' +
          '3. 交货期以双方签订的技术协议与合同为准。\n' +
          '4. 付款方式：以合同约定为准。',
      ),
      this.config(
        'quotation.terms_en',
        '1. This quotation is valid for {validDays} days from the date of issue.\n' +
          '2. Prices are quoted in {currency}. Packing for sea shipment is included unless otherwise stated.\n' +
          '3. Delivery time and technical scope are subject to the signed technical agreement and contract.\n' +
          '4. Payment terms are subject to the contract.',
      ),
    ]);
    const companyName = lang === 'en' ? companyEn || companyZh : companyZh;
    const companyAddr = lang === 'en' ? addrEn || addrZh : addrZh;
    const missingEnHeader = lang === 'en' && !companyEn;

    const total = items.reduce((s, it) => s + Number(it.totalPrice || 0), 0);
    const amount = Number(quotation.amount || 0) || total;
    const dateRaw = quotation.quotedAt || quotation.createdAt;
    const dateText = dateRaw
      ? new Date(dateRaw).toLocaleDateString(lang === 'en' ? 'en-US' : 'zh-CN', lang === 'en' ? { year: 'numeric', month: 'short', day: 'numeric' } : undefined)
      : '';

    const rows = items
      .map((it, i) => {
        const name = lang === 'en' ? it.nameEn || it.name : it.name;
        const spec = lang === 'en' ? it.specificationEn || it.specification : it.specification;
        const unit = lang === 'en' ? UNIT_EN[it.unit || '套'] || it.unit || 'set' : it.unit || '套';
        return `
      <tr>
        <td class="c">${i + 1}</td>
        <td>${esc(name)}${it.brand ? `<div class="sub">${esc(it.brand)}</div>` : ''}</td>
        <td>${esc(spec)}</td>
        <td class="c">${esc(unit)}</td>
        <td class="r num">${money(it.quantity, lang)}</td>
        <td class="r num">${money(it.unitPrice, lang)}</td>
        <td class="r num">${money(it.totalPrice, lang)}</td>
        <td class="c">${it.deliveryDays != null ? L.leadDays(it.deliveryDays) : '-'}</td>
      </tr>`;
      })
      .join('');

    const terms = (lang === 'en' ? termsEn : termsZh)
      .replace('{validDays}', validDays)
      .replace('{currency}', lang === 'en' ? CURRENCY_NAME_EN[currency] || currency : CURRENCY_NAME_ZH[currency] || currency);
    const termsHtml = terms
      .split('\n')
      .filter(Boolean)
      .map((line) => `<li>${esc(line.replace(/^\d+\.\s*/, ''))}</li>`)
      .join('');

    // 报价上谈定的商务条款（付款/交货/质保）直接印在单上，与生成合同时带过去的是同一份
    const commercial: Array<[string, string]> = [];
    if (quotation.paymentTerms) commercial.push([L.payment, quotation.paymentTerms]);
    if (quotation.deliveryDays != null) commercial.push([L.delivery, L.deliveryVal(quotation.deliveryDays)]);
    if (quotation.warrantyMonths != null) commercial.push([L.warranty, L.warrantyVal(quotation.warrantyMonths)]);
    const commercialHtml = commercial.length
      ? `<div class="terms"><h3>${L.commercial}</h3><table class="kv">${commercial
          .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`)
          .join('')}</table></div>`
      : '';

    const capital =
      lang === 'en'
        ? toEnglishAmount(amount, currency)
        : `${currency === 'CNY' ? '' : `${CURRENCY_NAME_ZH[currency] || currency} `}${toChineseAmount(amount)}`;
    const fontStack =
      lang === 'en'
        ? '"Segoe UI", Arial, "Helvetica Neue", "Microsoft YaHei", sans-serif'
        : '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

    return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8">
<title>${L.docTitle} ${esc(quotation.quotationNo)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: ${fontStack};
    color: #111; font-size: 12px; line-height: 1.6; margin: 0;
  }
  .sheet { max-width: 190mm; margin: 0 auto; padding: 8mm; }
  .head { text-align: center; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
  .company { font-size: 17px; font-weight: 700; letter-spacing: ${lang === 'en' ? '0' : '1px'}; }
  .company-meta { font-size: 11px; color: #555; margin-top: 4px; }
  h1 { font-size: 21px; margin: 14px 0 0; letter-spacing: ${lang === 'en' ? '3px' : '6px'}; }
  .meta { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 10px; font-size: 12px; }
  .meta div { flex: 1; }
  .meta .row { display: flex; gap: 6px; padding: 2px 0; }
  .meta .k { color: #555; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border: 1px solid #999; padding: 6px 7px; vertical-align: top; }
  th { background: #f0efeb; font-weight: 600; text-align: left; font-size: 11px; }
  .c { text-align: center; }
  .r { text-align: right; }
  .num { font-variant-numeric: tabular-nums; font-family: Consolas, Menlo, monospace; }
  .sub { color: #666; font-size: 10px; }
  tfoot td { background: #faf9f6; font-weight: 600; }
  .capital { font-size: 12px; margin-bottom: 14px; }
  .capital b { letter-spacing: ${lang === 'en' ? '0' : '1px'}; }
  .terms { font-size: 11px; color: #333; margin-bottom: 18px; }
  .terms h3 { font-size: 12px; margin: 0 0 4px; }
  .terms ol { margin: 0; padding-left: 18px; }
  table.kv { margin: 0; }
  table.kv td { border: 0; padding: 1px 8px 1px 0; }
  table.kv td.k { color: #555; white-space: nowrap; width: 1%; }
  .sign { display: flex; justify-content: space-between; gap: 40px; margin-top: 30px; font-size: 12px; }
  .sign div { flex: 1; }
  .sign .line { border-bottom: 1px solid #333; height: 40px; margin-bottom: 4px; }
  .note { margin-top: 16px; font-size: 11px; color: #555; white-space: pre-wrap; }
  .toolbar { text-align: center; padding: 12px; background: #f7f6f2; border-bottom: 1px solid #ddd; }
  .toolbar button {
    padding: 8px 22px; font-size: 13px; cursor: pointer; border: 0; border-radius: 6px;
    background: #ff5b1f; color: #fff; font-weight: 600;
  }
  .toolbar span { margin-left: 12px; color: #666; font-size: 12px; }
  .toolbar .warn { color: #b45309; }
  @media print { .toolbar { display: none; } .sheet { padding: 0; } }
</style>
</head>
<body>
<div class="toolbar">
  <button onclick="window.print()">${L.print}</button>
  <span>${L.printHint}</span>
  ${missingEnHeader ? '<span class="warn">未设置公司英文名称：请到 设置 → 系统配置 填写 company_name_en / company_address_en（此行不会打印）</span>' : ''}
</div>

<div class="sheet">
  <div class="head">
    <div class="company">${esc(companyName)}</div>
    <div class="company-meta">
      ${companyAddr ? esc(companyAddr) : ''}${companyPhone ? ` · ${L.phone} ${esc(companyPhone)}` : ''}${companyTax ? ` · ${L.tax} ${esc(companyTax)}` : ''}
    </div>
    <h1>${L.title}</h1>
  </div>

  <div class="meta">
    <div>
      <div class="row"><span class="k">${L.customer}</span><span>${esc(customer?.name)}</span></div>
      <div class="row"><span class="k">${L.contact}</span><span>${esc(contact?.name)}${contact?.phone ? ` ${esc(contact.phone)}` : ''}</span></div>
      <div class="row"><span class="k">${L.address}</span><span>${esc(customer?.address)}</span></div>
    </div>
    <div>
      <div class="row"><span class="k">${L.no}</span><span class="num">${esc(quotation.quotationNo)}</span></div>
      <div class="row"><span class="k">${L.date}</span><span class="num">${esc(dateText)}</span></div>
      <div class="row"><span class="k">${L.validity}</span><span>${esc(L.days(validDays))}</span></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="c" style="width:36px">${L.idx}</th>
        <th>${L.name}</th>
        <th>${L.spec}</th>
        <th class="c" style="width:44px">${L.unit}</th>
        <th class="r" style="width:60px">${L.qty}</th>
        <th class="r" style="width:86px">${esc(L.price(currency))}</th>
        <th class="r" style="width:96px">${esc(L.amount(currency))}</th>
        <th class="c" style="width:64px">${L.lead}</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="8" class="c" style="padding:20px;color:#888">${L.empty}</td></tr>`}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="6" class="r">${L.total}${currency !== 'CNY' || lang === 'en' ? ` (${currency})` : ''}</td>
        <td class="r num">${money(amount, lang)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  <div class="capital">
    ${L.capital}<b>${esc(capital)}</b>
  </div>

  ${commercialHtml}

  <div class="terms">
    <h3>${L.termsTitle}</h3>
    <ol>${termsHtml}</ol>
  </div>

  ${quotation.notes ? `<div class="note">${L.remark}${esc(quotation.notes)}</div>` : ''}

  <div class="sign">
    <div>
      <div class="line"></div>
      ${L.seller}${esc(companyName)}
    </div>
    <div>
      <div class="line"></div>
      ${L.buyer}${esc(customer?.name)}
    </div>
  </div>
</div>
</body>
</html>`;
  }
}
