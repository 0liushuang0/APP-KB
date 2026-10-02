/**
 * 各业务对象喂给向量库的文本。
 *
 * 为什么单独抽一层：
 * 此前每个 service 的 sync() 各写各的，内容都很薄 —— 客户只拼了
 * `名称+行业+规模+地址+描述`，联系人、决策链、跟进记录、等级、区域一概没有。
 * 结果就是"这个客户谁拍板""上次谈到哪儿了"这类最常见的问题，AI 手里根本没素材。
 *
 * 这里统一按「一段人能读懂的档案摘要」来拼：字段名带上，检索命中后
 * 直接就是可以放进提示词的上下文，模型不用再猜每个数字是什么意思。
 *
 * 全量重建（ReindexService）与增量同步（各 service 的 sync）共用同一套构造函数，
 * 两条路径不会再产出不同格式的内容。
 */

/** 拼接非空片段，`标签：值` 形式 */
function line(label: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || s === 'null' || s === 'undefined') return null;
  return `${label}：${s}`;
}

function join(parts: (string | null)[]): string {
  return parts.filter(Boolean).join('\n');
}

function money(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return null;
  return `${n.toLocaleString('zh-CN')} 元`;
}

function date(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('zh-CN');
}

/** 安全解析可能是 JSON 字符串的字段（结构化参数、明细行等） */
function parseJson<T = any>(raw: unknown): T | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as T;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

export interface CustomerIndexInput {
  customer: any;
  contacts?: any[];
  followUps?: any[];
  requirements?: any[];
  quotations?: any[];
}

export function buildCustomerContent(input: CustomerIndexInput): string {
  const c = input.customer;
  const contacts = (input.contacts || [])
    .slice(0, 8)
    .map((p) =>
      [p.name, p.title && `（${p.title}`, p.decisionRole && `/${p.decisionRole}`, p.title && '）', p.phone && ` ${p.phone}`]
        .filter(Boolean)
        .join(''),
    )
    .join('、');

  // 跟进只取最近几条：太久远的对"现在该怎么谈"没有参考价值，还会稀释检索
  const followUps = (input.followUps || [])
    .slice(0, 5)
    .map((f) => `${date(f.followUpAt) || ''} ${f.method || ''} ${f.content || ''} ${f.nextAction ? `下一步：${f.nextAction}` : ''}`.trim())
    .join('\n  ');

  const reqs = (input.requirements || [])
    .slice(0, 10)
    .map((r) => `${r.requirementNo || ''} ${r.title || ''}`.trim())
    .join('；');

  const wonAmount = (input.quotations || []).reduce(
    (s, q) => s + (q.status === 'won' ? Number(q.amount || 0) : 0),
    0,
  );

  return join([
    `客户：${c.name || ''}`,
    line('客户编号', c.customerCode || c.code),
    line('等级', c.level),
    line('业务状态', c.businessStatus),
    line('客户类型', c.customerType),
    line('行业', c.industry),
    line('规模', c.scale),
    line('区域', c.region),
    line('地址', c.address),
    line('负责销售', c.salesPerson),
    line('联系人', contacts),
    line('在手需求', reqs),
    line('累计成交', money(wonAmount)),
    line('简介', c.description),
    followUps ? `近期跟进：\n  ${followUps}` : null,
  ]);
}

export function buildRequirementContent(requirement: any, customerName?: string): string {
  const r = requirement;
  const spec = parseJson(r.structuredSpec);
  const card = spec?.card ?? spec;

  // 结构化参数逐条展开：AI 要能答"这个需求的板宽是多少"，就不能只喂一坨 JSON
  const params = card?.params
    ? Object.entries(card.params)
        .slice(0, 40)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('，')
    : null;
  const missing = Array.isArray(card?.missing) ? card.missing.join('、') : null;

  return join([
    `需求：${r.title || ''}`,
    line('需求编号', r.requirementNo),
    line('客户', customerName),
    line('类型', r.requirementType),
    line('来源', r.source),
    line('优先级', r.priority),
    line('状态', r.status),
    line('对应模板分类', r.templateCategory || r.category),
    line('联系人', [r.contactName, r.contactPhone, r.contactEmail].filter(Boolean).join(' ')),
    line('技术参数', params),
    line('待确认参数', missing),
    line('描述', r.description),
    line('AI 分析', r.aiAnalysis),
  ]);
}

export function buildProposalContent(proposal: any, customerName?: string): string {
  const p = proposal;
  return join([
    `技术方案：${p.title || ''}`,
    line('方案编号', p.proposalNo),
    line('客户', customerName),
    line('类型', p.proposalType),
    line('版本', p.version),
    line('状态', p.status),
    line('产品说明', p.productDescription),
    line('需求摘要', p.requirements),
    line('正文', p.content),
  ]);
}

export function buildQuotationContent(quotation: any, customerName?: string): string {
  const q = quotation;
  const items = parseJson<any[]>(q.items);
  const lines = Array.isArray(items)
    ? items
        .slice(0, 40)
        .map(
          (it) =>
            `${it.name || ''} ×${it.quantity || 0} 单价${Number(it.unitPrice || 0).toLocaleString('zh-CN')}`,
        )
        .join('；')
    : null;

  return join([
    `报价单：${q.quotationNo || ''}`,
    line('客户', customerName),
    line('金额', money(q.amount)),
    line('状态', q.status),
    line('报价明细', lines),
    line('成本构成', q.costBreakdown),
    line('备注', q.notes),
  ]);
}

export function buildContractContent(contract: any, customerName?: string): string {
  const c = contract;
  return join([
    `合同：${c.contractNo || ''} ${c.title || ''}`.trim(),
    line('客户', customerName || c.customerName),
    line('金额', money(c.amount)),
    line('状态', c.status),
    line('签订日期', date(c.signedDate)),
    line('生效日期', date(c.effectiveDate)),
    line('到期日期', date(c.expiryDate)),
    line('质保到期', date(c.warrantyExpiryDate)),
    line('付款条件', c.paymentTerms),
    line('交付条款', c.deliveryTerms),
  ]);
}

export function buildProjectContent(project: any, customerName?: string): string {
  const p = project;
  return join([
    `项目：${p.projectNo || ''} ${p.name || ''}`.trim(),
    line('客户', customerName),
    line('状态', p.status),
    line('阶段', p.dealStage),
    line('风险等级', p.riskLevel),
    line('负责人', p.manager || p.ownerId),
    line('计划开始', date(p.startDate)),
    line('计划完成', date(p.endDate)),
    line('描述', p.description),
  ]);
}

export function buildProductContent(product: any): string {
  const p = product;
  const specs = parseJson<any[]>(p.specs);
  const specText = Array.isArray(specs)
    ? specs.slice(0, 40).map((s) => `${s.name}=${s.value}`).join('，')
    : null;

  // 型号价格表：客户问"BJ125D 多少钱"，答案就在这里
  const priceList = parseJson<any[]>(p.priceList);
  const priceText = Array.isArray(priceList)
    ? priceList
        .slice(0, 40)
        .map((m) =>
          [
            m.model,
            m.spec && `(${m.spec})`,
            m.salePrice && `销售价${Number(m.salePrice).toLocaleString('zh-CN')}`,
            m.standardPrice && `标配价${Number(m.standardPrice).toLocaleString('zh-CN')}`,
            m.referencePrice && `参考价${Number(m.referencePrice).toLocaleString('zh-CN')}`,
            m.unit && `/${m.unit}`,
          ]
            .filter(Boolean)
            .join(' '),
        )
        .join('；')
    : null;

  const boms = parseJson<any[]>(p.boms);
  const bomText = Array.isArray(boms)
    ? boms.slice(0, 30).map((b) => `${b.materialName || ''}${b.specification ? ` ${b.specification}` : ''} ×${b.quantity || 0}`).join('；')
    : null;

  return join([
    `产品：${p.name || ''}`,
    line('产品编码', p.code),
    line('分类', p.category),
    line('计价单位', p.unit),
    line('标准单价', money(p.price)),
    line('型号价格', priceText),
    line('技术参数', specText),
    line('BOM', bomText),
    line('说明', p.description),
  ]);
}

export function buildSupplierContent(supplier: any, products?: any[]): string {
  const s = supplier;
  const originLabel = s.origin === 'domestic' ? '国内' : s.origin === 'overseas' ? '国外' : null;
  const tierLabel =
    s.tier === 'tier1' ? '一线品牌' : s.tier === 'tier2' ? '二线品牌' : s.tier === 'tier3' ? '其他品牌' : null;
  const levelLabel =
    { strategic: '战略供应商', qualified: '合格供应商', candidate: '备选供应商', blacklist: '黑名单' }[
      s.cooperationLevel as string
    ] || null;

  const supplied = (products || [])
    .slice(0, 20)
    .map((p) =>
      [p.productName || p.name, p.brand, p.price && `¥${Number(p.price).toLocaleString('zh-CN')}`, p.leadTime && `交期${p.leadTime}天`]
        .filter(Boolean)
        .join(' '),
    )
    .join('；');

  return join([
    `供应商：${s.name || ''}`,
    line('编号', s.code),
    line('来源', [originLabel, s.country].filter(Boolean).join('/')),
    line('品牌层级', tierLabel),
    line('合作等级', levelLabel),
    line('评级', s.rating),
    line('主营品类', Array.isArray(s.productCategories) ? s.productCategories.join('、') : s.productCategories),
    line('资质', Array.isArray(s.qualification) ? s.qualification.join('、') : s.qualification),
    line('付款条件', s.paymentTerms),
    line('联系人', [s.contactName, s.phone, s.email].filter(Boolean).join(' ')),
    line('供货产品', supplied),
    line('简介', s.description),
  ]);
}

export function buildTicketContent(ticket: any, customerName?: string): string {
  const t = ticket;
  return join([
    `售后工单：${t.ticketNo || ''} ${t.title || ''}`.trim(),
    line('客户', customerName || t.customerName),
    line('类型', t.type),
    line('产品型号', t.productModel),
    line('优先级', t.priority),
    line('状态', t.status),
    line('描述', t.description),
    line('处理方案', t.resolution),
    line('备件', t.spareParts),
    line('满意度', t.satisfactionScore),
  ]);
}

export function buildSolutionContent(solution: any): string {
  const s = solution;
  return join([
    `标准方案：${s.name || ''}`,
    line('方案编号', s.solutionNo),
    line('目录', s.directory),
    line('类型', s.solutionType),
    line('状态', s.status),
    line('参考价格', s.priceRange),
    line('交付周期', s.deliveryCycle),
    line('关键参数', s.paramSummary || s.keyParams),
    line('适用场景', s.scenario),
    line('标签', Array.isArray(s.tags) ? s.tags.join('、') : s.tags),
    line('摘要', s.description),
  ]);
}
