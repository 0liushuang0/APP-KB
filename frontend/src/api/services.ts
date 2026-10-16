import apiClient from './client'
import type { PaginatedResponse, Material } from '../types'
import type {
  Customer,
  Proposal,
  Quotation,
  Contract,
  AfterSalesTicket,
  Product,
  Supplier,
  Project,
  Document,
  Requirement,
  User,
  Department,
  Role,
  UserGroup,
  Customer360,
  ProjectTimeline,
  DocumentLink,
  ParamDiffResult,
  Solution,
  ParamTemplate,
  AuditLog,
  SystemConfigItem,
  FollowUpDraft,
  RequirementLog,
  RequirementChangeItem,
  GlobalSearchResponse,
  ChainNode,
  LinkEntityType,
  SupplierProduct,
  SupplierQuote,
  CompareRow,
  CalcTemplate,
  CalcResult,
  CalcRecord,
  CalcSheet,
  PerformanceMetricsResponse,
  AiEngineConfig,
  BusinessModuleStats,
} from '../types'

export const customerApi = {
  list: (params?: any) =>
    apiClient.get<Customer[] | PaginatedResponse<Customer>>('/customers', { params }).then((res) => res.data),
  get: (id: string) => apiClient.get<Customer>(`/customers/${id}`).then((res) => res.data),
  get360: (id: string) => apiClient.get<Customer360>(`/customers/${id}/360`).then((res) => res.data),
  /** 客户资料总览：一页客户 + 各家分阶段资料数（客户资料页左侧导航，支持翻页） */
  docOverview: (params?: { keyword?: string; limit?: number; page?: number }) =>
    apiClient.get('/customers/doc-overview', { params }).then((res) => res.data),
  create: (dto: Partial<Customer>) => apiClient.post<Customer>('/customers', dto).then((res) => res.data),
  update: (id: string, dto: Partial<Customer>) =>
    apiClient.patch<Customer>(`/customers/${id}`, dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/customers/${id}`).then((res) => res.data),
  // 删除预检：返回该客户名下将级联删除的业务链，前端据此弹告警
  removePreview: (id: string) =>
    apiClient.get(`/customers/${id}/remove-preview`).then((res) => res.data),
  approve: (id: string) => apiClient.post(`/customers/${id}/approve`).then((res) => res.data),
  addContact: (dto: any) => apiClient.post('/customers/contacts', dto).then((res) => res.data),
  /** 按 id 改联系人。没有它的时候，编辑客户只能把联系人整批重新 add，存一次翻一倍 */
  updateContact: (id: string, dto: any) =>
    apiClient.patch(`/customers/contacts/${id}`, dto).then((res) => res.data),
  removeContact: (id: string) =>
    apiClient.delete(`/customers/contacts/${id}`).then((res) => res.data),
  addFollowUp: (dto: any) => apiClient.post('/customers/follow-ups', dto).then((res) => res.data),
  /** AI 相似客户匹配：返回 similarity/match_reasons/cross_sell_opportunities */
  findSimilar: (id: string) =>
    apiClient.post(`/customers/${id}/similar`).then((res) => res.data),
  /** AI 交叉销售分析：基于采购历史推荐配套产品 */
  crossSell: (id: string) =>
    apiClient.post(`/customers/${id}/cross-sell`).then((res) => res.data),
}

export const proposalApi = {
  list: (params?: any) =>
    apiClient.get<Proposal[] | PaginatedResponse<Proposal>>('/proposals', { params }).then((res) => res.data),
  get: (id: string) => apiClient.get<Proposal>(`/proposals/${id}`).then((res) => res.data),
  create: (dto: Partial<Proposal>) => apiClient.post<Proposal>('/proposals', dto).then((res) => res.data),
  update: (id: string, dto: Partial<Proposal>) =>
    apiClient.patch<Proposal>(`/proposals/${id}`, dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/proposals/${id}`).then((res) => res.data),
  approve: (id: string) => apiClient.post(`/proposals/${id}/approve`).then((res) => res.data),
  generate: (dto: any) => apiClient.post('/proposals/generate', dto).then((res) => res.data),
  export: (id: string) => `${import.meta.env.VITE_API_BASE_URL || '/api'}/proposals/${id}/export`,
  versions: (id: string) => apiClient.get(`/proposals/${id}/versions`).then((res) => res.data),
  recommend: (requirementId: string) =>
    apiClient.post('/proposals/recommend', { requirementId }).then((res) => res.data),
}

export const proposalDocApi = {
  /** 上传 Word/PDF，本机解析后回填方案正文与要点 */
  extractFromDoc: (id: string, data: FormData) =>
    apiClient
      .post(`/proposals/${id}/extract`, data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((res) => res.data),
}

export const quotationApi = {
  list: (params?: any) =>
    apiClient.get<Quotation[] | PaginatedResponse<Quotation>>('/quotations', { params }).then((res) => res.data),
  get: (id: string) => apiClient.get<Quotation>(`/quotations/${id}`).then((res) => res.data),
  create: (dto: Partial<Quotation>) => apiClient.post<Quotation>('/quotations', dto).then((res) => res.data),
  update: (id: string, dto: Partial<Quotation>) =>
    apiClient.patch<Quotation>(`/quotations/${id}`, dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/quotations/${id}`).then((res) => res.data),
  approve: (id: string) => apiClient.post(`/quotations/${id}/approve`).then((res) => res.data),
  /** 历史版本：每次修改自动存档（头字段 + 明细），审计/对账可回放 */
  getVersions: (id: string) => apiClient.get<any[]>(`/quotations/${id}/versions`).then((res) => res.data),
  suggest: (dto: any) => apiClient.post('/quotations/suggest', dto).then((res) => res.data),
  /** 方案 → 报价草稿：项目名称、按需求产品类型带出的明细（含理由）、上一份报价的商务条款 */
  draftFromProposal: (proposalId: string) =>
    apiClient.get<any>(`/quotations/draft-from-proposal/${proposalId}`).then((res) => res.data),
}

export const contractApi = {
  list: (params?: any) =>
    apiClient.get<Contract[] | PaginatedResponse<Contract>>('/contracts', { params }).then((res) => res.data),
  get: (id: string) => apiClient.get<Contract>(`/contracts/${id}`).then((res) => res.data),
  create: (dto: Partial<Contract>) => apiClient.post<Contract>('/contracts', dto).then((res) => res.data),
  update: (id: string, dto: Partial<Contract>) =>
    apiClient.patch<Contract>(`/contracts/${id}`, dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/contracts/${id}`).then((res) => res.data),
  approve: (id: string) => apiClient.post(`/contracts/${id}/approve`).then((res) => res.data),
  // 回款台账：节点列表带汇总（应收/已收/未收/进度）
  getPayments: (id: string) =>
    apiClient.get<{ list: any[]; summary: any }>(`/contracts/${id}/payments`).then((res) => res.data),
  addPayment: (id: string, dto: any) =>
    apiClient.post(`/contracts/${id}/payments`, dto).then((res) => res.data),
  updatePayment: (id: string, paymentId: string, dto: any) =>
    apiClient.patch(`/contracts/${id}/payments/${paymentId}`, dto).then((res) => res.data),
  removePayment: (id: string, paymentId: string) =>
    apiClient.delete(`/contracts/${id}/payments/${paymentId}`).then((res) => res.data),
}

export const productApi = {
  list: (params?: any) =>
    apiClient.get<Product[] | PaginatedResponse<Product>>('/products', { params }).then((res) => res.data),
  get: (id: string) => apiClient.get<Product>(`/products/${id}`).then((res) => res.data),
  /** 产品被哪些报价引用过 + 价格区间 */
  usage: (id: string) =>
    apiClient
      .get<{
        quotations: any[]
        stats: { count: number; minPrice: number | null; maxPrice: number | null; avgPrice: number | null }
      }>(`/products/${id}/usage`)
      .then((res) => res.data),
  create: (dto: Partial<Product>) => apiClient.post<Product>('/products', dto).then((res) => res.data),
  update: (id: string, dto: Partial<Product>) =>
    apiClient.patch<Product>(`/products/${id}`, dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/products/${id}`).then((res) => res.data),
  approve: (id: string) => apiClient.post(`/products/${id}/approve`).then((res) => res.data),
  /** 型号价格表导出下载地址（认证在 httpOnly Cookie，fetch 需 credentials: 'include'） */
  priceListExportUrl: (id: string) =>
    `${import.meta.env.VITE_API_BASE_URL || '/api'}/products/${id}/price-list/export`,
  /** 型号价格表导入：按型号规格匹配，已有更新、新增追加 */
  importPriceList: (id: string, data: FormData) =>
    apiClient
      .post<{ total: number; added: number; updated: number; errors: Array<{ row: number; message: string }> }>(
        `/products/${id}/price-list/import`,
        data,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      .then((res) => res.data),
  uploadAttachment: (id: string, data: FormData) =>
    apiClient
      .post(`/products/${id}/upload`, data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((res) => res.data),
  removeAttachment: (id: string, aid: string) =>
    apiClient.delete(`/products/${id}/attachments/${aid}`).then((res) => res.data),
}

/** 物料主档（外购件标准库）—— 用于同规格跨厂家比价 */
export const materialApi = {
  list: (params?: any) => apiClient.get<Material[]>('/materials', { params }).then((res) => res.data),
  get: (id: string) => apiClient.get<Material>(`/materials/${id}`).then((res) => res.data),
  create: (dto: any) => apiClient.post<Material>('/materials', dto).then((res) => res.data),
  update: (id: string, dto: any) => apiClient.patch<Material>(`/materials/${id}`, dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/materials/${id}`).then((res) => res.data),
  offerings: (id: string) => apiClient.get(`/materials/${id}/offerings`).then((res) => res.data),
  addOffering: (id: string, dto: any) => apiClient.post(`/materials/${id}/offerings`, dto).then((res) => res.data),
  removeOffering: (materialId: string, offeringId: string) => apiClient.delete(`/materials/${materialId}/offerings/${offeringId}`).then((res) => res.data),
}

export const supplierApi = {
  list: (params?: any) =>
    apiClient.get<Supplier[] | PaginatedResponse<Supplier>>('/suppliers', { params }).then((res) => res.data),
  get: (id: string) => apiClient.get<Supplier>(`/suppliers/${id}`).then((res) => res.data),
  create: (dto: Partial<Supplier>) => apiClient.post<Supplier>('/suppliers', dto).then((res) => res.data),
  update: (id: string, dto: Partial<Supplier>) =>
    apiClient.patch<Supplier>(`/suppliers/${id}`, dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/suppliers/${id}`).then((res) => res.data),
  approve: (id: string) => apiClient.post(`/suppliers/${id}/approve`).then((res) => res.data),
  /** 筛选面板字典 */
  meta: () => apiClient.get('/suppliers/meta').then((res) => res.data),
  /** 比价：按品类/关键词横向对比多家供应商 */
  compare: (params: { category?: string; materialId?: string; keyword?: string; origin?: string; tier?: string }) =>
    apiClient.get<CompareRow[]>('/suppliers/compare', { params }).then((res) => res.data),
  listProducts: (id: string) =>
    apiClient.get<SupplierProduct[]>(`/suppliers/${id}/products`).then((res) => res.data),
  createProduct: (id: string, dto: Partial<SupplierProduct>) =>
    apiClient.post<SupplierProduct>(`/suppliers/${id}/products`, dto).then((res) => res.data),
}

export const supplierProductApi = {
  list: (params?: any) =>
    apiClient.get<SupplierProduct[]>('/supplier-products', { params }).then((res) => res.data),
  update: (id: string, dto: Partial<SupplierProduct>) =>
    apiClient.patch<SupplierProduct>(`/supplier-products/${id}`, dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/supplier-products/${id}`).then((res) => res.data),
  autoLinkMaterial: (id: string) => apiClient.post(`/supplier-products/${id}/auto-link-material`).then((res) => res.data),
  /** 记录一次实际报价，同时刷新目录价区间 */
  addQuote: (id: string, dto: Partial<SupplierQuote>) =>
    apiClient.post<SupplierQuote>(`/supplier-products/${id}/quotes`, dto).then((res) => res.data),
  priceHistory: (id: string) =>
    apiClient.get<SupplierQuote[]>(`/supplier-products/${id}/price-history`).then((res) => res.data),
}

export const projectApi = {
  /** 合同 → 项目草稿：开工/完工日期、项目类型、按标准模板切好的阶段 */
  draftFromContract: (contractId: string) =>
    apiClient.get<any>(`/projects/draft-from-contract/${contractId}`).then((res) => res.data),
  list: (params?: any) =>
    apiClient.get<Project[] | PaginatedResponse<Project>>('/projects', { params }).then((res) => res.data),
  get: (id: string) => apiClient.get<Project>(`/projects/${id}`).then((res) => res.data),
  getDetail: (id: string) => apiClient.get<any>(`/projects/${id}/detail`).then((res) => res.data),
  completionReport: (id: string) => apiClient.get<any>(`/projects/${id}/completion-report`).then((res) => res.data),
  getTimeline: (id: string) => apiClient.get<ProjectTimeline[]>(`/projects/${id}/timeline`).then((res) => res.data),
  getDocuments: (id: string) => apiClient.get<DocumentLink[]>(`/projects/${id}/documents`).then((res) => res.data),
  create: (dto: Partial<Project>) => apiClient.post<Project>('/projects', dto).then((res) => res.data),
  update: (id: string, dto: Partial<Project>) =>
    apiClient.patch<Project>(`/projects/${id}`, dto).then((res) => res.data),
  updateStage: (id: string, stage: string) =>
    apiClient.patch(`/projects/${id}/stage`, { stage }).then((res) => res.data),
  linkDocument: (dto: any) => apiClient.post('/projects/documents/link', dto).then((res) => res.data),
  unlinkDocument: (linkId: string) => apiClient.delete(`/projects/documents/${linkId}`).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/projects/${id}`).then((res) => res.data),
  approve: (id: string) => apiClient.post(`/projects/${id}/approve`).then((res) => res.data),
  // 任务管理
  getTasks: (id: string) => apiClient.get<any[]>(`/projects/${id}/tasks`).then((res) => res.data),
  createTask: (id: string, dto: any) => apiClient.post(`/projects/${id}/tasks`, dto).then((res) => res.data),
  updateTask: (projectId: string, taskId: string, dto: any) => apiClient.patch(`/projects/${projectId}/tasks/${taskId}`, dto).then((res) => res.data),
  removeTask: (projectId: string, taskId: string) => apiClient.delete(`/projects/${projectId}/tasks/${taskId}`).then((res) => res.data),
  // 项目成员：明确的协作授权（manager 可编辑项目与任务 / member 可编辑任务 / viewer 只读）
  getMembers: (id: string) => apiClient.get<any[]>(`/projects/${id}/members`).then((res) => res.data),
  addMember: (id: string, dto: { userId: string; role?: string }) =>
    apiClient.post(`/projects/${id}/members`, dto).then((res) => res.data),
  updateMemberRole: (id: string, userId: string, role: string) =>
    apiClient.patch(`/projects/${id}/members/${userId}`, { role }).then((res) => res.data),
  removeMember: (id: string, userId: string) =>
    apiClient.delete(`/projects/${id}/members/${userId}`).then((res) => res.data),
}

/*
 * 制造业务协同（/manufacturing）前端入口已下线：模块自上线起 0 数据、无其他页面引用。
 * 后端 /manufacturing 模块与空表保留未动；若将来恢复前端，把 ManufacturingCases.tsx
 * 从 git 历史找回并重新注册路由即可（git show HEAD^:.../ManufacturingCases.tsx）。
 */

/** 回收站里的一条资料（后端已摊平快照，不用再解 entityData） */
export interface RecycledDocument {
  /** 回收记录 id —— 还原/彻底删除都用它，不是原文档 id */
  id: string
  documentId: string
  title?: string
  fileName?: string
  category?: string
  fileSize?: number
  deletedAt: string
  deletedBy?: string
  /** 到期自动清除的时间 */
  expiresAt?: string
}

export const documentApi = {
  list: (params?: any) =>
    apiClient.get<Document[] | PaginatedResponse<Document>>('/documents', { params }).then((res) => res.data),
  /** 按分类统计条数：左侧导航计数用，scope 口径与列表一致 */
  categoryCounts: (scope?: string) =>
    apiClient.get<Record<string, number>>('/documents/category-counts', { params: { scope } }).then((res) => res.data),
  get: (id: string) => apiClient.get<Document>(`/documents/${id}`).then((res) => res.data),
  upload: (data: FormData) =>
    apiClient
      .post<Document>('/documents/upload', data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((res) => res.data),
  /** 改标题/类型/可见性；文件本身不动 */
  update: (id: string, dto: Record<string, unknown>) =>
    apiClient.patch<Document>(`/documents/${id}`, dto).then((res) => res.data),
  /** 删除 = 移入回收站（保留 30 天可还原），不是彻底抹掉 */
  remove: (id: string) => apiClient.delete(`/documents/${id}`).then((res) => res.data),
  /** 回收站列表 */
  recycled: () =>
    apiClient
      .get<RecycledDocument[]>('/documents/recycle/list')
      .then((res) => res.data),
  /** 从回收站还原（文件放回原位 + 记录恢复 + 重建索引） */
  restoreRecycled: (recycleId: string) =>
    apiClient.post(`/documents/recycle/${recycleId}/restore`).then((res) => res.data),
  /** 彻底删除某条回收记录，不可恢复 */
  purgeRecycled: (recycleId: string) =>
    apiClient.delete(`/documents/recycle/${recycleId}`).then((res) => res.data),
  approve: (id: string) => apiClient.post(`/documents/${id}/approve`).then((res) => res.data),
  reject: (id: string, comment?: string) =>
    apiClient.post(`/documents/${id}/reject`, { comment }).then((res) => res.data),

  /* ── 知识库 ── */
  knowledge: () => apiClient.get('/documents/knowledge').then((res) => res.data),
  knowledgeUpload: (data: FormData) =>
    apiClient.post('/documents/knowledge-upload', data, { headers: { 'Content-Type': 'multipart/form-data' } }).then((res) => res.data),
  /** 知识分类改名（后端级联更新已有资料的 category） */
  knowledgeRenameCategory: (from: string, to: string) =>
    apiClient.patch('/documents/knowledge-category-rename', { from, to }).then((res) => res.data),
  index: (id: string) => apiClient.post(`/documents/${id}/index`).then((res) => res.data),

  /* ── 全链路关联 ── */
  /** 客户全链路资料，按业务阶段分组 */
  chain: (customerId: string) =>
    apiClient.get<ChainNode[]>('/documents/chain', { params: { customerId } }).then((res) => res.data),
  /** 反查某个业务对象下挂了哪些资料 */
  byEntity: (entityType: LinkEntityType, entityId: string) =>
    apiClient
      .get<Document[]>('/documents/by-entity', { params: { entityType, entityId } })
      .then((res) => res.data),
  /** 某份资料被关联到了哪些链路节点 */
  links: (id: string) => apiClient.get<DocumentLink[]>(`/documents/${id}/links`).then((res) => res.data),
  createLink: (id: string, dto: Record<string, unknown>) =>
    apiClient.post<DocumentLink>(`/documents/${id}/links`, dto).then((res) => res.data),
  removeLink: (linkId: string) => apiClient.delete(`/documents/links/${linkId}`).then((res) => res.data),
}

export const requirementApi = {
  /** 确认自动识别出的参数（去掉「待确认」） */
  confirmSpec: (id: string) => apiClient.post<Requirement>(`/requirements/${id}/confirm-spec`).then((res) => res.data),
  /** 同类产品历史报价区间（预计金额参考） */
  amountReference: (category: string) =>
    apiClient.get<{ count: number; median?: number; min?: number; max?: number }>('/requirements/amount-reference', { params: { category } }).then((res) => res.data),
  list: (params?: any) =>
    apiClient.get<Requirement[]>('/requirements', { params }).then((res) => res.data),
  get: (id: string) => apiClient.get<Requirement>(`/requirements/${id}`).then((res) => res.data),
  create: (dto: any) => apiClient.post<Requirement>('/requirements', dto).then((res) => res.data),
  update: (id: string, dto: any) =>
    apiClient.patch<Requirement>(`/requirements/${id}`, dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/requirements/${id}`).then((res) => res.data),
  // 删除预检：返回该需求关联的客户/资料/下游，前端据此弹联动告警
  removePreview: (id: string) =>
    apiClient.get(`/requirements/${id}/remove-preview`).then((res) => res.data),
  upload: (id: string, data: FormData) =>
    apiClient
      .post(`/requirements/${id}/upload`, data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((res) => res.data),
  removeAttachment: (id: string, aid: string) =>
    apiClient.delete(`/requirements/${id}/attachments/${aid}`).then((res) => res.data),
  analyze: (id: string) =>
    apiClient.post<Requirement>(`/requirements/${id}/analyze`).then((res) => res.data),
  // 方案匹配解释：对某条相似方案给出推荐亮点与风险关注点
  matchExplanation: (id: string, targetType: 'proposal' | 'solution', targetId: string) =>
    apiClient
      .post(`/requirements/${id}/match-explanation`, { targetType, targetId })
      .then((res) => res.data),
  // 识别要读完资料再走大模型，常需 40–90 秒：单独放宽超时
  analyzeStructured: (id: string) =>
    apiClient.post<Requirement>(`/requirements/${id}/analyze-structured`, undefined, { timeout: 200_000 }).then((res) => res.data),
  updateSpec: (id: string, spec: any) =>
    apiClient.patch<Requirement>(`/requirements/${id}/spec`, { spec }).then((res) => res.data),
  /** 导出预览：与 PDF/DOCX 同一份取数，用于弹窗预览、改值后再导出 */
  identificationPreview: (id: string) =>
    apiClient.get<any>(`/requirements/${id}/identification-preview`).then((res) => res.data),
  followupDraft: (id: string) =>
    apiClient.post<FollowUpDraft>(`/requirements/${id}/followup-draft`).then((res) => res.data),
  versions: (id: string) =>
    apiClient.get<Requirement[]>(`/requirements/${id}/versions`).then((res) => res.data),
  /** 需求变更：创建新版本，旧版本保留为历史 */
  createVersion: (id: string, dto: { changeReason: string; title?: string; description?: string; category?: string }) =>
    apiClient.post<Requirement>(`/requirements/${id}/versions`, dto).then((res) => res.data),
  /** 需求记录：同一条需求下的沟通/变更/确认记录 */
  logs: (id: string) =>
    apiClient.get<RequirementLog[]>(`/requirements/${id}/logs`).then((res) => res.data),
  addLog: (
    id: string,
    dto: { type?: RequirementLog['type']; content: string; changes?: RequirementChangeItem[] },
  ) => apiClient.post<RequirementLog>(`/requirements/${id}/logs`, dto).then((res) => res.data),
}

/**
 * 下载需求识别文件（PDF/DOCX）。
 * 受保护接口：<a href> 不带鉴权，必须 fetch + blob 落地；Cookie 与 Bearer 都带上，
 * 列表页/详情页/预览弹窗三处共用这一份。
 */
export async function downloadRequirementIdentification(id: string, no: string, fmt: 'pdf' | 'docx') {
  const base = import.meta.env.VITE_API_BASE_URL || '/api'
  const token = localStorage.getItem('accessToken')
  const res = await fetch(`${base}/requirements/${id}/identification-${fmt}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    let message = fmt === 'pdf' ? 'PDF 导出失败' : 'Word 导出失败'
    try {
      const j = await res.json()
      if (typeof j?.message === 'string') message = j.message
    } catch { /* 非 JSON 用兜底文案 */ }
    throw new Error(message)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${no || '需求'}_需求信息文件.${fmt}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const solutionApi = {
  list: (params?: any) =>
    apiClient.get<Solution[] | PaginatedResponse<Solution>>('/solutions', { params }).then((res) => res.data),
  get: (id: string) => apiClient.get<Solution>(`/solutions/${id}`).then((res) => res.data),
  create: (dto: Partial<Solution>) => apiClient.post<Solution>('/solutions', dto).then((res) => res.data),
  update: (id: string, dto: Partial<Solution>) =>
    apiClient.patch<Solution>(`/solutions/${id}`, dto).then((res) => res.data),
  /** 复制方案（连带配置项与价格表），返回草稿状态的新方案 */
  copy: (id: string) => apiClient.post<Solution>(`/solutions/${id}/copy`, {}).then((res) => res.data),
  /** 批量移动/重命名目录节点：把 from 前缀改成 to */
  moveDirectory: (from: string, to: string) =>
    apiClient.post<{ moved: number }>('/solutions/move-directory', { from, to }).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/solutions/${id}`).then((res) => res.data),
  calculatePrice: (dto: any) => apiClient.post('/solutions/calculate-price', dto).then((res) => res.data),
  validateConfig: (id: string, dto: any) =>
    apiClient.post(`/solutions/${id}/validate-config`, dto).then((res) => res.data),
  upsertConfigOption: (dto: any) => apiClient.post('/solutions/config-options', dto).then((res) => res.data),
  removeConfigOption: (id: string) => apiClient.delete(`/solutions/config-options/${id}`).then((res) => res.data),
  upsertPriceTable: (dto: any) => apiClient.post('/solutions/price-tables', dto).then((res) => res.data),
  removePriceTable: (id: string) => apiClient.delete(`/solutions/price-tables/${id}`).then((res) => res.data),
}

export const paramTemplateApi = {
  list: (params?: any) =>
    apiClient.get<ParamTemplate[] | PaginatedResponse<ParamTemplate>>('/param-templates', { params }).then((res) => res.data),
  categories: () => apiClient.get<string[]>('/param-templates/categories').then((res) => res.data),
  get: (id: string) => apiClient.get<ParamTemplate>(`/param-templates/${id}`).then((res) => res.data),
  create: (dto: any) => apiClient.post<ParamTemplate>('/param-templates', dto).then((res) => res.data),
  update: (id: string, dto: any) =>
    apiClient.patch<ParamTemplate>(`/param-templates/${id}`, dto).then((res) => res.data),
  usage: (id: string) =>
    apiClient.get<{ count: number }>(`/param-templates/${id}/usage`).then((res) => res.data),
  /** force=true 表示用户已确认「仍有需求在引用」仍要删除 */
  remove: (id: string, force = false) =>
    apiClient
      .delete(`/param-templates/${id}${force ? '?force=true' : ''}`)
      .then((res) => res.data),
}

export const auditLogApi = {
  list: (params?: any) =>
    apiClient.get<AuditLog[] | PaginatedResponse<AuditLog>>('/audit-logs', { params }).then((res) => res.data),
}

export const systemConfigApi = {
  list: (params?: any) =>
    apiClient.get<SystemConfigItem[] | PaginatedResponse<SystemConfigItem>>('/system-configs', { params }).then((res) => res.data),
  get: (key: string) => apiClient.get<SystemConfigItem>(`/system-configs/${key}`).then((res) => res.data),
  set: (dto: any) => apiClient.post<SystemConfigItem>('/system-configs', dto).then((res) => res.data),
  update: (id: string, dto: any) =>
    apiClient.patch<SystemConfigItem>(`/system-configs/${id}`, dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/system-configs/${id}`).then((res) => res.data),
}

export const aiConfigApi = {
      get: () => apiClient.get<AiEngineConfig>('/ai-config').then((res) => res.data),
      health: () => apiClient.get<{ online: boolean; service: string; message?: string }>('/ai-config/health').then((res) => res.data),
      update: (dto: Partial<AiEngineConfig>) => apiClient.put<AiEngineConfig>('/ai-config', dto).then((res) => res.data),
  engineTemplates: () => apiClient.get('/ai-config/engine-templates').then((res) => res.data),
}

export const calcToolApi = {
  list: (includeDisabled = false) =>
    apiClient
      .get<CalcTemplate[]>('/calc-tools', includeDisabled ? { params: { includeDisabled: true } } : undefined)
      .then((res) => res.data),
  get: (code: string) => apiClient.get<CalcTemplate>(`/calc-tools/${code}`).then((res) => res.data),
  /** 执行计算，不落库 */
  calculate: (code: string, inputs: Record<string, any>) =>
    apiClient.post<CalcResult>(`/calc-tools/${code}/calculate`, { inputs }).then((res) => res.data),
  upsert: (dto: any) => apiClient.post<CalcTemplate>('/calc-tools', dto).then((res) => res.data),
  remove: (code: string) =>
    apiClient
      .delete<{ success: boolean; disabled?: boolean; used?: number }>(`/calc-tools/${code}`)
      .then((res) => res.data),
  enable: (code: string) =>
    apiClient.post<CalcTemplate>(`/calc-tools/${code}/enable`).then((res) => res.data),
  /** 校验未保存的 schema，返回逐项问题（编辑器实时提示用） */
  validate: (schema: any) =>
    apiClient
      .post<{ problems: Array<{ level: 'error' | 'warn'; at: string; message: string }> }>(
        '/calc-tools/validate',
        { schema },
      )
      .then((res) => res.data.problems),
  /** 用未保存的 schema 试算 */
  tryRun: (schema: any, inputs: Record<string, any>) =>
    apiClient.post<CalcResult>('/calc-tools/try', { schema, inputs }).then((res) => res.data),
}

export const calcRecordApi = {
  list: (params?: any) => apiClient.get<CalcRecord[]>('/calc-records', { params }).then((res) => res.data),
  get: (id: string) => apiClient.get<CalcRecord>(`/calc-records/${id}`).then((res) => res.data),
  save: (dto: any) => apiClient.post<CalcRecord>('/calc-records', dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/calc-records/${id}`).then((res) => res.data),
}

export const calcSheetApi = {
  list: (params?: any) =>
    apiClient.get<CalcSheet[]>('/calc-sheets', { params }).then((res) => res.data),
  get: (id: string) =>
    apiClient.get<CalcSheet>(`/calc-sheets/${id}`).then((res) => res.data),
  upload: (formData: FormData) =>
    apiClient
      .post<CalcSheet>('/calc-sheets/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((res) => res.data),
  updateData: (id: string, sheetData: any) =>
    apiClient.patch(`/calc-sheets/${id}/data`, { sheetData }).then((res) => res.data),
  update: (id: string, dto: { name?: string; description?: string }) =>
    apiClient.patch<CalcSheet>(`/calc-sheets/${id}`, dto).then((res) => res.data),
  remove: (id: string) =>
    apiClient.delete(`/calc-sheets/${id}`).then((res) => res.data),
  download: (id: string) =>
    `${import.meta.env.VITE_API_BASE_URL || '/api'}/calc-sheets/${id}/download`,
  export: (id: string, data: any) =>
    apiClient
      .post(`/calc-sheets/${id}/export`, { data }, { responseType: 'blob' })
      .then((res) => res.data),
}

export const aiCallLogApi = {
  list: (params?: any) => apiClient.get('/ai-call-logs', { params }).then((res) => res.data),
  getByTrace: (traceId: string) => apiClient.get(`/ai-call-logs/${traceId}`).then((res) => res.data),
}

export const aiFeedbackApi = {
  create: (dto: { messageId: string; rating: 'positive' | 'negative'; comment?: string; sessionId: string; module?: string }) =>
    apiClient.post('/ai-feedback', dto).then((res) => res.data),
  list: (params?: any) => apiClient.get('/ai-feedback', { params }).then((res) => res.data),
  stats: (module?: string) => apiClient.get('/ai-feedback/stats', { params: { module } }).then((res) => res.data),
}

export const matchingApi = {
  findSimilar: (query: string, sourceTypes?: string[], topK = 10, customerId?: string) =>
    apiClient.post('/matching/similar', { query, source_types: sourceTypes, top_k: topK, customer_id: customerId }).then((res) => res.data),
  paramDiff: (current: any, historical: any) =>
    apiClient.post<ParamDiffResult>('/matching/param-diff', { current, historical }).then((res) => res.data),
  analyze: (title: string, description: string, rawTexts: string[]) =>
    apiClient.post('/matching/analyze', { title, description, raw_texts: rawTexts }).then((res) => res.data),
}

export const userApi = {
  list: () => apiClient.get<User[]>('/users').then((res) => res.data),
  create: (dto: any) => apiClient.post('/users', dto).then((res) => res.data),
  update: (id: string, dto: any) => apiClient.put(`/users/${id}`, dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/users/${id}`).then((res) => res.data),
}

export const departmentApi = {
  list: () => apiClient.get<Department[]>('/departments').then((res) => res.data),
  create: (dto: any) => apiClient.post('/departments', dto).then((res) => res.data),
  update: (id: string, dto: any) => apiClient.put(`/departments/${id}`, dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/departments/${id}`).then((res) => res.data),
}

export const roleApi = {
  list: () => apiClient.get<Role[]>('/roles').then((res) => res.data),
}

export const userGroupApi = {
  list: () => apiClient.get<UserGroup[]>('/user-groups').then((res) => res.data),
  create: (dto: any) => apiClient.post('/user-groups', dto).then((res) => res.data),
  update: (id: string, dto: any) => apiClient.put(`/user-groups/${id}`, dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/user-groups/${id}`).then((res) => res.data),
}

export const approvalApi = {
  list: (params?: any) => apiClient.get('/approvals', { params }).then((res) => res.data),
  approve: (id: string, comment?: string) =>
    apiClient.post(`/approvals/${id}/approve`, { comment }).then((res) => res.data),
  reject: (id: string, comment?: string) =>
    apiClient.post(`/approvals/${id}/reject`, { comment }).then((res) => res.data),
}

export interface IndexHealthRow {
  sourceType: string
  label: string
  expected: number
  /** AI 服务离线时为 null —— 表示"读不到"，不是"没有" */
  indexed: number | null
  chunks: number | null
  reindexable: boolean
}

/** 向量索引的健康度与重建 */
export const aiIndexApi = {
  health: () =>
    apiClient
      .get<{
        rows: IndexHealthRow[]
        totalChunks: number | null
        running: boolean
        lastRunAt: string | null
        aiOnline: boolean
      }>('/ai/index/health')
      .then((res) => res.data),
  reindex: (types?: string[]) =>
    apiClient
      .post<{ result: Record<string, number> }>('/ai/index/reindex', { types })
      .then((res) => res.data),
  /** 知识资料要重新读文件解析，分批调用直到 remaining 为 0 */
  reindexKnowledge: (params: { limit?: number; force?: boolean; offset?: number } = {}) =>
    apiClient
      .post<{
        total: number
        processed: number
        indexed: number
        chunks: number
        skipped: number
        failed: number
        remaining: number
      }>('/documents/knowledge-reindex', null, {
        params: { limit: params.limit, force: params.force ? 1 : undefined, offset: params.offset },
      })
      .then((res) => res.data),
}

export const systemApi = {
  info: () => apiClient.get('/system/info').then((res) => res.data),
  /** scope=mine：「我的今天」只数我负责的 */
  dashboardStats: (scope: 'mine' | 'all' = 'all') => apiClient.get('/system/dashboard-stats', { params: { scope } }).then((res) => res.data),
  /** 各业务列表页顶部统计卡片：一次拿回客户/需求/方案/报价/合同/项目的分状态计数 */
  moduleStats: () =>
    apiClient.get<BusinessModuleStats>('/system/module-stats').then((res) => res.data),
  recentActivities: () => apiClient.get('/system/recent-activities').then((res) => res.data),
  performanceMetrics: () => apiClient.get<PerformanceMetricsResponse>('/system/performance-metrics').then((res) => res.data),
  /** 运行健康摘要（CPU/内存/磁盘/连接池/备份新鲜度/AI 可达） */
  healthSummary: () => apiClient.get<any>('/metrics/summary').then((res) => res.data),
  todos: () => apiClient.get<any>('/system/todos').then((res) => res.data),
  import: (data: FormData) =>
    apiClient
      .post<{ type: string; total: number; imported: number; errors: Array<{ row: number; message: string }> }>(
        '/system/import',
        data,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      .then((res) => res.data),
  export: (params?: { type?: string; keyword?: string; status?: string }) => {
    const base = import.meta.env.VITE_API_BASE_URL || '/api'
    const qs = new URLSearchParams()
    if (params?.type) qs.set('type', params.type)
    if (params?.keyword) qs.set('keyword', params.keyword)
    if (params?.status) qs.set('status', params.status)
    const s = qs.toString()
    return `${base}/system/export${s ? `?${s}` : ''}`
  },
}

export const searchApi = {
  assistant: (dto: any) => apiClient.post('/search/assistant', dto).then((res) => res.data),
  rag: (dto: any) => apiClient.post('/search/rag', dto).then((res) => res.data),
  global: (q: string, types?: string[], limit?: number) =>
    apiClient
      .get<GlobalSearchResponse>('/search/global', { params: { q, types: types?.join(','), limit } })
      .then((res) => res.data),
}

export const dataPortabilityApi = {
  getTables: () => apiClient.get<{ tables: string[] }>('/data-portability/tables').then((res) => res.data),
  exportUrl: (tables?: string[]) => {
    const base = import.meta.env.VITE_API_BASE_URL || '/api'
    const params = tables ? `?tables=${tables.join(',')}` : ''
    return `${base}/data-portability/export${params}`
  },
  importJson: (data: any) =>
    apiClient.post<{ imported: Record<string, number>; errors: string[] }>('/data-portability/import', data).then((res) => res.data),
}

export interface AppNotification {
  id: string
  type: string
  title: string
  content?: string
  recipientId: string
  linkUrl?: string
  read: boolean
  createdAt: string
}

export const notificationApi = {
  list: (unreadOnly?: boolean) =>
    apiClient.get<AppNotification[]>('/notifications', { params: { unreadOnly: unreadOnly ? 'true' : undefined } }).then((res) => res.data),
  unreadCount: () =>
    apiClient.get<{ count: number }>('/notifications/unread-count').then((res) => res.data),
  markRead: (id: string) =>
    apiClient.post(`/notifications/${id}/read`).then((res) => res.data),
  markAllRead: () =>
    apiClient.post('/notifications/read-all').then((res) => res.data),
}

export const afterSalesApi = {
  list: (params?: any) =>
    apiClient.get<AfterSalesTicket[] | PaginatedResponse<AfterSalesTicket>>('/after-sales', { params }).then((res) => res.data),
  get: (id: string) => apiClient.get<AfterSalesTicket>(`/after-sales/${id}`).then((res) => res.data),
  create: (dto: Partial<AfterSalesTicket>) => apiClient.post<AfterSalesTicket>('/after-sales', dto).then((res) => res.data),
  update: (id: string, dto: Partial<AfterSalesTicket>) =>
    apiClient.patch<AfterSalesTicket>(`/after-sales/${id}`, dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/after-sales/${id}`).then((res) => res.data),
  convertToReq: (id: string) => apiClient.post<{ requirementNo: string; requirementId: string }>(`/after-sales/${id}/convert-to-requirement`).then((res) => res.data),
  convertToFaq: (id: string) => apiClient.post<{ fileName: string }>(`/after-sales/${id}/convert-to-faq`).then((res) => res.data),
  stats: () => apiClient.get<any>('/after-sales/stats').then((res) => res.data),
  /** 项目所供设备型号（来自报价明细） */
  /** 项目所供设备的备件清单（备件管理 / 设备配套） */
  sparesForProject: (projectId: string) =>
    apiClient.get<{ equipments: Array<{ name: string; spares: Array<{ part: string; spareType?: string }>; parts: Array<{ part: string }> }> }>(`/after-sales/spares-for-project/${projectId}`).then((res) => res.data),
  modelsForProject: (projectId: string) =>
    apiClient.get<Array<{ value: string; label: string }>>(`/after-sales/models-for-project/${projectId}`).then((res) => res.data),
}

/** 业务记录回收站（客户/需求/方案/报价/合同/项目/售后/产品）与删除影响提示 */
export const recycleBinApi = {
  business: () => apiClient.get<any[]>('/recycle-bin/business').then((res) => res.data),
  restore: (id: string) => apiClient.post<any>(`/recycle-bin/business/${id}/restore`).then((res) => res.data),
  purge: (id: string) => apiClient.delete(`/recycle-bin/business/${id}`).then((res) => res.data),
  impact: (type: string, id: string) =>
    apiClient.get<Array<{ label: string; count: number }>>(`/recycle-bin/impact/${type}/${id}`).then((res) => res.data),
}

/** 工作任务：业务流程之外的日常工作记录（会议/出差/报告/协作…） */
export const workTaskApi = {
  list: (params?: any) =>
    apiClient.get<any[]>('/work-tasks', { params }).then((res) => res.data),
  get: (id: string) => apiClient.get<any>(`/work-tasks/${id}`).then((res) => res.data),
  create: (dto: any) => apiClient.post<any>('/work-tasks', dto).then((res) => res.data),
  update: (id: string, dto: any) => apiClient.patch<any>(`/work-tasks/${id}`, dto).then((res) => res.data),
  remove: (id: string) => apiClient.delete(`/work-tasks/${id}`).then((res) => res.data),
  myOpenCount: () => apiClient.get<any>('/work-tasks/my-open-count').then((res) => res.data),
}

export async function downloadJsonExport(tables?: string[]): Promise<void> {
  const url = dataPortabilityApi.exportUrl(tables)
  const res = await fetch(url, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(res.status === 403 ? '无权导出' : '导出失败')

  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = `aikb-export-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(blobUrl)
}
