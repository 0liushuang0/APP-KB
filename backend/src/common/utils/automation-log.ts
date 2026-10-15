import { EntityManager } from 'typeorm';
import { AuditLog } from '../../modules/audit-logs/entities/audit-log.entity';

/**
 * 记一笔「系统自动替用户做了的事」。
 *
 * 工作台的「本周系统替你做了什么」只列可数的事实（解析了几份资料、自动归属了几份……），
 * 数据就从这里来。写进 audit_logs（action='auto'、userId 为空），不另建表：
 * 审计日志本来就是只追加的，按周聚合一条 SQL 即可。
 *
 * 记录失败绝不能影响业务本身 —— 这是锦上添花的统计。
 */
export type AutomationKind =
  | 'doc_parsed' // 资料自动解析并进入 AI 检索
  | 'doc_customer_linked' // 资料按所挂单据自动归属客户
  | 'spec_extracted' // 需求资料自动识别出技术参数
  | 'missing_params' // 识别出的缺失参数个数
  | 'approvals_collapsed' // 自动关闭的重复审批
  | 'index_healed' // AI 索引落后后自动补建
  | 'project_risk_flagged'; // 项目逾期自动标红

export const AUTOMATION_LABELS: Record<AutomationKind, string> = {
  doc_parsed: '份资料自动解析，可被 AI 问答找到',
  doc_customer_linked: '份资料自动归属到客户',
  spec_extracted: '条需求从资料里自动识别出技术参数',
  missing_params: '个缺失参数被自动找出，可一键生成补问',
  approvals_collapsed: '条重复导入的审批被自动关闭',
  index_healed: '类数据的 AI 索引自动补建',
  project_risk_flagged: '个项目因逾期被自动标红并通知负责人',
};

export async function recordAutomation(
  manager: EntityManager,
  kind: AutomationKind,
  count: number,
  objectId?: string,
): Promise<void> {
  if (!count || count <= 0) return;
  try {
    await manager.getRepository(AuditLog).insert({
      action: 'auto',
      objectType: kind,
      objectId: objectId ?? null,
      detail: JSON.stringify({ count }),
    } as any);
  } catch {
    /* 统计失败不影响业务 */
  }
}
