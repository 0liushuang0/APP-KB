import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Quotation, QuotationItem } from './entities/quotation.entity';
import { Customer, ContactPerson } from '../customers/entities/customer.entity';
import { SystemConfig } from '../system-config/entities/system-config.entity';

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

const money = (v: unknown) =>
  Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 人民币大写，正式报价单需要 */
function toChineseAmount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  const digits = '零壹贰叁肆伍陆柒捌玖';
  const units = ['', '拾', '佰', '仟'];
  const bigUnits = ['', '万', '亿', '万亿'];

  const yuan = Math.floor(n);
  const jiao = Math.floor(n * 10) % 10;
  const fen = Math.round(n * 100) % 10;

  if (yuan === 0 && jiao === 0 && fen === 0) return '零元整';

  let intPart = '';
  let remaining = yuan;
  let group = 0;
  while (remaining > 0) {
    const chunk = remaining % 10000;
    if (chunk > 0) {
      let chunkStr = '';
      let zero = false;
      let c = chunk;
      for (let i = 0; c > 0; i++) {
        const d = c % 10;
        if (d === 0) {
          zero = true;
        } else {
          if (zero) chunkStr = digits[0] + chunkStr;
          chunkStr = digits[d] + units[i] + chunkStr;
          zero = false;
        }
        c = Math.floor(c / 10);
      }
      intPart = chunkStr + bigUnits[group] + intPart;
    } else if (intPart) {
      intPart = digits[0] + intPart;
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

@Injectable()
export class QuotationPrintService {
  constructor(
    @InjectRepository(Quotation) private quotations: Repository<Quotation>,
    @InjectRepository(QuotationItem) private items: Repository<QuotationItem>,
    @InjectRepository(Customer) private customers: Repository<Customer>,
    @InjectRepository(ContactPerson) private contacts: Repository<ContactPerson>,
    @InjectRepository(SystemConfig) private configs: Repository<SystemConfig>,
  ) {}

  private async config(key: string, fallback: string): Promise<string> {
    const row = await this.configs.findOne({ where: { key } });
    return row?.value || fallback;
  }

  /**
   * 生成可打印的报价单 HTML。
   *
   * 不引 puppeteer：为了导出一张表格拉进来 300MB 的无头浏览器不划算，
   * 且服务端渲染 PDF 的中文字体在 Windows/Linux 上表现不一致。
   * 交给浏览器"打印为 PDF"，版面由 @page + print CSS 完全控制，
   * 用户还能在打印预览里直接调整。
   */
  async renderHtml(id: string): Promise<string> {
    const quotation = await this.quotations.findOne({ where: { id } });
    if (!quotation) return '<h1>报价单不存在</h1>';

    const [items, customer] = await Promise.all([
      this.items.find({ where: { quotationId: id }, order: { sortOrder: 'ASC' } }),
      quotation.customerId
        ? this.customers.findOne({ where: { id: quotation.customerId } })
        : Promise.resolve(null),
    ]);

    const contact = customer
      ? await this.contacts.findOne({ where: { customerId: customer.id, isPrimary: true } })
      : null;

    const [companyName, companyAddr, companyPhone, companyTax, validDays, terms] = await Promise.all([
      this.config('company.name', '襄阳博亚精工装备股份有限公司'),
      this.config('company.address', ''),
      this.config('company.phone', ''),
      this.config('company.taxNo', ''),
      this.config('quotation.validDays', '30'),
      this.config(
        'quotation.terms',
        '1. 本报价有效期自报价之日起 {validDays} 天。\n' +
          '2. 价格为含税单价，税率以合同约定为准。\n' +
          '3. 交货期以双方签订的技术协议与合同为准。\n' +
          '4. 付款方式：以合同约定为准。',
      ),
    ]);

    const total = items.reduce((s, it) => s + Number(it.totalPrice || 0), 0);
    const amount = Number(quotation.amount || 0) || total;

    const rows = items
      .map(
        (it, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td>${esc(it.name)}${it.brand ? `<div class="sub">${esc(it.brand)}</div>` : ''}</td>
        <td>${esc(it.specification)}</td>
        <td class="c">${esc(it.unit || '套')}</td>
        <td class="r num">${money(it.quantity)}</td>
        <td class="r num">${money(it.unitPrice)}</td>
        <td class="r num">${money(it.totalPrice)}</td>
        <td class="c">${it.deliveryDays != null ? `${it.deliveryDays} 天` : '-'}</td>
      </tr>`,
      )
      .join('');

    const termsHtml = terms
      .replace('{validDays}', validDays)
      .split('\n')
      .filter(Boolean)
      .map((line) => `<li>${esc(line.replace(/^\d+\.\s*/, ''))}</li>`)
      .join('');

    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>报价单 ${esc(quotation.quotationNo)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif;
    color: #111; font-size: 12px; line-height: 1.6; margin: 0;
  }
  .sheet { max-width: 190mm; margin: 0 auto; padding: 8mm; }
  .head { text-align: center; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
  .company { font-size: 17px; font-weight: 700; letter-spacing: 1px; }
  .company-meta { font-size: 11px; color: #555; margin-top: 4px; }
  h1 { font-size: 21px; margin: 14px 0 0; letter-spacing: 6px; }
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
  .capital b { letter-spacing: 1px; }
  .terms { font-size: 11px; color: #333; margin-bottom: 24px; }
  .terms h3 { font-size: 12px; margin: 0 0 4px; }
  .terms ol { margin: 0; padding-left: 18px; }
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
  @media print { .toolbar { display: none; } .sheet { padding: 0; } }
</style>
</head>
<body>
<div class="toolbar">
  <button onclick="window.print()">打印 / 另存为 PDF</button>
  <span>在打印对话框中选择「另存为 PDF」即可导出</span>
</div>

<div class="sheet">
  <div class="head">
    <div class="company">${esc(companyName)}</div>
    <div class="company-meta">
      ${companyAddr ? esc(companyAddr) : ''}${companyPhone ? ` · 电话 ${esc(companyPhone)}` : ''}${companyTax ? ` · 税号 ${esc(companyTax)}` : ''}
    </div>
    <h1>报 价 单</h1>
  </div>

  <div class="meta">
    <div>
      <div class="row"><span class="k">客户名称：</span><span>${esc(customer?.name)}</span></div>
      <div class="row"><span class="k">联 系 人：</span><span>${esc(contact?.name)}${contact?.phone ? ` ${esc(contact.phone)}` : ''}</span></div>
      <div class="row"><span class="k">客户地址：</span><span>${esc(customer?.address)}</span></div>
    </div>
    <div>
      <div class="row"><span class="k">报价单号：</span><span class="num">${esc(quotation.quotationNo)}</span></div>
      <div class="row"><span class="k">报价日期：</span><span class="num">${new Date(quotation.createdAt).toLocaleDateString('zh-CN')}</span></div>
      <div class="row"><span class="k">有 效 期：</span><span>${esc(validDays)} 天</span></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="c" style="width:36px">序号</th>
        <th>产品名称</th>
        <th>规格型号</th>
        <th class="c" style="width:44px">单位</th>
        <th class="r" style="width:60px">数量</th>
        <th class="r" style="width:80px">单价(元)</th>
        <th class="r" style="width:92px">金额(元)</th>
        <th class="c" style="width:60px">交期</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="8" class="c" style="padding:20px;color:#888">暂无明细</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="6" class="r">合计</td>
        <td class="r num">${money(amount)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  <div class="capital">
    合计金额（大写）：<b>${esc(toChineseAmount(amount))}</b>
  </div>

  <div class="terms">
    <h3>报价说明</h3>
    <ol>${termsHtml}</ol>
  </div>

  ${quotation.notes ? `<div class="note">备注：${esc(quotation.notes)}</div>` : ''}

  <div class="sign">
    <div>
      <div class="line"></div>
      供方（盖章）：${esc(companyName)}
    </div>
    <div>
      <div class="line"></div>
      需方（盖章）：${esc(customer?.name)}
    </div>
  </div>
</div>
</body>
</html>`;
  }
}
