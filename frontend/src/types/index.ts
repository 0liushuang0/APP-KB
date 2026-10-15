export * from './common'

export interface SelectOption {
  value: string
  label: string
}

// ── 客户管理下拉选项常量 ──
export const CUSTOMER_TYPE_OPTIONS = [
  { value: '制造企业', label: '制造企业' },
  { value: '生产商', label: '生产商' },
  { value: '终端用户', label: '终端用户' },
  { value: '贸易商', label: '贸易商' },
  { value: '代理商', label: '代理商' },
  { value: '工程公司', label: '工程公司（EPC）' },
  { value: '设计院', label: '设计院' },
  { value: '科研院所', label: '科研院所' },
  { value: '其他', label: '其他' },
]
export const INDUSTRY_OPTIONS = [
  { value: '冶金', label: '冶金' },
  { value: '有色轧制', label: '有色轧制' },
  { value: '金属加工', label: '金属加工' },
  { value: '汽车', label: '汽车' },
  { value: '家电', label: '家电' },
  { value: '其他', label: '其他' },
]
export const CUSTOMER_LEVEL_OPTIONS = [
  { value: 'A', label: 'A（战略客户）' },
  { value: 'B', label: 'B（重点客户）' },
  { value: 'C', label: 'C（普通客户）' },
  { value: 'D', label: 'D（潜在客户）' },
]
export const BUSINESS_STATUS_OPTIONS = [
  { value: '活跃', label: '活跃' },
  { value: '沉默', label: '沉默' },
  { value: '流失', label: '流失' },
]
export const REGION_OPTIONS = [
  { value: '华东', label: '华东' },
  { value: '华南', label: '华南' },
  { value: '华中', label: '华中' },
  { value: '华北', label: '华北' },
  { value: '西北', label: '西北' },
  { value: '西南', label: '西南' },
  { value: '东北', label: '东北' },
  { value: '海外', label: '海外' },
]
export const SCALE_OPTIONS = [
  { value: '大型', label: '大型' },
  { value: '中型', label: '中型' },
  { value: '小型', label: '小型' },
]
export const DECISION_ROLE_OPTIONS = [
  { value: '决策人', label: '决策人' },
  { value: '影响人', label: '影响人' },
  { value: '使用者', label: '使用者' },
  { value: '信息人', label: '信息人' },
  { value: '把关人', label: '把关人' },
]
export const FOLLOWUP_METHOD_OPTIONS = [
  { value: '拜访', label: '拜访' },
  { value: '电话', label: '电话' },
  { value: '邮件', label: '邮件' },
  { value: '微信', label: '微信' },
  { value: '会议', label: '会议' },
  { value: '展会', label: '展会' },
]

// ── 需求管理下拉选项常量 ──
export const REQUIREMENT_TYPE_OPTIONS = [
  { value: '新设备采购', label: '新设备采购' },
  { value: '技改升级', label: '技改升级' },
  { value: '备件需求', label: '备件需求' },
  { value: '咨询服务', label: '咨询服务' },
]
export const REQUIREMENT_SOURCE_OPTIONS = [
  { value: '主动拜访', label: '主动拜访' },
  { value: '客户来询', label: '客户来询' },
  { value: '展会', label: '展会' },
  { value: '转介绍', label: '转介绍' },
  { value: '其他', label: '其他' },
]
export const REQUIREMENT_PRIORITY_OPTIONS = [
  { value: 'urgent', label: '紧急' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]
/**
 * 需求业务状态（商机语义）：一条需求即一个商机。
 * 草稿 → 已识别/已确认 → 已报价 → 已成交 / 已失单。
 * 后端 module-stats 的 quoted/lost 桶与首页漏斗按这些状态统计。
 */
export const REQUIREMENT_STATUS_OPTIONS = [
  { value: 'pending', label: '草稿' },
  { value: 'analyzing', label: '识别中' },
  { value: 'analyzed', label: '已识别' },
  { value: 'approved', label: '已确认' },
  { value: 'quoted', label: '已报价' },
  { value: 'won', label: '已成交' },
  { value: 'lost', label: '已失单' },
]
export const requirementStatusLabel = (v?: string) =>
  REQUIREMENT_STATUS_OPTIONS.find((o) => o.value === v)?.label || v || '—'

export interface ContactPerson {
  id?: string
  name: string
  title?: string
  department?: string
  phone?: string
  email?: string
  fax?: string
  wechat?: string
  otherContact?: string
  decisionRole?: string
  isPrimary?: boolean
  birthday?: string
  remark?: string
}

export interface FollowUp {
  id?: string
  content?: string
  followUpAt?: string
  method?: string
  participants?: string
  customerParticipants?: string
  focusPoints?: string
  nextAction?: string
  deadline?: string
  requirementId?: string
}

export interface Proposal {
  id: string
  proposalNo: string
  title: string
  customerId?: string
  customer?: { id?: string; name: string }
  /** 来源需求（需求 → 方案 一对多） */
  requirementId?: string
  proposalType?: string
  version?: string
  status: string
  productDescription?: string
  content?: string
  requirements?: string
  createdAt: string
}

export interface QuotationItem {
  name: string
  quantity: number
  unitPrice: number
  /** 关联的自有产品；从产品库选择时带上，手工录入的临时物料可留空。
   *  产品详情页的「报价记录」就是靠它反查出来的。 */
  productId?: string
}

export interface Quotation {
  id: string
  quotationNo: string
  customerId?: string
  customer?: { id?: string; name: string }
  proposalId?: string
  proposal?: { id?: string; title: string }
  amount: number
  status: string
  notes?: string
  costBreakdown?: string
  items?: QuotationItem[]
  createdAt: string
}

export interface Contract {
  id: string
  contractNo: string
  title?: string
  customerId?: string
  customerName?: string
  customerShortName?: string
  quotationId?: string
  quotationNo?: string
  projectName?: string
  amount: number
  signedDate?: string
  effectiveDate?: string
  expiryDate?: string
  paymentTerms?: string
  deliveryTerms?: string
  /** 交货期（合同约定的交货日期，项目跟踪同步显示） */
  deliveryDate?: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface AfterSalesTicket {
  id: string
  ticketNo: string
  customerId?: string
  customerName?: string
  customerShortName?: string
  contractId?: string
  contractNo?: string
  projectId?: string
  type: string
  title: string
  description?: string
  productModel?: string
  priority: string
  status: string
  assignedTo?: string
  resolvedAt?: string
  resolution?: string
  spareParts?: string
  satisfactionScore?: number
  visitDate?: string
  visitNotes?: string
  createdAt: string
  updatedAt: string
}

export interface BomItem {
  materialName: string
  specification?: string
  quantity: number
  unit: string
  cost?: number
}

/**
 * 型号价格行：一个产品系列（如 BJ 系列）下的具体型号及其多档价格。
 * 新增型号（如 BJ125D-1450）直接加一行，不必为每个型号建一条产品记录。
 */
export interface ProductPriceItem {
  /** 型号规格，如 BJ125D-1450 */
  model: string
  /** 关键参数/配置说明 */
  spec?: string
  /** 成本价 */
  costPrice?: number
  /** 市场参考价 */
  referencePrice?: number
  /** 标配价 */
  standardPrice?: number
  /** 销售价（对外报价基准） */
  salePrice?: number
  /** 计价单位 */
  unit?: string
  /** 备注 */
  remark?: string
  /** 最近修改时间 */
  updatedAt?: string
}

export interface ProductAttachment {
  id: string
  fileName: string
  fileUrl?: string
  fileSize: number
  mimeType?: string
  attachmentType?: string
  createdAt: string
}

/** 技术参数项：参数名 + 参数值，在产品详情「技术参数」卡片里维护 */
export interface ProductSpecItem {
  /** 参数名，如 涂覆速度 */
  name: string
  /** 参数值，如 0~30 m/min */
  value: string
}

export interface MaterialSpecItem {
  name: string
  value: string
}

/** 物料主档（外购件标准库）—— 多家供应商挂同一物料做同规格比价 */
export interface Material {
  id: string
  materialCode: string
  name: string
  category?: string
  specs?: string // JSON [{name,value}]
  specSignature?: string
  unit?: string
  standardPrice?: number
  description?: string
  createdAt?: string
  updatedAt?: string
}

export interface Product {
  id: string
  name: string
  code?: string
  category?: string
  unit?: string
  price?: number
  description?: string
  status?: string
  boms?: BomItem[]
  /** 型号价格表：系列下各型号的多档价格 */
  priceList?: ProductPriceItem[]
  /** 技术参数：结构化参数表 */
  specs?: ProductSpecItem[]
  attachments?: ProductAttachment[]
  createdAt?: string
  updatedAt?: string
}

export interface SupplierCapability {
  capability: string
  category?: string
  description?: string
}

export type SupplierOrigin = 'domestic' | 'overseas'
export type SupplierTier = 'tier1' | 'tier2' | 'tier3'
export type CooperationLevel = 'strategic' | 'qualified' | 'candidate' | 'blacklist'
export type Currency = 'CNY' | 'USD' | 'EUR'
export type PriceSource = 'quote' | 'contract' | 'estimate'

export const SUPPLIER_ORIGIN_OPTIONS = [
  { value: 'domestic', label: '国内' },
  { value: 'overseas', label: '国外' },
]

export const SUPPLIER_TIER_OPTIONS = [
  { value: 'tier1', label: '一线品牌' },
  { value: 'tier2', label: '二线品牌' },
  { value: 'tier3', label: '其他' },
]

export const COOPERATION_LEVEL_OPTIONS = [
  { value: 'strategic', label: '战略供应商' },
  { value: 'qualified', label: '合格供应商' },
  { value: 'candidate', label: '备选供应商' },
  { value: 'blacklist', label: '黑名单' },
]

export const PRICE_SOURCE_OPTIONS = [
  { value: 'quote', label: '供应商报价' },
  { value: 'contract', label: '合同价' },
  { value: 'estimate', label: '估算' },
]

export const SUPPLIER_CATEGORY_OPTIONS = [
  '液压', '气动', '电气', '机械传动', '仪表', '轴承',
  '密封', '铸锻件', '标准件', '表面处理', '钢材', '其他',
].map((c) => ({ value: c, label: c }))

export const SUPPLIER_RATING_OPTIONS = [
  { value: 'a', label: 'A 级-优秀' },
  { value: 'b', label: 'B 级-良好' },
  { value: 'c', label: 'C 级-合格' },
  { value: 'd', label: 'D 级-观察' },
]

export interface SupplierProduct {
  id: string
  supplierId: string
  productName: string
  brand?: string
  model?: string
  specification?: string
  category?: string
  materialId?: string
  specs?: string
  unit?: string
  priceMin?: number | null
  priceMax?: number | null
  currency?: Currency
  priceDate?: string
  priceSource?: PriceSource
  deliveryDays?: number | null
  moq?: number | null
  isSubstitutable?: boolean
  substituteFor?: string
  remark?: string
  status?: string
  createdAt?: string
}

export interface SupplierQuote {
  id: string
  supplierProductId: string
  quantity: number
  unitPrice: number
  currency?: Currency
  quotedAt?: string
  validUntil?: string
  quotationId?: string
  remark?: string
  createdAt: string
}

export interface Supplier {
  id: string
  name: string
  code?: string
  contactName?: string
  phone?: string
  email?: string
  address?: string
  rating?: string
  description?: string
  status?: string
  origin?: SupplierOrigin
  country?: string
  tier?: SupplierTier
  productCategories?: string[]
  qualification?: string[]
  cooperationLevel?: CooperationLevel
  paymentTerms?: string
  firstCooperationAt?: string
  orderCount?: number
  orderAmount?: number
  onTimeRate?: number | null
  qualifiedRate?: number | null
  capabilities?: SupplierCapability[]
  products?: SupplierProduct[]
  /** 由列表接口附加的聚合字段 */
  productCount?: number
  priceMin?: number | null
  priceMax?: number | null
  avgDeliveryDays?: number | null
  createdAt?: string
}

/** 比价表的一行：供应产品 + 其供应商的分级与履约信息 */
export interface CompareRow {
  productId: string
  productName: string
  brand: string | null
  model: string | null
  specification: string | null
  category: string | null
  unit: string | null
  priceMin: number | null
  priceMax: number | null
  currency: string
  priceDate: string | null
  priceSource: string
  /** 价格采集超过 180 天，不能直接拿去报价 */
  priceStale: boolean
  deliveryDays: number | null
  moq: number | null
  isSubstitutable: boolean
  supplierId: string
  supplierName: string
  origin: string | null
  originLabel: string
  tier: string | null
  tierLabel: string
  country: string | null
  rating: string | null
  cooperationLevel: string | null
  onTimeRate: number | null
}

export interface ProjectStage {
  id?: string
  name: string
  startDate?: string
  endDate?: string
  status?: string
  description?: string
  assignedTo?: string
  deliverable?: string
  acceptanceResult?: string
  sortOrder?: number
}

export interface ProjectRisk {
  id?: string
  title: string
  description?: string
  riskType?: string
  probability?: string
  impact?: string
  level?: string
  status?: string
  mitigation?: string
  owner?: string
}

export interface ProjectTask {
  id?: string
  projectId?: string
  stageId?: string
  title: string
  description?: string
  assignedTo?: string
  collaborators?: string
  startDate?: string
  endDate?: string
  progress?: number
  priority?: string
  status?: string
}

export const PROJECT_TYPE_OPTIONS = [
  { value: '设备制造', label: '设备制造' },
  { value: '安装调试', label: '安装调试' },
  { value: '技改', label: '技改' },
  { value: '服务', label: '服务' },
]
export const PROJECT_HEALTH_OPTIONS = [
  { value: 'green', label: '健康' },
  { value: 'yellow', label: '关注' },
  { value: 'red', label: '预警' },
]
export const TASK_PRIORITY_OPTIONS = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]
export const TASK_STATUS_OPTIONS = [
  { value: 'pending', label: '待开始' },
  { value: 'in_progress', label: '进行中' },
  { value: 'done', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
]

export interface Project {
  id: string
  projectNo: string
  name: string
  customerId?: string
  customer?: { id?: string; name: string }
  requirementId?: string
  proposalId?: string
  quotationId?: string
  contractId?: string
  projectType?: string
  status: string
  dealStage?: string
  dealType?: 'new' | 'repeat' | 'expansion'
  businessStatus?: string
  progress?: number
  health?: string
  startDate?: string
  endDate?: string
  actualStartDate?: string
  actualEndDate?: string
  managerId?: string
  description?: string
  stages?: ProjectStage[]
  risks?: ProjectRisk[]
  tasks?: ProjectTask[]
  createdAt?: string
}

export interface Customer {
  id: string
  name: string
  code?: string
  industry?: string
  scale?: string
  level?: string
  status: string
  address?: string
  website?: string
  email?: string
  phone?: string
  postalCode?: string
  description?: string
  visibility?: string
  createdAt: string
  contacts?: ContactPerson[]
  followUps?: FollowUp[]
  proposals?: Proposal[]
  quotations?: Quotation[]
}

export interface Document {
  id: string
  title: string
  fileName: string
  fileSize?: number
  mimeType?: string
  category?: string
  status: string
  visibility?: string
  uploaderId?: string
  uploader?: { id?: string; nickname: string }
  customerId?: string
  fileUrl?: string
  createdAt: string
  /** 由 by-entity / chain 接口返回时携带的关联信息 */
  link?: DocumentLink
}

export interface User {
  id: string
  nickname: string
  username?: string
  email?: string
  phone?: string
  departmentId?: string
  roleIds?: string[]
}

export interface Department {
  id: string
  name: string
}

export interface Role {
  id: string
  name: string
}

export interface UserGroup {
  id: string
  name: string
}

export interface RequirementAttachment {
  id: string
  fileName: string
  fileUrl?: string
  fileSize: number
  mimeType?: string
  parsedText?: string
  createdAt: string
}

export interface Requirement {
  id: string
  requirementNo: string
  title: string
  customerId?: string
  customer?: { id?: string; name: string }
  projectId?: string
  category?: string
  description?: string
  priority?: string
  status: string
  aiAnalysis?: string
  structuredSpec?: string
  specStatus?: 'pending' | 'analyzing' | 'done' | 'rejected'
  analyzedBy?: string
  analyzedAt?: string
  attachments?: RequirementAttachment[]
  /** 版本管理 */
  version?: number
  rootRequirementId?: string
  changeReason?: string
  isCurrent?: boolean
  ownerId?: string
  departmentId?: string
  createdAt: string
  updatedAt?: string
}

/** AI 服务返回的需求卡字段 */
export interface RequirementCardField {
  key: string
  label: string
  value?: string | number | null
  unit?: string
  normalized?: string | number
  confidence?: number
  evidence?: string[]
  source?: string
  group?: string
  required_for_match?: boolean
  required_for_quote?: boolean
}

export interface RequirementCardMissing {
  field: string
  label: string
  severity?: string
  hint?: string
}

/** structuredSpec 反序列化后的形态（新版为需求卡，旧版为简化 spec） */
export interface RequirementCard {
  product_category?: string
  category_confidence?: number
  overall_confidence?: number
  fields?: RequirementCardField[]
  missing?: RequirementCardMissing[]
  notes?: string
  llm_used?: boolean
  /** 兼容旧结构 */
  productType?: string
  params?: Array<{ key: string; value: string; unit?: string; confidence?: number }>
  specialRequirements?: string[]
  standards?: string[]
  summary?: string
  confidence?: number
}

export interface StructuredSpec {
  productType?: string
  params?: Array<{ key: string; value: string; unit?: string; confidence?: number }>
  specialRequirements?: string[]
  standards?: string[]
  risks?: string[]
  summary?: string
  confidence?: number
}

export interface DealStageInfo {
  value: string
  label: string
  color: string
}

export const DEAL_STAGES: DealStageInfo[] = [
  { value: 'requirement_registered', label: '需求登记', color: 'var(--color-muted, #6b7280)' },
  { value: 'requirement_analyzed', label: '需求识别', color: 'var(--color-accent-600, #2563eb)' },
  { value: 'solution_drafting', label: '方案编制', color: '#7c3aed' },
  { value: 'quotation_drafting', label: '报价编制', color: 'var(--color-warning, #d97706)' },
  { value: 'quotation_reviewed', label: '报价审核', color: '#0891b2' },
  { value: 'submitted', label: '已提交客户', color: 'var(--color-success, #059669)' },
  { value: 'contract_signed', label: '已签合同', color: '#0d9488' },
  { value: 'won', label: '已成交', color: '#16a34a' },
  { value: 'lost', label: '已流失', color: 'var(--color-danger, #dc2626)' },
]

export const DEAL_STAGE_MAP = Object.fromEntries(DEAL_STAGES.map((s) => [s.value, s]))

export interface ProjectTimeline {
  id: string
  projectId: string
  stage: string
  action: string
  actorName?: string
  documentId?: string
  description?: string
  createdAt: string
}

export type LinkEntityType =
  | 'customer'
  | 'requirement'
  | 'proposal'
  | 'solution'
  | 'quotation'
  | 'contract'
  | 'project'
  | 'afterSale'
  | 'workTask'

export type DocStage = 'raw' | 'requirement' | 'analysis' | 'solution' | 'quotation' | 'contract'

export type LinkRole = 'source' | 'deliverable' | 'reference'

export interface DocumentLink {
  id: string
  documentId: string
  projectId?: string
  customerId?: string
  requirementId?: string
  proposalId?: string
  solutionId?: string
  quotationId?: string
  stage: DocStage
  category: string
  linkRole?: LinkRole
  version: number
  uploadedByName?: string
  description?: string
  document?: Document
  createdAt: string
}

/** 客户全链路：按业务阶段分组的资料 */
export interface ChainNode {
  stage: DocStage
  stageLabel: string
  entityType: LinkEntityType | null
  entityId: string | null
  entityTitle: string | null
  documents: Document[]
}

export const DOC_STAGE_LABELS: Record<DocStage, string> = {
  raw: '原始资料',
  requirement: '需求文件',
  analysis: '分析文档',
  solution: '技术方案',
  quotation: '报价文件',
  contract: '合同协议',
}

/**
 * 业务资料库分类：7大类35+子类。
 * 原来的9个分类（原始资料/需求规格/CAD图纸...）是客户项目交付物，已移到客户资料。
 */
export const DOC_CATEGORY_OPTIONS = [
  // ── 公司形象类 ──
  { value: 'company_profile', label: '公司形象', hint: '公司宣传PPT、宣传视频、企业画册、企业简介、发展历程、荣誉奖项、社会责任报告等' },
  { value: 'product_promo', label: '产品推广', hint: '产品样本图册、产品介绍PPT、产品宣传视频、技术参数表、产品优势说明、选型手册、竞品对比分析、3D展示等' },
  { value: 'case_study', label: '方案与案例', hint: '行业解决方案、典型应用案例、客户业绩清单、投资回报分析、技术经济对比、现场使用视频等' },
  { value: 'qualification', label: '资质证书', hint: '营业执照、质量体系证书(ISO9001)、专利证书、行业资质许可、检测报告、安全/环保认证等' },
  { value: 'bid_doc', label: '投标文件', hint: '标书模板、商务条款模板、技术标模板、付款条件模板、授权委托书等' },
  { value: 'market_research', label: '市场研究', hint: '行业分析报告、竞争对手分析、市场调研报告、政策法规动态等' },
  { value: 'exhibition', label: '展会活动', hint: '展会策划方案、展会宣传材料、技术交流会材料、客户参观接待方案等' },
  { value: 'other', label: '其他', hint: '不属于以上分类的其他业务资料' },
]

/** 业务资料子分类（大类 → 子类列表） */
export const DOC_SUBCATEGORY_MAP: Record<string, { value: string; label: string }[]> = {
  company_profile: [
    { value: 'company_ppt', label: '公司宣传PPT' },
    { value: 'company_video', label: '公司宣传视频' },
    { value: 'company_brochure', label: '企业画册' },
    { value: 'company_intro', label: '企业简介' },
    { value: 'company_history', label: '发展历程' },
    { value: 'company_awards', label: '荣誉奖项' },
    { value: 'company_csr', label: '社会责任报告' },
  ],
  product_promo: [
    { value: 'product_catalog', label: '产品样本图册' },
    { value: 'product_ppt', label: '产品介绍PPT' },
    { value: 'product_video', label: '产品宣传视频' },
    { value: 'product_spec', label: '产品技术参数表' },
    { value: 'product_advantage', label: '产品优势说明' },
    { value: 'product_selection', label: '产品选型手册' },
    { value: 'competitor_analysis', label: '竞品对比分析' },
    { value: 'product_3d', label: '产品3D展示/动画' },
  ],
  case_study: [
    { value: 'industry_solution', label: '行业解决方案' },
    { value: 'typical_case', label: '典型应用案例' },
    { value: 'customer_list', label: '客户业绩清单' },
    { value: 'roi_analysis', label: '投资回报分析' },
    { value: 'tech_comparison', label: '技术经济对比' },
    { value: 'site_video', label: '现场使用视频' },
  ],
  qualification: [
    { value: 'business_license', label: '营业执照' },
    { value: 'iso_cert', label: '质量体系证书' },
    { value: 'patent_cert', label: '专利证书' },
    { value: 'industry_license', label: '行业资质许可' },
    { value: 'test_report', label: '检测报告' },
    { value: 'safety_cert', label: '安全/环保认证' },
  ],
  bid_doc: [
    { value: 'bid_template', label: '标书模板' },
    { value: 'commercial_terms', label: '商务条款模板' },
    { value: 'tech_bid', label: '技术标模板' },
    { value: 'payment_terms', label: '付款条件模板' },
    { value: 'authorization', label: '授权委托书' },
  ],
  market_research: [
    { value: 'industry_report', label: '行业分析报告' },
    { value: 'competitor_report', label: '竞争对手分析' },
    { value: 'market_survey', label: '市场调研报告' },
    { value: 'policy_update', label: '政策法规动态' },
  ],
  exhibition: [
    { value: 'expo_plan', label: '展会策划方案' },
    { value: 'expo_material', label: '展会宣传材料' },
    { value: 'tech_seminar', label: '技术交流会材料' },
    { value: 'visit_plan', label: '客户参观接待方案' },
  ],
  other: [{ value: 'other', label: '其他' }],
}

/** 业务资料孙分类（子类 → 孙子类列表），默认留空，用户可自行添加 */
export const DOC_GRANDSUB_MAP: Record<string, { value: string; label: string }[]> = {
}

/**
 * 客户关联资料分类：6大类28子类。
 * 原业务资料的9个交付物分类（需求规格/CAD图纸/技术协议/报价单/合同/计算书等）
 * 合并到这里，作为"方案报价记录"和"客户技术资料"的子类。
 */
export const CUSTOMER_DOC_CATEGORIES = [
  // ── 客户背景类 ──
  { value: 'customer_background', label: '客户背景', hint: '客户企业概况、组织架构图、产线/工厂信息、经营状况/年报、客户决策链等' },
  { value: 'customer_tech', label: '客户技术资料', hint: '现有设备清单、工艺参数记录、现场照片/视频、客户提供图纸、技术规格书、现场勘测报告、CAD图纸等' },
  { value: 'communication', label: '沟通记录', hint: '拜访记录、会议纪要、往来邮件、电话/微信记录、技术交流记录等' },
  { value: 'proposal_record', label: '方案报价记录', hint: '已提交方案文档、历史报价单、客户反馈意见、偏差沟通记录、竞品报价情报、需求规格、技术协议、计算书等' },
  { value: 'contract_delivery', label: '合同交付', hint: '历史合同、验收报告、售后维修记录、质保期记录、原始资料等' },
  { value: 'customer_standard', label: '客户标准规范', hint: '客户企业标准、客户验收标准、特殊技术要求等' },
]

/** 客户资料子分类 */
export const CUSTOMER_DOC_SUBCATEGORY_MAP: Record<string, { value: string; label: string }[]> = {
  customer_background: [
    { value: 'customer_profile', label: '客户企业概况' },
    { value: 'customer_org', label: '组织架构图' },
    { value: 'customer_factory', label: '产线/工厂信息' },
    { value: 'customer_annual', label: '经营状况/年报' },
    { value: 'customer_decision', label: '客户决策链' },
  ],
  customer_tech: [
    { value: 'existing_equipment', label: '现有设备清单' },
    { value: 'process_params', label: '工艺参数记录' },
    { value: 'site_photos', label: '现场照片/视频' },
    { value: 'customer_drawing', label: '客户提供图纸' },
    { value: 'customer_spec', label: '客户技术规格书' },
    { value: 'site_survey', label: '现场勘测报告' },
    // 从原业务资料迁入
    { value: 'cad_drawing', label: 'CAD 图纸' },
  ],
  communication: [
    { value: 'visit_record', label: '拜访记录' },
    { value: 'meeting_minutes', label: '会议纪要' },
    { value: 'email_archive', label: '往来邮件' },
    { value: 'phone_record', label: '电话/微信记录' },
    { value: 'tech_discussion', label: '技术交流记录' },
  ],
  proposal_record: [
    { value: 'submitted_proposal', label: '已提交方案文档' },
    { value: 'historical_quote', label: '历史报价单' },
    { value: 'customer_feedback', label: '客户反馈意见' },
    { value: 'deviation_record', label: '偏差沟通记录' },
    { value: 'competitor_intel', label: '竞品报价情报' },
    // 从原业务资料迁入
    { value: 'requirement_spec', label: '需求规格' },
    { value: 'tech_agreement', label: '技术协议' },
    { value: 'quotation', label: '报价单' },
    { value: 'calc_sheet', label: '计算书' },
  ],
  contract_delivery: [
    { value: 'historical_contract', label: '历史合同' },
    { value: 'acceptance_report', label: '验收报告' },
    { value: 'maintenance_record', label: '售后维修记录' },
    { value: 'warranty_record', label: '质保期记录' },
    // 从原业务资料迁入
    { value: 'contract', label: '合同' },
    { value: 'raw_material', label: '原始资料' },
  ],
  customer_standard: [
    { value: 'customer_enterprise_std', label: '客户企业标准' },
    { value: 'customer_acceptance_std', label: '客户验收标准' },
    { value: 'special_requirement', label: '特殊技术要求' },
  ],
}

/**
 * 知识库分类键 → 中文名。
 * 补齐 FAQ常见问题 + 技术知识 + 常用提交资料 三个大类。
 */
export const KNOWLEDGE_CATEGORY_LABELS: Record<string, string> = {
  // ── FAQ常见问题 ──
  faq_selection: '选型FAQ',
  faq_tech_params: '技术参数FAQ',
  faq_process: '工艺FAQ',
  faq_price: '价格/商务FAQ',
  faq_delivery: '交期/物流FAQ',
  faq_warranty: '售后/质保FAQ',
  // ── 技术知识 ──
  tech_principle: '技术原理文章',
  tech_process: '工艺知识库',
  tech_material: '材料知识',
  tech_structure: '设备结构解析',
  tech_electrical: '电气控制知识',
  tech_hydraulic: '液压/润滑知识',
  tech_trend: '行业技术动态',
  // ── 标准规范 ──
  national_standard: '国家标准',
  industry_standard: '行业标准',
  enterprise_standard: '企业标准',
  intl_standard: '国际标准',
  customer_special_std: '客户特殊规范',
  // ── 模板表格 ──
  tech_agreement: '技术协议模板',
  acceptance_template: '验收标准模板',
  test_report_template: '测试报告模板',
  site_survey_template: '现场勘测表模板',
  calc_template: '常用计算表格',
  param_comparison: '参数对照表',
  // ── 培训资料 ──
  product_manual: '产品手册',
  training_material: '培训资料',
  operation_manual: '操作使用手册',
  maintenance_manual: '维护手册',
  safety_manual: '安全操作规程',
  // ── 常用提交资料 ──
  product_spec_doc: '产品说明书',
  certificate_template: '合格证模板',
  packing_list: '装箱单模板',
  factory_inspection: '出厂检验报告',
  random_docs: '随机文件清单',
  // ── 故障排除（售后转FAQ）──
  troubleshooting: '故障排除',
  // ── 其他 ──
  other: '其他',
}

/** 把任意来源的分类值翻成中文，翻不出来就原样返回 */
export function resolveDocCategoryLabel(raw?: string): string {
  if (!raw) return '-'
  // 产品资料：category 存的是 `product:{产品名}`，直接显示产品名
  if (raw.startsWith('product:')) return raw.slice('product:'.length)
  // 业务资料分类
  const hit = DOC_CATEGORY_OPTIONS.find((o) => o.value === raw)
  if (hit) return hit.label
  // 客户资料大类
  const custHit = CUSTOMER_DOC_CATEGORIES.find((o) => o.value === raw)
  if (custHit) return custHit.label
  // 客户资料子类
  for (const subs of Object.values(CUSTOMER_DOC_SUBCATEGORY_MAP)) {
    const sub = subs.find((s) => s.value === raw)
    if (sub) return sub.label
  }
  // 业务资料子类
  for (const subs of Object.values(DOC_SUBCATEGORY_MAP)) {
    const sub = subs.find((s) => s.value === raw)
    if (sub) return sub.label
  }
  // 业务资料孙子类
  for (const subs of Object.values(DOC_GRANDSUB_MAP)) {
    const sub = subs.find((s) => s.value === raw)
    if (sub) return sub.label
  }
  // 知识库来的是 knowledge/xxx
  const key = raw.includes('/') ? raw.split('/').pop()! : raw
  return KNOWLEDGE_CATEGORY_LABELS[key] || raw
}

export const FILE_TYPE_OPTIONS = [
  { value: 'pdf', label: 'PDF' },
  { value: 'word', label: 'Word' },
  { value: 'excel', label: 'Excel' },
  { value: 'ppt', label: 'PPT' },
  { value: 'cad', label: 'CAD 图纸' },
  { value: 'image', label: '图片' },
  { value: 'text', label: '文本' },
  { value: 'other', label: '其他' },
]

/**
 * 业务资料能关联到哪些对象。
 *
 * 只列客户业务链路上的五个模块，名称与左侧导航一字不差 ——
 * 之前混进了「方案模板」（标准方案库，属于产品方案而非客户业务），
 * 用户在下拉里看到「需求 / 方案 / 方案模板」根本分不清哪个是哪个。
 */
export const LINK_ENTITY_OPTIONS: Array<{ value: LinkEntityType; label: string }> = [
  { value: 'customer', label: '客户中心' },
  { value: 'requirement', label: '客户需求' },
  { value: 'proposal', label: '技术方案' },
  { value: 'quotation', label: '报价管理' },
  { value: 'project', label: '项目跟踪' },
]

export interface Customer360 {
  customer: Customer
  stats: {
    totalProjects: number
    wonProjects: number
    totalRequirements: number
    totalProposals: number
    totalQuotations: number
    totalDocuments: number
    totalQuotationAmount: number
  }
  projects: Array<Project & { documentCount: number }>
  requirements: Requirement[]
  proposals: Proposal[]
  quotations: Quotation[]
  documents: DocumentLink[]
  documentsByStage: Record<string, DocumentLink[]>
}

export interface MatchResult {
  source_type: string
  source_id: string
  content: string
  score: number
  document_id?: string
}

export interface ParamDiffResult {
  matches: Array<{ key: string; value: string; unit: string }>
  differences: Array<{ key: string; current: string; historical: string; unit: string }>
  similarity: number
  total_params: number
  matched_params: number
}

export interface DashboardStats {
  customers?: number
  proposals?: number
  quotations?: number
  pendingApprovals?: number
}

export interface Activity {
  title: string
  time?: string
}

/* ── 方案模板库（solutions / config_options / price_tables）── */

export interface ConfigOption {
  id?: string
  solutionId?: string
  key: string
  label: string
  choices?: string
  constraintRules?: string
  sortOrder?: number
}

export interface PriceTable {
  id?: string
  solutionId?: string
  optionKey: string
  optionValue: string
  priceDelta: number
  cost?: number
  leadTime?: string
  supplyLevel?: string
}

export interface Solution {
  id: string
  solutionNo?: string
  name: string
  productId?: string
  product?: { id?: string; name: string }
  /** 方案类型：standard 标准 / optional 选配 / custom_template 定制模板 */
  solutionType?: string
  /** 目录路径（斜杠分层），如 普碳钢/酸洗线 */
  directory?: string
  description?: string
  /** 适用场景 */
  scenario?: string
  /** 关键参数标签（JSON 字符串），用于匹配 */
  keyParams?: string
  /** 适用参数摘要 */
  paramSummary?: string
  /** 参考价格区间，如 200-350万 */
  priceRange?: string
  /** 典型交付周期，如 90-120天 */
  deliveryCycle?: string
  category?: string
  tags?: string[]
  cadTemplateUrl?: string
  agreementTemplateUrl?: string
  quotationTemplate?: string
  defaultConfig?: string
  version?: number
  status?: string
  configOptions?: ConfigOption[]
  priceTables?: PriceTable[]
  createdAt?: string
  updatedAt?: string
}

/* ── 参数模板 ── */

export interface ParamTemplateField {
  key: string
  label: string
  type?: string
  unit?: string
  options?: string[]
  aliases?: string[]
  required?: boolean
  required_for_match?: boolean
  required_for_quote?: boolean
  default?: unknown
  validation?: { min?: number; max?: number }
}

export interface ParamTemplate {
  id: string
  category: string
  fields: string
  version?: number
  status?: string
  createdAt?: string
  updatedAt?: string
}

/* ── 审计日志 ── */

export interface AuditLog {
  id: string
  action: string
  objectType?: string
  objectId?: string
  userId?: string
  userName?: string
  ip?: string
  userAgent?: string
  detail?: string
  result?: string
  createdAt: string
}

/* ── 系统配置 ── */

export interface SystemConfigItem {
  id: string
  key: string
  value?: string
  description?: string
  category?: string
  createdAt?: string
  updatedAt?: string
}

/* ── 客户回复草稿（原「补问草稿」） ── */

export interface FollowUpDraft {
  /** 即时消息话术：面向微信/WhatsApp/飞书等聊天渠道，字段名沿用 wechat 仅为兼容后端 */
  wechat: string
  email: string
  missing?: Array<{ key: string; label: string; priority?: string }>
}

/* ── 需求记录（沟通/变更/确认，取代旧的「创建新版本」机制） ── */

export type RequirementLogType = 'communication' | 'change' | 'confirm' | 'other'

export interface RequirementChangeItem {
  field: string
  from?: string
  to?: string
}

export interface RequirementLog {
  id: string
  requirementId: string
  type: RequirementLogType
  content: string
  actorId?: string
  actorName?: string
  /** 变更快照（JSON 字符串）：[{ field, from, to }] */
  metadata?: string
  createdAt: string
}

/* ── 计算工具 ── */

export interface CalcInputDef {
  key: string
  label: string
  type: 'number' | 'enum' | 'string'
  unit?: string
  options?: Array<{ value: number | string; label: string }>
  min?: number
  max?: number
  default?: number | string
  required?: boolean
  group?: string
  hint?: string
}

export interface CalcFormulaDef {
  key: string
  label: string
  unit?: string
  expr: string
  digits?: number
  warnBelow?: number
  warnAbove?: number
  hint?: string
}

export interface CalcSchema {
  inputs: CalcInputDef[]
  formulas: CalcFormulaDef[]
  outputs?: string[]
  notes?: string
}

export interface CalcTemplate {
  id: string
  code: string
  name: string
  category?: string
  icon?: string
  description?: string
  schema: CalcSchema
  version: number
  status?: string
  sortOrder?: number
  useCount?: number
}

export interface CalcResultItem {
  key: string
  label: string
  unit?: string
  value: number
  expr: string
  warn?: 'below' | 'above'
  hint?: string
  isOutput: boolean
}

export interface CalcResult {
  templateCode: string
  templateName: string
  templateVersion: number
  inputs: Record<string, number | string>
  results: CalcResultItem[]
  notes?: string
}

export interface CalcRecord {
  id: string
  templateCode: string
  templateName?: string
  templateVersion: number
  title?: string
  inputData: string
  resultData: string
  relatedSolutionId?: string
  relatedProposalId?: string
  relatedRequirementId?: string
  relatedQuotationId?: string
  customerId?: string
  remark?: string
  createdByName?: string
  createdAt: string
  /** getRecord 接口额外解析出来的 */
  inputs?: Record<string, number | string>
  results?: CalcResultItem[]
}

export interface CalcSheet {
  id: string
  name: string
  description?: string
  fileKey: string
  fileName: string
  mimeType?: string
  fileSize: number
  /** Luckysheet格式的JSON数据 */
  sheetData?: string
  templateCode?: string
  relatedRequirementId?: string
  relatedProposalId?: string
  relatedQuotationId?: string
  customerId?: string
  version: number
  changeLog?: string
  createdBy?: string
  createdByName?: string
  createdAt: string
  updatedAt: string
}

/* ── 全局搜索 ── */

export type GlobalSearchType =
  | 'customer'
  | 'requirement'
  | 'proposal'
  | 'quotation'
  | 'project'
  | 'document'
  | 'supplier'
  | 'product'
  | 'solution'

export interface GlobalSearchHit {
  type: GlobalSearchType
  id: string
  title: string
  subtitle?: string
  meta?: string
  status?: string
  path: string
}

export interface GlobalSearchGroup {
  type: GlobalSearchType
  label: string
  total: number
  hits: GlobalSearchHit[]
}

export interface GlobalSearchResponse {
  query: string
  groups: GlobalSearchGroup[]
  total: number
}

// ── 性能指标 / AI 调用统计 ──────────────────────────────
export interface AiCallStats {
  total?: number
  success?: number
  failed?: number
  successRate?: number
  avgDurationMs?: number
  maxDurationMs?: number
  minDurationMs?: number
  totalTokens?: number
}

export interface KnowledgeHealth {
  total?: number
  parsed?: number
  pending?: number
  usable?: number
}

export interface EntityCounts {
  customers?: number
  requirements?: number
  proposals?: number
  quotations?: number
}

export interface TrendPoint {
  date: string
  calls: number
}

export interface ModuleStat {
  module: string
  count: number
  successRate: number
  avgDuration: number
}

export interface PerformanceMetricsResponse {
  aiCalls?: AiCallStats
  knowledgeHealth?: KnowledgeHealth
  entityCounts?: EntityCounts
  trend?: TrendPoint[]
  byModule?: ModuleStat[]
  auditLogs?: number
}

// ── AI 引擎配置 ─────────────────────────────────────────
/**
 * 各业务列表页顶部统计卡片的数据（GET /system/module-stats）。
 * 一个接口返回全部模块，页面各取所需，避免六个页面各发一次请求。
 */
export interface BusinessModuleStats {
  customers: { total: number; active: number; lead: number; sleeping: number; newThisMonth: number }
  requirements: {
    total: number
    pending: number
    ready: number
    quoted: number
    lost: number
    newThisMonth: number
    /** 跟进超期（下次跟进日期已过且未失单/关闭） */
    followupOverdue: number
    /** 7 天内应跟进 */
    followupDue: number
    /** 参数待确认（AI 已识别出参数等人工核对） */
    review: number
    /** 待完善（未识别参数或缺关键参数） */
    incomplete: number
  }
  proposals: {
    total: number
    pending: number
    approved: number
    rejected: number
    newThisMonth: number
  }
  quotations: {
    total: number
    draft: number
    pending: number
    approved: number
    sent: number
    won: number
    lost: number
    monthAmount: number
  }
  contracts: {
    total: number
    signed: number
    executing: number
    completed: number
    totalAmount: number
    warrantyExpiring: number
  }
  projects: {
    total: number
    ongoing: number
    planning: number
    completed: number
    paused: number
    highRisk: number
  }
  /** 资料类页面分页加载，总数只能由后端算 */
  documents: {
    business: {
      total: number
      approved: number
      pending: number
      linkedCustomer: number
      totalSize: number
      newThisMonth: number
    }
    knowledge: {
      total: number
      indexed: number
      categories: number
      totalSize: number
      newThisMonth: number
    }
    customer: { total: number; customers: number; totalSize: number; newThisMonth: number }
  }
  suppliers: {
    total: number
    domestic: number
    overseas: number
    tier1: number
    qualified: number
    categories: number
  }
}

export interface AiEngineConfig {
  embeddingProvider?: string
  embeddingModel?: string
  egressMode?: 'cloud' | 'local_only'
  egressSanitize?: boolean
  egressRedactTerms?: string
  providers?: {
    deepseek?: { apiKey: string; model: string; baseUrl: string }
    glm?: { apiKey: string; model: string; baseUrl: string }
    openai?: { apiKey: string; model: string; baseUrl: string }
    ollama?: { model: string; baseUrl: string }
  }
  [key: string]: unknown
}
