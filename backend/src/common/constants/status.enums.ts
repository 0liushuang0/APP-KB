/**
 * 业务状态机集中定义（编译期约束 + 文档化合法值）。
 *
 * 说明：DB 列仍为字符串，这里仅提供 TS 字面量类型，防止散落在
 * service/controller 里的魔法字符串拼写错误。与 PRD doc 07 §2 状态机对齐。
 */

/** 需求状态（PRD doc 07 §2.1） */
export type RequirementStatus =
  | 'pending' // 待解析
  | 'analyzing' // 解析中
  | 'analyzed' // 已分析
  | 'structuring' // 结构化中
  | 'structured' // 已结构化
  | 'ready' // 已就绪（人工确认后）
  | 'quoted' // 已报价
  | 'lost'; // 已失单

/** 报价状态（PRD doc 07 §2.3） */
export type QuotationStatus =
  | 'draft' // 草稿
  | 'pending' // 待审批
  | 'approved' // 已批准
  | 'rejected' // 已驳回
  | 'sent' // 已发送
  | 'won' // 已成交
  | 'lost'; // 已失单

/** 文档（知识）状态（PRD doc 07 §2.4） */
export type DocumentStatus = 'pending' | 'approved' | 'rejected';

/** 审批状态 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** 产品/方案状态（PRD doc 07 §2.5） */
export type PublishStatus = 'pending' | 'approved' | 'rejected';

/** 项目状态 */
export type ProjectStatus = 'pending' | 'planning' | 'ongoing' | 'completed' | 'paused';

/** 客户状态 */
export type CustomerStatus = 'lead' | 'pending' | 'active' | 'sleeping' | 'disabled';

/** 供应商状态 */
export type SupplierStatus = 'pending' | 'approved' | 'disabled';

/** 可见范围（数据归属） */
export type Visibility =
  | 'public'
  | 'department'
  | 'group'
  | 'role'
  | 'private';

export const QUOTATION_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SENT: 'sent',
  WON: 'won',
  LOST: 'lost',
} as const satisfies Record<string, QuotationStatus>;
